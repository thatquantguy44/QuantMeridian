/**
 * SENT — Investor Sentiment & Behavior (deterministic engine).
 *
 * AAII and NAAIM data are deterministic fallback only. Live feeds come from
 * /api/social and are tagged "SURVEY" / "SOCIAL" when available. Everything
 * here is seeded SSR-safe; the composite Sentiment Index merges social +
 * market inputs and shows what is live vs simulated.
 */
import { Rng } from "@/lib/rng";
import { getSocialIntel, type SocialIntel } from "./news";
import { getSqueezeBoard } from "./squeeze";

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Weekly Thursdays ending at a fixed recent anchor (AAII/NAAIM publish weekly). */
const ANCHOR_THU = new Date("2026-06-18T00:00:00Z");
function weeklyDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date(ANCHOR_THU);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out.reverse();
}

// ── AAII Investor Sentiment Survey ───────────────────────────────────────────

export interface AaiiWeek {
  date: string;
  bullish: number; // %
  neutral: number; // %
  bearish: number; // %
  spread: number; // bullish - bearish, pts
}

export function getAaiiHistory(weeks = 104): AaiiWeek[] {
  const snap = getAaiiSnapshotHistory(weeks);
  if (snap?.length) return snap;

  const dates = weeklyDates(weeks);
  const rng = new Rng("sent-aaii-v1");
  // mean-revert bullish & bearish around historical norms (~37.5 / ~31)
  let bull = 38;
  let bear = 30;
  return dates.map((date) => {
    bull = clamp(bull + (37.5 - bull) * 0.12 + rng.normal(0, 4.5), 15, 62);
    bear = clamp(bear + (31 - bear) * 0.12 + rng.normal(0, 4.5), 12, 58);
    const neutral = clamp(100 - bull - bear, 8, 60);
    const b = Number(bull.toFixed(1));
    const be = Number(bear.toFixed(1));
    const ne = Number((100 - b - be).toFixed(1));
    return { date, bullish: b, neutral: ne, bearish: be, spread: Number((b - be).toFixed(1)) };
  });
}

export type AaiiZone = "Euphoria" | "Optimism" | "Neutral" | "Pessimism" | "Capitulation";

export interface AaiiSnapshot {
  latest: AaiiWeek;
  prior: AaiiWeek;
  spreadPctile: number; // 0-100 in own history
  bullPctile: number;
  zone: AaiiZone;
  note: string;
}

function pctile(arr: number[], v: number): number {
  return Math.round((arr.filter((x) => x <= v).length / arr.length) * 100);
}

export function getAaiiSnapshot(): AaiiSnapshot {
  const h = getAaiiHistory();
  const latest = h[h.length - 1];
  const prior = h[h.length - 2];
  const spreads = h.map((w) => w.spread);
  const bulls = h.map((w) => w.bullish);
  const sp = pctile(spreads, latest.spread);
  const zone: AaiiZone = sp >= 85 ? "Euphoria" : sp >= 60 ? "Optimism" : sp >= 40 ? "Neutral" : sp >= 15 ? "Pessimism" : "Capitulation";
  const note =
    zone === "Euphoria"
      ? "Retail bullishness in the top decile — historically a contrarian caution flag."
      : zone === "Capitulation"
      ? "Retail capitulation — historically a contrarian support level."
      : zone === "Optimism"
      ? "Retail leaning bullish but not extreme."
      : zone === "Pessimism"
      ? "Retail cautious; watch for washout or recovery."
      : "Retail sentiment balanced near historical norms.";
  return { latest, prior, spreadPctile: sp, bullPctile: pctile(bulls, latest.bullish), zone, note };
}

// ── NAAIM Exposure Index (active manager equity exposure) ─────────────────────

export interface NaaimWeek {
  date: string;
  exposure: number; // typically 0-100 (can be -200..200)
}
export function getNaaimHistory(weeks = 104): NaaimWeek[] {
  const dates = weeklyDates(weeks);
  const rng = new Rng("sent-naaim-v1");
  let e = 75;
  return dates.map((date) => {
    e = clamp(e + (72 - e) * 0.1 + rng.normal(0, 9), 10, 105);
    return { date, exposure: Number(e.toFixed(1)) };
  });
}

