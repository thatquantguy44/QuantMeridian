# VIX Implied vs Forward Returns (VIXR): help and FAQ

> Gold data only. The headline statistics are in-sample; the Out-of-sample test panel checks them in real time. Read the [white paper](/guides/VIXR/whitepaper) for the method and reference results.

## Quick start

1. Open [VIX Implied vs Forward](/market-volatility/implied-vs-forward). The badge should read `DB`.
2. Read the **Readout** panel: one line each on magnitude, calibration, tails and direction.
3. Look at the **scatter**: dots between the green curves landed inside the VIX's ±1σ move.
4. Switch **Since 2008** and **Before 2008** to see whether the result holds in both halves of the history.
5. Switch to **Daily** sampling for more points; the statistics correct for the overlap.
6. Scroll to **Out-of-sample test** to see whether a forecast built only from past windows would have worked.
7. Use the **CSV** buttons to take the windows, buckets or forecasts into a spreadsheet.

## Screen guide

### Header

| Element | Meaning |
|---|---|
| `VIXR` / VIX Implied vs Forward Returns | Module code and name |
| **Guide** | Opens this help and the white paper |
| `DATA AS OF` | Date of the last VIX close in Gold |
| `DB` / `ERR` badge | Gold data loaded, or the read failed (no simulated fallback). A freshness tag appears when the load is behind. |
| Basis tag | `SPY PX`, `SPY TR` or `SPX`: the series the returns are measured on |
| Sampling tag | `non-overlapping` or `daily overlapping` |

### KPI strip

| Stat | Meaning |
|---|---|
| Latest VIX | Newest VIX close; underneath, its ±1σ move and the date 30 days out |
| Inside ±1σ | Share of windows whose move stayed within the implied 1σ; the normal benchmark is 68.27%. Green when the whole interval is above it. |
| Beyond −2σ | Share that fell more than twice the implied move (normal 2.28%); red when above normal |
| Realized ÷ Implied | Mean realized volatility over mean VIX; underneath, the mean premium in vol points |
| Magnitude R² | Share of next-30-day realized volatility the VIX explains; underneath, the same for trailing 30-day volatility |
| Direction | Percent forward return per VIX point, with its Newey–West t and R² |
| Out-of-sample skill | The recalibrated VIX's out-of-sample R² against the historical mean, with the number of test windows underneath. Green when positive. |
| Sample | Windows used, the approximate number of independent windows, and the years covered |

### Controls panel (`CTRL`)

| Control | Meaning | Default |
|---|---|---|
| **SPY price (1993+)** | SPY close without dividends: closest long-history match to the S&P 500 price index | Selected |
| **SPY total return (1993+)** | SPY with dividends reinvested | |
| **S&P 500 index (FRED, 2016+)** | The index itself; FRED publishes only ten years | |
| **Non-overlapping** / **Daily** | Back-to-back independent windows, or one window per trading day | Non-overlapping |
| **VIX levels** / **Quintiles** | Fixed VIX bands, or five equal-count groups from the selected sample | VIX levels |
| **Full history**, **Since 2008**, **Last 10Y**, **Before 2008** | Date presets; highlighted when the From/To dates match one | Full history |
| **From** / **To** | Window start dates to include; blank means no limit | Blank |

### Readout panel (`EDGE`)

Tags for the magnitude grade (strong, moderate, weak, none), whether there is a directional tilt, and whether the VIX overstated or understated volatility. Then four plain-language findings and the method notes: overlap handling, in-sample only, zero-drift assumption. A small-sample warning appears when there are fewer than 30 independent windows.

### Implied move vs realized 30-day return panel (`SCAT`)

| Element | Meaning |
|---|---|
| x axis | VIX-implied 1σ 30-day move, % |
| y axis | Realized 30-day return, % |
| Green curves | ±1σ price band, exp(±σ) − 1 |
| Violet dashed curves | ±2σ band |
| Dot colors | Blue inside 1σ, amber between 1σ and 2σ, red beyond 2σ |

