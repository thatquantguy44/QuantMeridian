# Squeeze Radar — Production Specification

**Status:** Production Design | **Owner:** Securities Finance  
**Tier:** B (Live Feed Exception) | **Data Classification:** Real-time Microstructure

---

## 1. Overview

The Squeeze Radar detects short-squeeze and borrow-demand stress across the equity universe by aggregating real-time borrow supply, short positioning, options sentiment, and ETF flows. It surfaces candidates for:
- Securities finance desks (recall risk, re-rate opportunities, collateral stress)
- Equity prime brokerage (utilization pressure, fee momentum)
- Quant strategies (crowding, reversal signals, volatility regime changes)

**Rationale for Tier B:** Borrow/short microstructure is real-time market data (not a series), live-updated, and non-reproducible post-facto. Unlike series data (FRED, pricing), borrow fees and SI change continuously and have no historical DB layer in the terminal's architecture.

---

## 2. Core Data Model

### 2.1 Squeeze Board Row

Each security on the board has **36 fields**:

```typescript
interface SqueezeRadarRow {
  // ── Identifiers (static) ────────────────────
  ticker: string;                  // e.g., "GME", "TSLA", "SPY"
  name: string;                    // e.g., "GameStop Corp."
  sector: string;                  // e.g., "Discretionary", "Technology"
  assetClass: "EQUITY" | "ETF";   // Classification
  cusip: string;                   // Unique identifier
  isin: string;                    // International identifier

  // ── Borrow Supply & Cost ────────────────────
  utilization: number;             // % (0-100): available shares / lendable supply
  utilizationChange1d: number;     // % point change
  utilizationChange5d: number;     // % point change
  
  feeBps: number;                  // bps: current borrow fee (annualized)
  feeMom5: number;                 // % change in fee, 5d
  feeMom20: number;                // % change in fee, 20d
  feeHist: number[];               // [20-day history] bps, oldest → newest
  feeMin52w: number;               // bps: 52-week minimum fee
  feeMax52w: number;               // bps: 52-week maximum fee
  feePctile: number;               // 0-100: percentile vs. all stocks

  classification: "GC" | "WARM" | "SPECIAL" | "HTB";  // Borrow classification
  classificationChange: string;    // "↑ WARM→SPECIAL", "stable", "↓ SPECIAL→WARM"

  // ── Short Positioning ────────────────────────
  shortInterestPct: number;        // % of float (self-reported, 15d lag)
  shortInterestChange1d: number;   // % point change
  shortInterestChange5d: number;   // % point change
  daysToCover: number;             // trading days: SI / avg daily volume
  shortInterestRank: number;       // 0-100: percentile in universe
  
  // ── Options & Vol ────────────────────────────
  putCallRatio: number;            // PCR: put volume / call volume
  impliedVolRank: number;          // 0-100: IV percentile vs. 1y history
  volatility30d: number;           // % annualized realized vol
  skew25d: number;                 // vol pts: 25-delta put vol - call vol
  skewChange5d: number;            // vol pts change
  openInterestChange: number;      // % change in OI, 5d

  // ── Stock Price Action ───────────────────────
  price: number;                   // USD: last trade price
  priceChg1d: number;              // %
  priceChg5d: number;              // %
  priceChg20d: number;             // %
  priceChg52w: number;             // %
  volatility: number;              // % annualized (daily returns)

  // ── ETF-Specific ─────────────────────────────
  etfFlowNet1d: number | null;     // $ mm: create - redeem, 1d
  etfFlowNet5d: number | null;     // $ mm: net flows, 5d
  etfFlowPctAUM: number | null;    // % of AUM
  etfHoldings: number | null;      // number of holdings (for sector ETFs)
  etfEstimatedDiscount: number | null; // bps: NAV - market price

  // ── Composite Signals ────────────────────────
  heat: number;                    // 0-100: borrow stress composite
  heatDirection: "HEATING" | "COOLING" | "STABLE";  // 5d fee momentum
  attentionScore: number;          // 0-100: media, social, unusual activity
  squeezeScore: number;            // 0-100: (SI + DTC + fee momentum + price)
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

  // ── Metadata ─────────────────────────────────
  source: "LIVE";                  // Always "LIVE" for Tier B
  asOf: string;                    // ISO 8601: timestamp of last refresh
  staleness: number;               // seconds since last update
  confidence: number;              // 0-100: data freshness/quality score
}
```

---

## 3. Data Sources & Refresh Cadence

### 3.1 Real-Time (Sub-Minute)