// ── Composite Sentiment Index (0-100 fear↔greed) ─────────────────────────────

export type SentSource = "SURVEY" | "SOCIAL" | "FRED" | "MARKET";
export interface SentComponent {
  label: string;
  score: number; // 0-100 (100 = greed)
  weight: number;
  detail: string;
  source: SentSource;
  live: boolean; // would this be live once feeds are wired
}

export type SentRegime = "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";

export interface SentimentIndex {
  score: number;
  regime: SentRegime;
  components: SentComponent[];
  delta1w: number;
  readThrough: string;
}

/** Live overrides supplied by the page (e.g. VIX from FRED, social from /api/social). */
export interface SentLiveInputs {
  vix?: { score: number; detail: string };
  social?: { intel: SocialIntel; source: string };
  junkBondDemand?: { score: number; detail: string };
  safeHaven?: { score: number; detail: string };
}

function regimeOf(score: number): SentRegime {
  return score < 20 ? "Extreme Fear" : score < 40 ? "Fear" : score < 60 ? "Neutral" : score < 80 ? "Greed" : "Extreme Greed";
}

/** Map AAII bull-bear spread (≈ -40..+40) to a 0-100 greed score. */
const spreadToScore = (s: number) => clamp(((s + 25) / 50) * 100);
/** Net social sentiment (-1..1) to 0-100. */
const netToScore = (s: number) => clamp(((s + 0.6) / 1.2) * 100);

function buildIndex(forWeeksAgo = 0, live?: SentLiveInputs): { score: number; components: SentComponent[] } {
  const aaii = getAaiiHistory();
  const naaim = getNaaimHistory();
  const a = aaii[aaii.length - 1 - forWeeksAgo];
  const nm = naaim[naaim.length - 1 - forWeeksAgo];
  const social = forWeeksAgo === 0 ? live?.social?.intel ?? getSocialIntel() : getSocialIntel();
  const socialLive = forWeeksAgo === 0 && !!live?.social && live.social.source !== "SIM";
  const netSocial = social.platforms.reduce((s, p) => s + p.sentiment, 0) / social.platforms.length;
  const avgVel = social.tickers.reduce((s, t) => s + t.velocity, 0) / Math.max(1, social.tickers.length);

  // market-based inputs (seeded; upgrade to live market/FRED layer later)
  const rng = new Rng(`sent-mkt-${forWeeksAgo}`);
  const putCallScore = clamp(rng.normal(58, 12)); // inverted p/c → greed
  // VIX is live-capable via FRED (VIXCLS); use the live percentile when supplied.
  const vix = forWeeksAgo === 0 ? live?.vix : undefined;
  const vixScore = vix ? vix.score : clamp(rng.normal(62, 12));
  const breadthScore = clamp(rng.normal(60, 14));
  const junk = forWeeksAgo === 0 ? live?.junkBondDemand : undefined;
  const junkScore = junk ? junk.score : clamp(rng.normal(55, 12));
  const haven = forWeeksAgo === 0 ? live?.safeHaven : undefined;
  const havenScore = haven ? haven.score : clamp(rng.normal(55, 12));

  const components: SentComponent[] = [
    { label: "AAII bull–bear", score: Math.round(spreadToScore(a.spread)), weight: 0.2, detail: `spread ${a.spread >= 0 ? "+" : ""}${a.spread}`, source: "SURVEY", live: true },
    { label: "NAAIM exposure", score: Math.round(clamp(nm.exposure)), weight: 0.15, detail: `${nm.exposure}% invested`, source: "SURVEY", live: true },
    { label: "Social net sentiment", score: Math.round(netToScore(netSocial)), weight: 0.2, detail: `${netSocial >= 0 ? "+" : ""}${netSocial.toFixed(2)}${socialLive ? ` · ${live?.social?.source}` : ""}`, source: "SOCIAL", live: socialLive },
    { label: "Social velocity", score: Math.round(clamp(50 + avgVel * 0.4)), weight: 0.1, detail: `${avgVel >= 0 ? "+" : ""}${avgVel.toFixed(0)}% mentions${socialLive ? ` · ${live?.social?.source}` : ""}`, source: "SOCIAL", live: socialLive },
    { label: "Put/Call (inv)", score: Math.round(putCallScore), weight: 0.1, detail: "options demand", source: "MARKET", live: false },
    { label: "Volatility (inv)", score: Math.round(vixScore), weight: 0.1, detail: vix ? vix.detail : "VIX percentile", source: "FRED", live: !!vix },
    { label: "Junk bond demand", score: Math.round(junkScore), weight: 0.1, detail: junk ? junk.detail : "HY OAS proxy", source: "FRED", live: !!junk },
    { label: "Safe-haven demand", score: Math.round(havenScore), weight: 0.05, detail: haven ? haven.detail : "yield curve", source: "FRED", live: !!haven },
  ];
  const score = Math.round(clamp(components.reduce((s, c) => s + c.score * c.weight, 0)));
  return { score, components };
}