Daily mode draws at most 2,500 evenly spaced dots; every window still counts in the statistics.

### Implied ±1σ band vs outcome over time panel (`CONE`)

The shaded band is the ±1σ move implied on each date. The line is the return that followed, plotted on the window's start date. Dots mark windows outside the band (amber above, red below).

### Standardized move distribution panel (`DIST`)

A histogram of z (the 30-day log move ÷ implied 1σ) in half-sigma bins, with the outer bins collecting everything beyond ±4. The dashed curve is the count a standard normal would give. The footer lists the standard deviation of z (1.00 if the VIX were exact), its mean, its excess kurtosis and the ±2σ share. Hover a bar for its counts.

### VIX vs subsequent realized volatility panel (`VRP`)

The VIX (orange) and the volatility realized over the following 30 days (blue), both in vol points, plotted on the start date. The footer gives the share of windows where the VIX was higher, the mean premium and the median ratio.

### Regressions panel (`REG`)

| Row | Meaning |
|---|---|
| Realized vol ~ VIX | Mincer–Zarnowitz test. The note shows t for β = 1: a value beyond ±2 says the VIX is a biased forecast. |
| Realized vol ~ trailing 30d vol | The naive benchmark. The note gives the VIX's R² on the same dates for a fair comparison. |
| Absolute return ~ implied move | Whether bigger implied moves came with bigger actual moves; the note gives the Spearman rank correlation |
| Return ~ VIX | Direction: percent return per VIX point |

Columns are α, β, t(β) (green when abs(t) ≥ 2), R² and n. The subtitle gives the Newey–West lag.

### Forward returns by VIX bucket panel (`BKT`)

| Column | Meaning |
|---|---|
| VIX bucket | Band or quintile of the VIX on the window's start date |
| n | Windows in the bucket |
| Avg VIX / Implied ±1σ | Mean level and mean implied move |
| Mean fwd / % up | Mean 30-day return and share of positive windows |
| Realized ÷ implied | Below 1 (blue) the VIX overstated what followed; above 1 (amber) it understated |
| Inside ±1σ | Calibration within the bucket |
| Median fwd / Mean abs move | Median return and mean absolute return |
| Worst / Best | Extremes in the bucket |

The **Mean 30-day return by bucket** panel (`BAR`) charts the mean column with n under each bar.

### Out-of-sample test panel (`OOS`)

Fits each forecast only on windows whose 30 days had finished before the test date (an expanding window), then scores it on the next window.

| Element | Meaning |
|---|---|
| Findings | Plain-language results for volatility forecasts, the comparison with trailing volatility, and return forecasts |
| Cumulative advantage chart | Running sum of squared error saved against the historical-mean forecast, in vol points². Rising means the model keeps adding information. |
| RMSE, MAE | Typical forecast error in vol points (volatility rows) or percent (return rows) |
| Bias | Average forecast minus average outcome. A positive number means the forecast ran high. |
| Skill vs mean | 1 − MSE(model) ÷ MSE(benchmark); positive means it beat the historical mean. Green when positive. |
| DM t vs mean / vs trailing | Diebold–Mariano t on squared error. Below −2 means a significantly smaller error than the comparison forecast. |
| **CSV** | One row per test window with the outcome and all six forecasts |

The forecasts: the VIX as quoted, the VIX recalibrated by an expanding regression (a + b × VIX), trailing 30-day realized volatility, and the expanding historical mean, plus a return forecast from a VIX regression against the historical mean return. Testing starts after 60 non-overlapping windows or 504 daily windows. With fewer, the panel says so instead of showing numbers.

### CSV buttons

Three panels have a **CSV** button: the scatter (all windows in the current selection), the bucket table and the out-of-sample test. Each file starts with `#` comment lines giving the source, basis, sampling, date range and data-as-of date, so a saved file explains itself. Files follow the controls: change the date range or sampling first, then download.

