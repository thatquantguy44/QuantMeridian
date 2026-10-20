/** Shared Economics & Macro enhancement data used by the roadmap feature pass. */

export interface SfeFactorLink {
  metric: string;
  macroFactorId: string;
  factorLabel: string;
  source: "FRED" | "YAHOO" | "LOCAL";
  sensitivityBps: number;
  confidence: number;
  deskUse: string;
}

export interface SfePnlBridge {
  driver: string;
  factorId: string;
  baseBps: number;
  shockBps: number;
  pnlImpact: number;
  desk: "SLAB" | "REINV" | "CASH" | "COLL";
}

export interface SfeScenario {
  scenario: string;
  repoShockBps: number;
  rebateShockBps: number;
  reinvestShockBps: number;
  specialnessShockBps: number;
  pnlImpact: number;
}

export interface StatStudyPack {
  id: string;
  name: string;
  question: string;
  driver: string;
  target: string;
  series: string[];
  transform: "level" | "chg" | "yoy";
  lag: number;
  rollingWindow: number;
  deskUse: string;
  confidence: number;
}

export interface CreditHaircutImpact {
  collateralType: string;
  baseHaircut: number;
  stressedHaircut: number;
  oasDriver: string;
  liquidityDrag: number;
  optimizationCost: number;
}

export interface CounterpartyCreditOverlay {
  counterparty: string;
  rating: string;
  stressScore: number;
  marginUplift: number;
  wrongWayFlag: "YES" | "NO";
  action: string;
}

export interface CreditSubstitution {
  fromAsset: string;
  toAsset: string;
  notional: number;
  haircutSavings: number;
  eligibilityGain: number;
  rationale: string;
}

export interface TermFundingCarry {
  tenor: string;
  fundingBps: number;
  reinvestYieldBps: number;
  carryBps: number;
  cut25CarryBps: number;
  balanceSheetCostBps: number;
  monthlyPnl: number;
}

export interface PolicyTransmission {
  module: "REINV" | "CASH" | "COLL" | "OPT";
  pathInput: string;
  currentImpact: string;
  shock25bp: number;
  shock100bp: number;
  action: string;
}

export type CalendarSensitivityTag = "Rates P&L" | "Haircut Risk" | "Borrow Demand" | "Funding Liquidity" | "Margin Risk";

export interface ReleaseMoveSummary {
  release: string;
  factor: string;
  preMoveBps: number;
  postMoveBps: number;
  deskImpact: CalendarSensitivityTag;
}

export function getSfeFactorLinks(): SfeFactorLink[] {
  return [
    { metric: "Cash reinvestment yield", macroFactorId: "SOFR", factorLabel: "SOFR", source: "FRED", sensitivityBps: 82, confidence: 89, deskUse: "Reset ladder yield and rebate economics" },
    { metric: "Funding cost of book", macroFactorId: "EFFR", factorLabel: "Effective Fed Funds", source: "FRED", sensitivityBps: 96, confidence: 91, deskUse: "Book funding cost and prime financing NIM" },
    { metric: "GC repo pressure", macroFactorId: "SOFR_EFFR", factorLabel: "SOFR minus EFFR", source: "FRED", sensitivityBps: 67, confidence: 76, deskUse: "Repo squeeze warning and cash funding premium" },
    { metric: "Specials activity", macroFactorId: "HYG_LQD", factorLabel: "HY vs IG credit proxy", source: "YAHOO", sensitivityBps: 38, confidence: 64, deskUse: "Short demand and HTB fee pressure" },
    { metric: "Collateral drag", macroFactorId: "BAMLH0A0HYM2", factorLabel: "HY OAS", source: "FRED", sensitivityBps: 44, confidence: 72, deskUse: "Haircut overlays and eligibility pressure" },
    { metric: "Liquidity buffer", macroFactorId: "LOCAL_LIQ_BUFFER", factorLabel: "Internal liquidity buffer", source: "LOCAL", sensitivityBps: 52, confidence: 69, deskUse: "Optimization penalty for scarce cash and HQLA" },
  ];
}