| Field | Source | Latency | SLA |
|-------|--------|---------|-----|
| `price` | IEX/Polygon/Alpaca WebSocket | <1s | 99.9% uptime |
| `feeBps` | IB API / Alpaca Borrow Rates API | 1-5s | 99% uptime |
| `utilization` | IB utilization feed / Alpaca | 1-5s | 99% uptime |
| `classification` | Derived from fee tiers (local) | <1s | N/A |
| `putCallRatio` | CBOE / Polygon options stream | 5-15s | 99% uptime |
| `impliedVolRank` | Derived from option chains | 5-15s | N/A |

### 3.2 Daily Batch (After Market Close)

| Field | Source | Latency | SLA |
|-------|--------|---------|-----|
| `shortInterestPct` | FINRA short sale volume (Fridays); Ortex API | 2-10 days | 99.5% |
| `daysToCover` | Calculated: SI / avg daily vol | Daily | N/A |
| `shortInterestRank` | Derived from SI universe | Daily | N/A |
| `priceChg1d`, `priceChg5d` | EOD pricing feeds | <5 min after close | 99.9% |
| `etfFlowNet*` | ETF.com API / Morningstar | 1-3 days | 95% |
| `etfEstimatedDiscount` | (ETF price - NAV) from IEX | 15-30 min after open | 99% |
| `volatility30d` | Calculated: rolling std dev of returns | Daily | N/A |

### 3.3 Manual Overrides / Expert Feed (Weekly)

| Field | Source | Cadence |
|-------|--------|---------|
| `assetClass` | Internal universe DB | On change |
| `sector` | Compustat / Bloomberg classification | Quarterly |
| `cusip`, `isin` | FactSet / Refinitiv identity | On change |
| `etfHoldings` | iShares/Vanguard documentation | Quarterly |

---

## 4. Data Quality & Freshness Requirements

### 4.1 Thresholds

```typescript
interface DataQualitySLA {
  price: {
    maxStaleness: 60,        // seconds; refresh every 30s if live
    missingOk: false,        // fail fast if no price
    backfill: "previous-close"
  },
  feeBps: {
    maxStaleness: 300,       // seconds; check every 5m
    missingOk: true,         // use cached value if API down
    backfill: "cache"
  },
  shortInterestPct: {
    maxStaleness: 7 * 86400, // 7 days; weekly update from FINRA
    missingOk: true,         // use stale SI rather than zero
    backfill: "prior-report"
  },
  utilization: {
    maxStaleness: 300,       // seconds; check every 5m
    missingOk: true,         // graceful degrade if IB down
    backfill: "cache"
  },
  etfFlow: {
    maxStaleness: 3 * 86400, // 3 days; flow data lags by 1-2d
    missingOk: true,         // null if missing
    backfill: null
  }
}
```

### 4.2 Confidence Score Calculation

```typescript
confidence = (
  (1 - staleness_penalty[feeBps]) * 0.35 +        // borrow data critical
  (1 - staleness_penalty[shortInterestPct]) * 0.25 + // SI critical
  (1 - staleness_penalty[price]) * 0.20 +          // price critical
  (1 - staleness_penalty[putCallRatio]) * 0.12 +   // options helpful
  (1 - staleness_penalty[etfFlow]) * 0.08           // flow nice-to-have
) * 100
```

Where `staleness_penalty[field] = clamp(current_staleness / maxStaleness, 0, 1)`

---

## 5. Calculation Methodologies

### 5.1 Heat Score (Borrow Stress Composite)

```typescript
heat = clamp(
  0.35 * utilization +                           // supply pressure
  0.25 * feePctile +                             // cost rank
  0.15 * clamp(50 + feeMom20 * 1.2) +           // momentum
  0.15 * clamp(50 + shortInterestPct * 2.0) +   // SI pressure
  0.10 * attentionScore                          // crowding
)
```

**Direction Logic:**
- `HEATING`: feeMom5 > +5%
- `COOLING`: feeMom5 < -5%
- `STABLE`: -5% ≤ feeMom5 ≤ +5%

### 5.2 Squeeze Score (Squeeze Risk Composite)

```typescript
squeezeScore = clamp(
  0.40 * clamp(shortInterestPct * 2.5) +       // SI intensity
  0.30 * clamp(daysToCover * 8) +              // DTC (low = risky)
  0.20 * clamp(50 + feeMom5 * 2.0) +           // accelerating cost
  0.10 * clamp(50 + priceChg5d * 6)            // price momentum
)
```

### 5.3 Attention Score (Microstructure Consensus)