export function getSentimentIndex(live?: SentLiveInputs): SentimentIndex {
  const now = buildIndex(0, live);
  const wk = buildIndex(1);
  const regime = regimeOf(now.score);
  const readThrough =
    regime === "Extreme Greed"
      ? "Crowd is euphoric — historically a contrarian caution flag; tighten risk, fade chasing."
      : regime === "Greed"
      ? "Risk appetite elevated — trend intact but crowding building; mind stops."
      : regime === "Neutral"
      ? "Sentiment balanced — no strong behavioral edge either way."
      : regime === "Fear"
      ? "Caution dominant — selective dip-buying historically rewarded from here."
      : "Capitulation — extreme fear has historically marked contrarian support.";
  return { score: now.score, regime, components: now.components, delta1w: now.score - wk.score, readThrough };
}

// ── Headline summary ─────────────────────────────────────────────────────────

export interface SentimentSummary {
  index: number;
  regime: SentRegime;
  delta1w: number;
  aaiiSpread: number;
  aaiiZone: AaiiZone;
  naaim: number;
  socialNet: number;
  topTicker: string;
}
export function getSentimentSummary(live?: SentLiveInputs): SentimentSummary {
  const idx = getSentimentIndex(live);
  const aaii = getAaiiSnapshot();
  const naaim = getNaaimHistory();
  const social = live?.social?.intel ?? getSocialIntel();
  const netSocial = social.platforms.reduce((s, p) => s + p.sentiment, 0) / social.platforms.length;
  return {
    index: idx.score,
    regime: idx.regime,
    delta1w: idx.delta1w,
    aaiiSpread: aaii.latest.spread,
    aaiiZone: aaii.zone,
    naaim: naaim[naaim.length - 1].exposure,
    socialNet: Number(netSocial.toFixed(2)),
    topTicker: social.tickers[0]?.label ?? "—",
  };
}

// ── SENT-4 · Behavior & Positioning ──────────────────────────────────────────

export interface BehaviorPoint {
  date: string;
  retail: number; // AAII-derived retail mood, 0-100
  inst: number; // NAAIM manager exposure, 0-100
  putCall: number;
  gap: number; // retail - inst
}
export interface FundFlow {
  label: string;
  value: number; // weekly net flow, $B
}
export interface BehaviorState {
  series: BehaviorPoint[];
  retailNow: number;
  instNow: number;
  gapNow: number;
  gapZ: number; // z-score of current gap vs history
  putCallNow: number;
  signal: string;
  tone: "up" | "down" | "amber";
  flows: FundFlow[];
}