export function getSfePnlBridge(): SfePnlBridge[] {
  return [
    { driver: "Rebate repricing", factorId: "EFFR", baseBps: 388, shockBps: -25, pnlImpact: 4.2e6, desk: "SLAB" },
    { driver: "Reinvestment carry", factorId: "SOFR", baseBps: 433, shockBps: -21, pnlImpact: -3.8e6, desk: "REINV" },
    { driver: "GC funding cost", factorId: "SOFR_EFFR", baseBps: 455, shockBps: -24, pnlImpact: 5.1e6, desk: "CASH" },
    { driver: "Specialness pickup", factorId: "HYG_LQD", baseBps: 48, shockBps: 7, pnlImpact: 2.4e6, desk: "SLAB" },
    { driver: "Collateral haircut drag", factorId: "BAMLH0A0HYM2", baseBps: 32, shockBps: 5, pnlImpact: -1.6e6, desk: "COLL" },
  ];
}

export function getSfeScenarioLibrary(): SfeScenario[] {
  return [
    { scenario: "Fed 25bp cut", repoShockBps: -24, rebateShockBps: -23, reinvestShockBps: -21, specialnessShockBps: 4, pnlImpact: 3.1e6 },
    { scenario: "Fed 100bp cut", repoShockBps: -96, rebateShockBps: -91, reinvestShockBps: -84, specialnessShockBps: 16, pnlImpact: 9.8e6 },
    { scenario: "Repo squeeze", repoShockBps: 38, rebateShockBps: 4, reinvestShockBps: 8, specialnessShockBps: 11, pnlImpact: -5.6e6 },
    { scenario: "Credit shock", repoShockBps: 12, rebateShockBps: 0, reinvestShockBps: -6, specialnessShockBps: 28, pnlImpact: 1.7e6 },
    { scenario: "Reserve drain", repoShockBps: 24, rebateShockBps: 3, reinvestShockBps: 5, specialnessShockBps: 9, pnlImpact: -2.9e6 },
  ];
}

export function getStatStudyPacks(): StatStudyPack[] {
  return [
    {
      id: "rates-reinvestment",
      name: "Rates to reinvestment income",
      question: "Do policy rates lead cash collateral reinvestment economics?",
      driver: "EFFR",
      target: "10Y",
      series: ["EFFR", "10Y", "2Y", "2s10s"],
      transform: "chg",
      lag: 2,
      rollingWindow: 12,
      deskUse: "Feed SFE and REINV rate-beta assumptions.",
      confidence: 82,
    },
    {
      id: "oas-haircuts",
      name: "HY OAS to haircut stress",
      question: "Does credit spread widening lead collateral haircut pressure?",
      driver: "HY OAS",
      target: "2s10s",
      series: ["HY OAS", "2s10s", "VIX", "USD"],
      transform: "chg",
      lag: 3,
      rollingWindow: 24,
      deskUse: "Feed COLL dynamic haircut overlays.",
      confidence: 74,
    },
    {
      id: "vol-htb",
      name: "Volatility to HTB demand",
      question: "Does volatility explain specials and HTB pressure?",
      driver: "VIX",
      target: "HY OAS",
      series: ["VIX", "HY OAS", "10Y", "USD"],
      transform: "chg",
      lag: 1,
      rollingWindow: 12,
      deskUse: "Feed SLAB fair-fee and recall queues.",
      confidence: 69,
    },
    {
      id: "curve-demand",
      name: "Curve to lending demand",
      question: "Does curve inversion lead recession-linked borrow demand?",
      driver: "2s10s",
      target: "U-3",
      series: ["2s10s", "U-3", "EFFR", "HY OAS"],
      transform: "level",
      lag: 4,
      rollingWindow: 24,
      deskUse: "Feed REGIME and SLAB demand playbooks.",
      confidence: 78,
    },
    {
      id: "funding-stress",
      name: "Funding stress proxy",
      question: "Do rate and credit shocks travel together into funding stress?",
      driver: "EFFR",
      target: "HY OAS",
      series: ["EFFR", "HY OAS", "VIX", "USD"],
      transform: "chg",
      lag: 2,
      rollingWindow: 12,
      deskUse: "Feed LIQ and CASH early-warning rules.",
      confidence: 71,
    },
  ];
}