```typescript
attentionScore = clamp(
  0.40 * options_unusual_activity +            // OI spikes, skew extremes
  0.30 * social_media_volume +                 // WSB, StockTwits mentions
  0.20 * news_momentum +                       // recent headlines
  0.10 * institutional_flow_divergence         // if available
)
```

---

## 6. Derivative Views

### 6.1 Specials Watch
```typescript
// Names crossing to SPECIAL/HTB with fee momentum
filter: classification ∈ {SPECIAL, HTB}
sort_by: feeBps DESC
limit: 20 rows
freshness: real-time
```

### 6.2 Squeeze Candidates
```typescript
// High SI + high DTC + accelerating fees + price up
filter: {
  shortInterestPct >= 12,
  daysToCover >= 3,
  feeMom5 > 0,
  priceChg5d > -2  // not already crashed
}
sort_by: squeezeScore DESC
limit: 15 rows
freshness: daily (SI is bottleneck)
```

### 6.3 Re-Rate Candidates
```typescript
// Specials that are cheap relative to demand
filter: {
  classification = SPECIAL,
  utilization >= 80,
  feeBps < 150,      // outlier cheap
  feeMom20 > 0       // demand rising
}
sort_by: utilization DESC
limit: 12 rows
freshness: real-time
```

### 6.4 Sector Heat
```typescript
// Aggregated borrow stress by sector
agg: {
  avgHeat: mean(heat),
  avgUtil: mean(utilization),
  count: |securities|,
  topTicker: max(heat)
}
sort_by: avgHeat DESC
freshness: real-time (aggregation only)
```

---

## 7. API Contract

### 7.1 GET /api/securities-finance/squeeze

**Exception to DB-only policy** — real-time borrow/short microstructure feed  
See GOLD_DB_MIGRATION_HANDOFF §7 D1.

**Query Parameters:**
```
?view=board          // full squeeze board (all equity + ETF)
?view=specials       // SPECIAL/HTB watch
?view=squeezes       // squeeze candidates
?view=rerates        // re-rate candidates
?view=sector         // sector aggregates
?limit=50            // default 50, max 500
?sort=heat|squeeze|fee|utilization|si
?filter=sector:Technology,Discretionary
?filter=classification:HTB,SPECIAL
```

**Response:**
```typescript
{
  source: "LIVE",
  asOf: "2026-09-14T14:32:45Z",
  staleness: 3,              // seconds since last refresh
  confidence: 94,            // 0-100 data quality score
  rowsReturned: 47,
  rowsTotal: 4812,           // total in universe
  
  data: [SqueezeRadarRow[], ...],
  
  metadata: {
    lastFeeFetch: "2026-09-14T14:32:42Z",
    lastSIFetch: "2026-09-12T22:00:00Z",        // FINRA (3 days ago)
    lastFlowFetch: "2026-09-13T16:30:00Z",      // ETF.com (1 day ago)
    dataQualityIssues: [
      "IB borrow API degraded 14:15-14:30 (15 min outage); using cache",
      "Ortex SI delayed by 5 days (holiday weekend)"
    ]
  },
  
  alerts: [
    {
      ticker: "GME",
      trigger: "Fee momentum spike",
      detail: "borrow fee +42% in 5d → 385bps",
      severity: "HIGH",
      asOf: "2026-09-14T14:30:00Z"
    },
    ...
  ]
}
```

---

## 8. Production Requirements

### 8.1 Infra & Availability

| Requirement | Target | Implementation |
|-------------|--------|-----------------|
| Availability | 99% during market hours | Multi-source fallback; cache on API down |
| Latency (p95) | <2s full board, <200ms single lookup | In-memory cache; lazy compute |
| Concurrent Users | 500 concurrent requests | Cached board + rate limiting |
| Storage | ~5MB in-memory, 100MB historical | SQLite for rolling 52w history |
| Update Frequency | Real-time for borrow/price, daily for SI | Event-driven + scheduled jobs |

### 8.2 Error Handling & Fallbacks

```typescript
// Tier 1: Live data success
if (feeBps.fresh && utilization.fresh) return LIVE

// Tier 2: Cached data if live down
else if (feeBps.cached && age < 5m) return CACHED with warning

// Tier 3: Return previous day's board if all sources down
else if (board.yesterday && hour < 16:30) return STALE with error

// Tier 4: Degrade gracefully
else {
  heat.recalc(utilization=null, feeBps=cache)
  confidence -= 25
  return DEGRADED with data_quality_issue
}
```

### 8.3 Alert Triggers