### Formulas panel (`FORM`)

Twelve collapsible sections with every formula the module evaluates, rendered as typeset math: notation, the implied move and band, forward return, realized and trailing volatility, calibration and Wilson intervals, the Newey-West regressions, the grade rules and the out-of-sample test. Each section has a **LaTeX source** toggle and a **Copy** button. **Copy all LaTeX** and **Download .tex** give the whole sheet; the file compiles with pdflatex. The same content is in the white paper's Formulas section, generated from one source file so the two stay identical.

### Data and method panel (`SRC`)

Input coverage and row counts, window diagnostics (windows built, index dates without a VIX, windows still open, data gaps, invalid rows), any warnings, the method in brief and links to the sources.

## Assumptions and defaults

| Item | Value |
|---|---|
| Horizon | 30 calendar days, matching the VIX definition |
| Implied 1σ | VIX × √(30/365) |
| Realized vol | √(252 × mean squared daily log return) |
| Gap rule | A window whose last close is more than 5 days before its target is dropped |
| Overlap handling | Daily: Newey–West 21 lags, effective n = n ÷ 21. Non-overlapping: Newey–West 3 lags. |
| Minimum sample | 10 windows |
| Out-of-sample warm-up | 60 non-overlapping windows or 504 daily windows before the first test; at least 10 test windows |
| Inputs you can change | Basis, sampling, buckets and date range; nothing else |

## FAQ

### So is the VIX predictive?
For **how much** the market will move, yes, partly. It explains roughly half of next-month realized volatility and beats last month's volatility as a forecast. But it is biased high: realized volatility averaged about 80% of the VIX. For **which way** the market moves, no. The slope is small and usually not significant.

### Why does the VIX overstate volatility?
Investors pay a premium for protection against crashes, so index options trade above the volatility that usually follows. That gap is the variance risk premium. It is compensation for the rare windows where realized volatility jumps far above the VIX (the blue spikes in `VRP`).

### If moves stay inside ±1σ 85% of the time, why is kurtosis so high?
Most months are calmer than the VIX implies, which narrows the middle of the distribution. A few crashes (1998, 2008, 2020) land far out in the tails. Both happen at once, which is what fat tails mean.

### High-VIX buckets show the best average returns. Isn't that a buy signal?
Treat it with care. Those buckets have few independent windows, and their averages lean on a few rebounds after crashes, such as 2009 and 2020. The direction regression puts that pattern in context; check its t-statistic and the bucket n before acting.

### Why do Daily and Non-overlapping give slightly different numbers?
They sample different windows. Daily uses every start date, which smooths the averages but repeats information; non-overlapping uses about 12 independent windows a year. Grades can flip near a boundary: R² is 52% (strong) daily and 49% (moderate) non-overlapping on full history.

### Why SPY rather than the S&P 500 index?
FRED licenses only the latest ten years of the index. SPY tracks it closely back to 1993. Pick the FRED index to confirm the proxy over the years where both exist.

### Why doesn't the latest VIX appear in the scatter?
Its 30-day window has not finished. The latest reading is in the KPI strip with its implied band and horizon date.

### How is realized volatility calculated?
For each 30-day window, take the daily log returns, square them, average them, and annualize:

RV = 100 × √( 252 × (1/N) × Σ ln(P_k ÷ P_(k−1))² )

where N is the number of trading days in the window, usually 21 or 22. Returns are not demeaned. Worked example with five trading days (a real window has about 21):

| Day | Close | Daily log return | Squared |
|---|---|---|---|
| 0 | 100.00 | | |
| 1 | 101.00 | +0.00995 | 0.0000990 |
| 2 | 99.50 | −0.01496 | 0.0002238 |
| 3 | 100.50 | +0.01000 | 0.0001000 |
| 4 | 100.00 | −0.00499 | 0.0000249 |
| 5 | 101.50 | +0.01489 | 0.0002217 |