export function getCreditHaircutImpacts(): CreditHaircutImpact[] {
  return [
    { collateralType: "UST", baseHaircut: 0.8, stressedHaircut: 1.0, oasDriver: "IG OAS", liquidityDrag: 2, optimizationCost: 0.4e6 },
    { collateralType: "Agency MBS", baseHaircut: 2.4, stressedHaircut: 3.2, oasDriver: "IG OAS", liquidityDrag: 7, optimizationCost: 1.1e6 },
    { collateralType: "Corp IG", baseHaircut: 5.2, stressedHaircut: 7.4, oasDriver: "BBB OAS", liquidityDrag: 18, optimizationCost: 3.8e6 },
    { collateralType: "Corp HY", baseHaircut: 12.5, stressedHaircut: 18.7, oasDriver: "HY OAS", liquidityDrag: 42, optimizationCost: 7.6e6 },
    { collateralType: "Equity Index", baseHaircut: 15.0, stressedHaircut: 19.5, oasDriver: "HY OAS/VIX", liquidityDrag: 31, optimizationCost: 4.9e6 },
  ];
}

export function getCounterpartyCreditOverlays(): CounterpartyCreditOverlay[] {
  return [
    { counterparty: "Alderwood Capital", rating: "A", stressScore: 42, marginUplift: 1.8, wrongWayFlag: "NO", action: "Keep standard schedule" },
    { counterparty: "Bramblecrest Partners", rating: "A-", stressScore: 55, marginUplift: 2.4, wrongWayFlag: "NO", action: "Monitor HY collateral mix" },
    { counterparty: "Cobaltline Asset Mgmt", rating: "BBB+", stressScore: 64, marginUplift: 3.2, wrongWayFlag: "YES", action: "Cap lower-grade credit collateral" },
    { counterparty: "Harrowgate Partners", rating: "BBB", stressScore: 71, marginUplift: 4.1, wrongWayFlag: "YES", action: "Prefer cash or UST substitutions" },
    { counterparty: "Kestrelmoor Capital", rating: "BBB-", stressScore: 78, marginUplift: 5.6, wrongWayFlag: "YES", action: "Escalate haircut override" },
  ];
}

export function getCreditSubstitutions(): CreditSubstitution[] {
  return [
    { fromAsset: "Corp HY Bonds", toAsset: "T-Bills 1-3M", notional: 850e6, haircutSavings: 42e6, eligibilityGain: 26, rationale: "HY OAS widening makes HQLA substitution cheaper after funding charge." },
    { fromAsset: "Equity Index Collateral", toAsset: "UST 2Y-5Y", notional: 1.2e9, haircutSavings: 37e6, eligibilityGain: 18, rationale: "Reduce equity beta before risk-off transition probability rises." },
    { fromAsset: "BBB Credit", toAsset: "Agency MBS", notional: 640e6, haircutSavings: 13e6, eligibilityGain: 11, rationale: "Improve eligibility breadth while preserving yield pickup." },
    { fromAsset: "Bank CP", toAsset: "Tri-Party GC", notional: 420e6, haircutSavings: 8e6, eligibilityGain: 9, rationale: "Move term liquidity risk into secured overnight profile." },
  ];
}