export function getBehavior(): BehaviorState {
  const aaii = getAaiiHistory();
  const naaim = getNaaimHistory();
  const rng = new Rng("sent-behav-v1");
  let pc = 0.92;
  const series: BehaviorPoint[] = aaii.map((w, i) => {
    pc = clamp(pc + (0.9 - pc) * 0.12 + rng.normal(0, 0.05), 0.55, 1.5);
    const retail = Math.round(spreadToScore(w.spread));
    const inst = Math.round(clamp(naaim[i].exposure));
    return { date: w.date, retail, inst, putCall: Number(pc.toFixed(2)), gap: retail - inst };
  });
  const gaps = series.map((p) => p.gap);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) || 1;
  const last = series[series.length - 1];
  const gapZ = Number(((last.gap - mean) / sd).toFixed(1));
  const signal =
    last.gap > 14
      ? "Retail mood is running well ahead of manager positioning — classic distribution-risk setup (dumb money leading)."
      : last.gap < -14
      ? "Managers are positioned ahead of a cautious retail crowd — accumulation setup (smart money leading)."
      : "Retail and institutional positioning are broadly aligned — no strong divergence edge.";
  const tone = last.gap > 14 ? "down" : last.gap < -14 ? "up" : "amber";
  const fr = new Rng("sent-flows-v1");
  const flows: FundFlow[] = [
    { label: "US Equity", value: Number(fr.normal(4, 9).toFixed(1)) },
    { label: "Bonds", value: Number(fr.normal(3, 5).toFixed(1)) },
    { label: "Money Market", value: Number(fr.normal(12, 14).toFixed(1)) },
    { label: "Intl Equity", value: Number(fr.normal(1.5, 4).toFixed(1)) },
    { label: "Crypto", value: Number(fr.normal(0.4, 2).toFixed(1)) },
  ];
  return { series, retailNow: last.retail, instNow: last.inst, gapNow: last.gap, gapZ, putCallNow: last.putCall, signal, tone, flows };
}

// ── SENT-5 · Contrarian Signals & Historical Analogs ─────────────────────────

export interface ContrarianSignal {
  trigger: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number; // 0-100
  rationale: string;
  source: SentSource;
}

export function getContrarianSignals(live?: SentLiveInputs): ContrarianSignal[] {
  const idx = getSentimentIndex(live);
  const aaii = getAaiiSnapshot();
  const behav = getBehavior();
  const social = live?.social?.intel ?? getSocialIntel();
  const avgVel = social.tickers.reduce((s, t) => s + t.velocity, 0) / Math.max(1, social.tickers.length);
  const out: ContrarianSignal[] = [];

  if (idx.regime === "Extreme Greed" || idx.regime === "Greed")
    out.push({ trigger: `Sentiment Index ${idx.score} — ${idx.regime}`, direction: "BEARISH", confidence: idx.regime === "Extreme Greed" ? 78 : 60, rationale: "Crowd greed has historically preceded below-average forward returns. Fade chasing, tighten risk.", source: "MARKET" });
  else if (idx.regime === "Extreme Fear" || idx.regime === "Fear")
    out.push({ trigger: `Sentiment Index ${idx.score} — ${idx.regime}`, direction: "BULLISH", confidence: idx.regime === "Extreme Fear" ? 76 : 58, rationale: "Extreme fear has historically marked contrarian support. Selective accumulation rewarded.", source: "MARKET" });

  if (aaii.spreadPctile >= 85) out.push({ trigger: `AAII bull-bear in ${aaii.spreadPctile}th pctile`, direction: "BEARISH", confidence: 70, rationale: "Retail bullishness near historical extreme — contrarian caution flag.", source: "SURVEY" });
  else if (aaii.spreadPctile <= 15) out.push({ trigger: `AAII bull-bear in ${aaii.spreadPctile}th pctile`, direction: "BULLISH", confidence: 68, rationale: "Retail capitulation near historical extreme — contrarian support.", source: "SURVEY" });

  if (behav.gapNow > 14) out.push({ trigger: `Retail−manager gap +${behav.gapNow} (${behav.gapZ}σ)`, direction: "BEARISH", confidence: 64, rationale: "Retail euphoria outrunning manager positioning — distribution risk.", source: "SURVEY" });
  else if (behav.gapNow < -14) out.push({ trigger: `Retail−manager gap ${behav.gapNow} (${behav.gapZ}σ)`, direction: "BULLISH", confidence: 62, rationale: "Managers leading a cautious retail crowd — accumulation signal.", source: "SURVEY" });

  if (avgVel > 45) out.push({ trigger: `Social mention velocity +${avgVel.toFixed(0)}%`, direction: "BEARISH", confidence: 52, rationale: "Surging social attention can mark crowded, late-stage moves.", source: "SOCIAL" });

  if (out.length === 0) out.push({ trigger: "No sentiment extreme", direction: "NEUTRAL", confidence: 40, rationale: "Sentiment is balanced — no strong contrarian edge currently.", source: "MARKET" });
  return out.sort((a, b) => b.confidence - a.confidence);
}