```typescript
// Fire immediately (sub-second)
if (feeMom5 >= 25%) alert("Fee acceleration critical", "HIGH")
if (utilization > 95% && classification change) alert("Approaching HTB", "MEDIUM")

// Daily batch (after SI update)
if (shortInterestPct > 20%) alert("Elevated squeeze risk", "MEDIUM")

// Threshold crossings
if (heat > 75) alert("Borrow heat critical", "HIGH")
if (squeezeScore > 80) alert("Squeeze conditions active", "MEDIUM")
```

---

## 9. Integration Points

### 9.1 Upstream Data Feeds

- **Interactive Brokers** → Borrow fee/utilization (websocket)
- **Alpaca Markets** → Borrow rates, stock price (API + websocket)
- **CBOE / Polygon.io** → Options chains, IV (REST API)
- **FINRA** → Short sale volume (weekly, REST)
- **Ortex / S3 Partners** → Short interest depth (REST, cached daily)
- **ETF.com API** → ETF flows (REST, daily)
- **Yahoo Finance / IEX** → Fallback pricing (REST)

### 9.2 Downstream Usage

- **SQZ UI page** → Real-time board, alerts, derived views
- **ALRT module** → Squeeze heat alerts for notifications
- **HOME (desk KPIs)** → Sector heat summaries
- **Market-Lens** → Borrow/SI as factor inputs
- **Risk engine** → Collateral stress (HTB recall risk)
- **Reporting** → Daily squeeze review, heatmap archives

---

## 10. Historical Archive & Backtesting

### 10.1 Storage Strategy

```typescript
// Daily snapshots (12 months rolling)
table squeeze_board_daily {
  date: "2026-09-14",
  ticker: "GME",
  heat: 87,
  squeeze_score: 92,
  fee_bps: 385,
  utilization: 94,
  short_interest_pct: 28.3,
  days_to_cover: 6.4,
  ...
}

// Weekly summaries (5 years rolling)
table squeeze_sector_weekly {
  week_ending: "2026-09-12",
  sector: "Discretionary",
  avg_heat: 62,
  hot_names: ["GME", "AMC", "BB"],
  ...
}
```

### 10.2 Backtesting / Analysis

```python
# Research query: which "squeeze candidates" actually squeezed?
df = db.query("""
  SELECT 
    ticker,
    date,
    squeeze_score,
    price_chg_5d_fwd,
    realized_vol_fwd
  FROM squeeze_board_daily
  WHERE squeeze_score > 80
    AND date BETWEEN '2025-01-01' AND '2026-09-14'
  ORDER BY date DESC
""")

# Win rate, correlation with price outcome
```

---

## 11. Monitoring & Alerting

### 11.1 Operational Health Checks

```
/metrics/squeeze-radar:
  feed_latency_p95: <2s ✓
  data_staleness: max(feeBps_age, SI_age) < 5min
  confidence_score: >85 ✓
  error_rate: <0.1% ✓
  api_response_time: <500ms ✓
```

### 11.2 Data Quality Alerts

- **SI hasn't updated in >10 days** → Page ops, check FINRA feed
- **Borrow fees stale >30m** → Page ops, check IB/Alpaca API
- **Confidence score <70** → Warn in UI, mark data as unreliable
- **Divergence between sources** (fee outliers) → Investigate source

---

## 12. Phased Implementation

### Phase 1: MVP (Month 1)
- [ ] Ingest IB borrow fee + utilization (real-time)
- [ ] Daily FINRA SI batch
- [ ] Price from Alpaca
- [ ] Heat + squeeze scores
- [ ] Basic board view

### Phase 2: Options & ETF (Month 2)
- [ ] Options PCR, IV rank from Polygon
- [ ] ETF flow integration
- [ ] Sector aggregates

### Phase 3: Attention & Advanced Signals (Month 3)
- [ ] Social volume (StockTwits, WSB API)
- [ ] News sentiment
- [ ] Derivative views (specials watch, re-rates)

### Phase 4: Archive & Backtesting (Month 4)
- [ ] Daily snapshot storage
- [ ] Historical research queries
- [ ] Backtesting on squeeze outcomes

---

## 13. Success Criteria

- ✓ Board loads <2s with 99% uptime during market hours
- ✓ Squeeze candidates actually squeeze 30%+ of the time (backtested)
- ✓ SEC-trader feedback: "Catches re-rate opps before they're obvious"
- ✓ Desk uses it daily; integrated into morning workflow
- ✓ <5 false alerts per week (noise level acceptable)