export function getTermFundingCarry(): TermFundingCarry[] {
  const notionals = [6.5e9, 4.8e9, 3.6e9, 2.2e9];
  const rows: Omit<TermFundingCarry, "monthlyPnl">[] = [
    { tenor: "O/N", fundingBps: 431, reinvestYieldBps: 434, carryBps: 3, cut25CarryBps: 1, balanceSheetCostBps: 8 },
    { tenor: "1M", fundingBps: 438, reinvestYieldBps: 448, carryBps: 10, cut25CarryBps: 8, balanceSheetCostBps: 10 },
    { tenor: "3M", fundingBps: 426, reinvestYieldBps: 454, carryBps: 28, cut25CarryBps: 25, balanceSheetCostBps: 13 },
    { tenor: "6M", fundingBps: 412, reinvestYieldBps: 462, carryBps: 50, cut25CarryBps: 44, balanceSheetCostBps: 18 },
  ];
  return rows.map((r, i) => ({
    ...r,
    monthlyPnl: (notionals[i] * (r.carryBps - r.balanceSheetCostBps)) / 10000 / 12,
  }));
}

export function getPolicyTransmission(): PolicyTransmission[] {
  return [
    { module: "REINV", pathInput: "Implied EFFR path", currentImpact: "Cash collateral carry reprices lower as cuts arrive.", shock25bp: -2.1e6, shock100bp: -8.4e6, action: "Shorten reset profile and protect T+0 liquidity." },
    { module: "CASH", pathInput: "SOFR funding curve", currentImpact: "Funding cost falls, but repo squeeze basis can offset cuts.", shock25bp: 2.8e6, shock100bp: 10.6e6, action: "Keep term repo capacity for event windows." },
    { module: "COLL", pathInput: "Curve plus credit OAS", currentImpact: "Lower rates help HQLA carry; credit widening raises haircut drag.", shock25bp: 0.9e6, shock100bp: 2.7e6, action: "Prefer HQLA substitutions when OAS widens." },
    { module: "OPT", pathInput: "Forward rates and shadow prices", currentImpact: "Solver should reprice funding, liquidity and balance-sheet penalties.", shock25bp: 3.2e6, shock100bp: 11.8e6, action: "Run policy-path scenario before allocation approval." },
  ];
}

export function getCalendarSensitivity(name: string, category: string): CalendarSensitivityTag[] {
  const text = `${name} ${category}`.toLowerCase();
  if (text.includes("cpi") || text.includes("pce") || text.includes("ppi") || text.includes("inflation")) return ["Rates P&L", "Funding Liquidity", "Margin Risk"];
  if (text.includes("fomc") || text.includes("policy") || text.includes("auction")) return ["Rates P&L", "Funding Liquidity"];
  if (text.includes("payroll") || text.includes("claims") || text.includes("unemployment") || text.includes("jolts") || text.includes("labor")) return ["Borrow Demand", "Margin Risk"];
  if (text.includes("retail") || text.includes("ism") || text.includes("gdp") || text.includes("activity") || text.includes("growth")) return ["Borrow Demand", "Haircut Risk"];
  if (text.includes("housing") || text.includes("consumer")) return ["Margin Risk"];
  return ["Funding Liquidity"];
}

export function getReleaseMoveSummaries(): ReleaseMoveSummary[] {
  return [
    { release: "Core CPI", factor: "2Y Treasury", preMoveBps: 4, postMoveBps: 12, deskImpact: "Rates P&L" },
    { release: "Nonfarm Payrolls", factor: "HY OAS", preMoveBps: -3, postMoveBps: 18, deskImpact: "Borrow Demand" },
    { release: "FOMC Decision", factor: "SOFR-EFFR", preMoveBps: 2, postMoveBps: 9, deskImpact: "Funding Liquidity" },
    { release: "Core PCE", factor: "IG OAS", preMoveBps: 1, postMoveBps: 7, deskImpact: "Haircut Risk" },
    { release: "Initial Claims", factor: "Equity vol proxy", preMoveBps: 6, postMoveBps: 16, deskImpact: "Margin Risk" },
  ];
}