export interface ForwardStat {
  horizon: string;
  avgReturn: number; // %
  hitRate: number; // % positive
  n: number;
}
export interface AnalogStudy {
  condition: string;
  forward: ForwardStat[];
  note: string;
}

/** Deterministic weekly SPY-proxy returns (%) with a mild contrarian tilt to prior sentiment. */
function weeklyProxyReturns(): number[] {
  const aaii = getAaiiHistory();
  const rng = new Rng("sent-proxy-v1");
  return aaii.map((w) => {
    const tilt = -(spreadToScore(w.spread) - 50) * 0.012; // greedier week → slightly lower fwd
    return Number((rng.normal(0.18, 1.9) + tilt).toFixed(2));
  });
}

/** Conditional forward returns for weeks whose AAII zone matches today's. */
export function getAnalogStudy(): AnalogStudy {
  const aaii = getAaiiHistory();
  const snap = getAaiiSnapshot();
  const rets = weeklyProxyReturns();
  const spreads = aaii.map((w) => w.spread);
  const zoneOf = (i: number): AaiiZone => {
    const p = pctile(spreads, aaii[i].spread);
    return p >= 85 ? "Euphoria" : p >= 60 ? "Optimism" : p >= 40 ? "Neutral" : p >= 15 ? "Pessimism" : "Capitulation";
  };
  const fwd = (i: number, h: number): number | null => {
    if (i + h >= rets.length) return null;
    let c = 0;
    for (let k = 1; k <= h; k++) c += rets[i + k];
    return c;
  };
  const horizons: { label: string; h: number }[] = [
    { label: "1 week", h: 1 },
    { label: "4 weeks", h: 4 },
    { label: "12 weeks", h: 12 },
  ];
  const matches: number[] = [];
  for (let i = 0; i < aaii.length; i++) if (zoneOf(i) === snap.zone) matches.push(i);
  const forward: ForwardStat[] = horizons.map(({ label, h }) => {
    const vals = matches.map((i) => fwd(i, h)).filter((v): v is number => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const hit = vals.length ? (vals.filter((v) => v > 0).length / vals.length) * 100 : 0;
    return { horizon: label, avgReturn: Number(avg.toFixed(1)), hitRate: Math.round(hit), n: vals.length };
  });
  return {
    condition: `AAII zone = ${snap.zone} (spread ${snap.spreadPctile}th pctile)`,
    forward,
    note: "Forward returns of a broad-equity proxy on weeks that shared today's AAII sentiment zone. Illustrative analog over a 2-yr deterministic sample — directional, not predictive.",
  };
}

// ── SENT-6 · Survey vs Social Divergence ─────────────────────────────────────

export interface DivergencePoint {
  date: string;
  survey: number; // 0-100 (AAII-derived)
  social: number; // 0-100 (social mood)
  gap: number; // social - survey
}
export interface DivergenceState {
  series: DivergencePoint[];
  gapNow: number;
  status: "ALIGNED" | "SOCIAL HOT" | "SURVEY HOT" | "DIVERGENT";
  note: string;
  tone: "up" | "down" | "amber" | "neutral";
}

export function getSurveySocialDivergence(): DivergenceState {
  const aaii = getAaiiHistory();
  const rng = new Rng("sent-diverge-v1");
  let social = 55;
  const series: DivergencePoint[] = aaii.map((w) => {
    const survey = Math.round(spreadToScore(w.spread));
    // social mostly tracks survey but is noisier and occasionally decouples
    social = clamp(social * 0.55 + survey * 0.35 + rng.normal(0, 12) + 0.1 * (rng.bool(0.12) ? rng.normal(0, 30) : 0));
    return { date: w.date, survey, social: Math.round(social), gap: Math.round(social - survey) };
  });
  const last = series[series.length - 1];
  const status: DivergenceState["status"] =
    Math.abs(last.gap) >= 22 ? "DIVERGENT" : last.gap >= 12 ? "SOCIAL HOT" : last.gap <= -12 ? "SURVEY HOT" : "ALIGNED";
  const note =
    status === "DIVERGENT"
      ? "Social mood and the weekly survey have decoupled sharply — one cohort is likely about to chase or capitulate."
      : status === "SOCIAL HOT"
      ? "Real-time social mood is running hotter than the survey — early retail enthusiasm not yet in the weekly print."
      : status === "SURVEY HOT"
      ? "Survey optimism exceeds live social mood — the crowd may be cooling faster than the weekly data shows."
      : "Social and survey sentiment are aligned — consistent read across cohorts.";
  const tone = status === "DIVERGENT" ? "down" : status === "ALIGNED" ? "up" : "amber";
  return { series, gapNow: last.gap, status, note, tone };
}

// ── SENT-7 · Ticker Sentiment Drill (cross-linked to SQZ) ────────────────────

export type Crowding = "Squeeze Risk" | "Crowded Long" | "Crowded Short" | "Balanced";

export interface TickerSentiment {
  ticker: string;
  sector: string;
  classification: string;
  socialSentiment: number; // -1..1
  mentions: number;
  velocity: number; // %
  shortInterestPct: number;
  utilization: number;
  feeBps: number;
  putCall: number;
  skew: number;
  heat: number;
  crowding: Crowding;
  note: string;
}

/**
 * Joins the SQZ borrow board (short interest, utilization, fee, options) with
 * social mood per name to flag crowding — crowded longs that are also heavily
 * shorted are squeeze/unwind risk. Anchored on the squeeze board so the SQZ
 * cross-link data is always present; social is matched in or synthesized.
 */
export function getTickerSentiment(limit = 16, socialInput?: SocialIntel): TickerSentiment[] {
  const board = getSqueezeBoard();
  const social = socialInput ?? getSocialIntel();
  const socialByTicker = new Map(social.tickers.map((t) => [t.label, t]));

  return board.slice(0, limit).map((r) => {
    const s = socialByTicker.get(r.ticker);
    const rng = new Rng(`sent-tk-${r.ticker}`);
    const socialSentiment = s ? s.sentiment : Number(rng.normal(0.05, 0.4).toFixed(2));
    const mentions = s ? s.mentions : rng.int(120, 4200);
    const velocity = s ? s.velocity : Number(rng.normal(15, 45).toFixed(0));

    let crowding: Crowding;
    if (r.shortInterestPct >= 15 && socialSentiment > 0.12) crowding = "Squeeze Risk";
    else if (socialSentiment > 0.2 && velocity > 30) crowding = "Crowded Long";
    else if (r.shortInterestPct >= 18 || (r.utilization >= 88 && socialSentiment < 0)) crowding = "Crowded Short";
    else crowding = "Balanced";

    const note =
      crowding === "Squeeze Risk"
        ? "Bulls piling in while heavily shorted — both sides loaded; squeeze/unwind risk."
        : crowding === "Crowded Long"
        ? "Strong positive social mood with rising attention — crowded long, chase risk."
        : crowding === "Crowded Short"
        ? "Heavy short interest / utilization with weak mood — crowded short."
        : "No strong crowding signal.";

    return {
      ticker: r.ticker,
      sector: r.sector,
      classification: r.classification,
      socialSentiment,
      mentions,
      velocity,
      shortInterestPct: r.shortInterestPct,
      utilization: r.utilization,
      feeBps: r.feeBps,
      putCall: r.putCall,
      skew: r.skew,
      heat: r.heat,
      crowding,
      note,
    };
  });
}

export { getSocialIntel };