The squares sum to 0.0006694, so the mean is 0.00013388. Then RV = 100 × √(252 × 0.00013388) = 100 × 0.18367 = **18.4 vol points**. If the VIX had been 22 at the start, the realized ÷ implied ratio for this window would be 18.4 ÷ 22 = 0.84. The 0.82 on the page is the same ratio computed on the averages across every window: mean realized volatility ÷ mean VIX.

### Why does the realized-volatility formula use squares rather than absolute returns?
Squared returns give a variance, and the square root of the average is a standard deviation, which is the same quantity the VIX measures. Absolute returns would measure something related but on a different scale.

### Does the VIX forecast volatility out of sample, not just in hindsight?
Yes, mostly. Using only information available at the time, the VIX recalibrated for its upward bias explained about half the variation in the next month's volatility and beat the naive trailing-volatility forecast with statistical significance. As a forecast of the direction of returns it added nothing. See the Out-of-sample test panel and the white paper's reference results.

### Why is "VIX recalibrated" better than the VIX as quoted?
The VIX runs about 3.5 vol points above what follows, so a forecast that subtracts that gap beats the raw number. The recalibration is learned only from past windows, so it is a fair real-time test. It can still miss when conditions change: in the 2007–09 excerpt, a calibration learned in calm years did worse than the raw VIX during the crash.

### Can I export the data?
Yes. The **CSV** buttons on the scatter, bucket and out-of-sample panels download the current selection with provenance comments at the top. The underlying series are also in Gold (`VIXCLS`, and `SPY` in `equity_total_return_index`).

## Troubleshooting

| Symptom | Meaning and fix |
|---|---|
| `ERR` badge with "MACRO_DB_URL not configured" | The terminal has no Gold connection. Set `MACRO_DB_URL` in `.env.local` and restart. |
| "No Gold observations found for …" | The series is missing from Gold; run the macro ETL for `VIXCLS` or the equity load for `SPY`. |
| "Not enough observations in this range" | Fewer than 10 windows; widen the dates or switch to Daily. |
| Freshness tag (for example `STALE · 17D`) | The Gold load is behind; the statistics are correct up to the as-of date. |
| S&P 500 index starts in 2016 | Expected: FRED's licence limit. |
| A regression shows "not enough variation" | The VIX barely changed in the selected range. |
| "Not enough history for an out-of-sample test" | The selection has fewer prior windows than the warm-up needs. Widen the dates or switch to Daily. |
| **CSV** button greyed out | Nothing to export for this selection, or (for forecasts) not enough history for the out-of-sample test. |

## Glossary

| Term | Meaning |
|---|---|
| VIX | Cboe index of expected 30-day S&P 500 volatility, annualized, from option prices |
| Implied move | The 1σ move the VIX implies over 30 days: VIX × √(30/365) |
| Realized volatility | Annualized standard deviation of daily returns that actually occurred |
| z | A move measured in implied standard deviations |
| Variance risk premium | VIX minus the volatility that followed |
| Mincer–Zarnowitz regression | Regressing outcomes on a forecast; an unbiased forecast has intercept 0 and slope 1 |
| Newey–West errors | Standard errors that allow for overlapping or autocorrelated observations |
| Effective sample | Approximate number of independent windows behind a statistic |
| Excess kurtosis | Tail heaviness relative to a normal distribution (0 for a normal) |
| Out-of-sample | Scored on data the model was not fitted on; here, fitted only on windows finished before the test date |
| Expanding window | Training set that grows over time, always starting from the first window |
| Skill (out-of-sample R²) | 1 − MSE(model) ÷ MSE(benchmark); positive beats the benchmark |
| Diebold–Mariano test | Test of whether two forecasts have equal squared error, with errors adjusted for overlap |
| RMSE / MAE | Root mean squared error / mean absolute error |

See also the [VIXR white paper](/guides/VIXR/whitepaper).
