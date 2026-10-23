# VIX Implied vs Forward Returns (VIXR): white paper and business guide

> **Status:** live on Gold data (VIX from 1990, SPY from 1993). Research context only: the headline statistics are in-sample, an expanding-window out-of-sample test is included, and nothing on the page is a trading signal.

## Executive summary

The VIX is the options market's estimate of how much the S&P 500 will move over the next 30 days. VIXR checks that estimate against what actually happened, on every trading day since 1993.

On each date the VIX implies a one-standard-deviation 30-day move of **VIX × √(30/365)**: a VIX of 20 implies about ±5.7%. The module pairs that implied move with the S&P 500's actual return over the next 30 calendar days and asks three questions:

1. **Calibration:** did the realized move land inside ±1σ about 68% of the time, as a normal distribution would?
2. **Magnitude:** does a higher VIX forecast bigger moves and higher realized volatility, and does it beat simply using last month's volatility?
3. **Direction:** does the VIX level say anything about whether the market goes up or down?

Over 1993–2026, using non-overlapping SPY windows:

- **Magnitude:** the VIX is an informative but biased volatility forecast. It explains about half the variation in the next month's realized volatility, more than trailing volatility does.
- **Calibration:** it overstated the coming move most of the time. Realized volatility averaged about 82% of the VIX, and moves stayed inside ±1σ 85% of the time.
- **Direction:** it has no reliable directional signal. High-VIX windows were followed by higher average returns, but the slope is not statistically significant and explains about 2% of return variation. Out of sample it adds nothing.
- **Out of sample:** recalibrated to remove its upward bias, the VIX forecast next-month volatility with about 50% skill and significantly beat trailing volatility.

## Business problem

Desks use the VIX in three ways. They read it as the market's expected move when sizing hedges and stops. They read it as a risk-off gauge. And they read it as a contrarian buy signal when it spikes. Each use rests on a claim about prediction that can be tested on history:

| Use | Claim being tested | Where VIXR tests it |
|---|---|---|
| Expected-move sizing | The VIX is a fair forecast of the 30-day move | Calibration, realized ÷ implied |
| Volatility forecasting | A higher VIX means more volatility ahead | Realized vol ~ VIX regression, benchmark against trailing vol |
| "Buy when VIX is high" | High VIX predicts higher returns | Return ~ VIX regression, bucket table |
| Tail planning | Crashes beyond 2σ are rare | Tail shares and the z distribution |

A sizing rule that treats the VIX as exact will sit, on average, about 20% too wide. A contrarian rule built on bucket averages may simply be reading a few crisis rebounds.

## How it works

### Windows

For each trading day *t* with both a VIX close and an S&P 500 series close:

- **End date:** the last trading close on or before *t* + 30 calendar days. The VIX itself is defined over 30 calendar days.
- **Incomplete windows:** windows that would run past the end of the data are left out (about the last 21 trading days).
- **Data gaps:** a window whose last close is more than 5 calendar days before its 30-day target is dropped and counted.

### Measures

| Measure | Formula |
|---|---|
| Implied 1σ move | VIX × √(30/365), in log-return percent |
| Price-level band | exp(±σ) − 1 (shown for the latest VIX) |
| Forward return | P(end) ÷ P(t) − 1 |
| Standardized move z | ln(P(end) ÷ P(t)) ÷ implied σ |
| Realized volatility | √(252 × mean of squared daily log returns inside the window) |
| Trailing volatility | The same, over the 30 calendar days before *t* (needs a full lookback) |
| Variance risk premium | VIX − subsequent realized volatility, in vol points |

### Sampling

- **Non-overlapping** (default): start at the first window, then take the first window that starts on or after the previous window's end. Each window is an independent observation, about 12 a year.
- **Daily:** one window per trading day. Neighbouring windows share up to 21 daily returns. That gives the same information many times over, so the statistics correct for it (see below).

### Statistics

| Statistic | Detail |
|---|---|
| Calibration shares | Share with abs(z) ≤ 1, abs(z) ≤ 2, z < −2 and z > 2, against 68.27%, 95.45%, 2.28% and 2.28% for a normal |
| Intervals | Wilson 95% intervals on an effective sample: n for non-overlapping windows, n ÷ 21 for daily |
| Mincer–Zarnowitz | Realized vol = α + β·VIX. An unbiased forecast has α = 0 and β = 1; R² measures informativeness |
| Benchmark | The same regression with trailing 30-day realized vol as the forecast, on the same dates |
| Magnitude of moves | Absolute return regressed on the implied move; Spearman rank correlation of VIX and absolute return |
| Direction | Forward return regressed on the VIX: percent return per VIX point |
| Standard errors | Newey–West (Bartlett kernel): 21 lags for daily windows, 3 for non-overlapping windows, which still share volatility persistence |
| Buckets | VIX levels (under 15, 15–20, 20–25, 25–30, 30–40, 40 and over) or sample quintiles, using the VIX on the window's start date |

### Readout grades

The magnitude grade uses the Mincer–Zarnowitz R², and requires a positive slope with t ≥ 2:

| Grade | R² |
|---|---|
| Strong | 50% or more |
| Moderate | 30–50% |
| Weak | 10–30% |
| None | below 10%, or slope not significant |

The direction readout calls a tilt only when the Newey–West t-statistic is at least 2 in absolute value. The calibration readout calls the VIX overstated or understated when the ±1σ share is more than 3 points from 68.27%.

### Out-of-sample test

The statistics above are in-sample: they describe the history they were fitted on. The out-of-sample panel asks the forward-looking question, "would this have worked in real time?"

- **Expanding window:** for each test window starting on date t, every model is fitted using only windows whose 30 days had finished before t (end date earlier than t). A window that was still open on t is never used, so no forecast sees the future.
- **Warm-up:** testing starts after 60 non-overlapping windows (about five years) or 504 daily windows (about two years), and needs at least 10 test windows.
- **Two targets:** the volatility realized over the next 30 days, and the next 30-day return.

| Forecast | Definition |
|---|---|
| VIX as quoted | The VIX itself |
| VIX recalibrated | a + b × VIX, with a and b fitted on the training windows |
| Trailing 30-day vol | Realized volatility over the 30 days before the date: the naive forecast |
| Historical mean | The average realized volatility in the training windows: the benchmark |
| Return benchmark | The average 30-day return in the training windows |
| Return ~ VIX | A regression of 30-day return on the VIX, fitted on the training windows |

**Skill** is the out-of-sample R², 1 − MSE(model) ÷ MSE(benchmark). Positive means the model beat knowing only the past average; negative means it was worse. Models are compared on identical test windows with a Diebold–Mariano test on squared error, using Newey–West errors (21 lags for daily windows, 3 for non-overlapping). A t-statistic below −2 means a significantly smaller error than the comparison forecast. The chart shows the running sum of squared error saved against the benchmark.

## Formulas

Every formula the module evaluates, in LaTeX. Each block can be pasted into a document; the complete, compilable file is `docs/guides/markets/vixr-formulas.tex`, and the VIXR page has a **Formulas** panel with copy and download buttons. This section is generated from that file.

### Notation

```latex
\begin{itemize}
\item $d_k$ is trading date $k$, with S\&P~500 close $P_k$ and VIX close $V_k$ (VIX points are annualized volatility in \%).
\item $h = 30$ calendar days, the VIX horizon.
\item $e(k) = \max\{\, j : d_j \le d_k + h \,\}$ is the window end index, and $N_k = e(k) - k$ is the number of trading days in the window.
\item $\Phi$ is the standard normal cumulative distribution function.
\end{itemize}
A window is kept only if the data reach $d_k + h$, $e(k) > k$, and the gap $\,(d_k + h) - d_{e(k)} \le 5$ days (a longer gap is a data outage, not a holiday).
```

### Implied move and band

```latex
\begin{align*}
\sigma_k &= V_k \sqrt{\tfrac{30}{365}} \quad \text{(implied one-standard-deviation 30-day log move, in \%)}\\
\text{band}_k^{\pm c} &= 100\left(e^{\pm c\,\sigma_k/100} - 1\right) \quad \text{(price-level band in \%, for } c = 1, 2\text{)}
\end{align*}
The band is read from a single day's VIX; nothing is averaged over time.
```

### Forward return and standardized move

```latex
\begin{align*}
R_k &= 100\left(\frac{P_{e(k)}}{P_k} - 1\right) \quad \text{(forward return, \%)}\\
\ell_k &= 100 \ln\frac{P_{e(k)}}{P_k} \quad \text{(forward log return, \%)}\\
z_k &= \frac{\ell_k}{\sigma_k} \quad \text{(move in implied standard deviations)}
\end{align*}
```

### Realized and trailing volatility

```latex
\begin{align*}
r_j &= \ln\frac{P_j}{P_{j-1}}\\
\mathrm{RV}_k &= 100\sqrt{\frac{252}{N_k}\sum_{j=k+1}^{e(k)} r_j^{2}} \quad \text{(next-30-day realized volatility, vol points; not demeaned)}\\
b(k) &= \min\{\, j : d_j \ge d_k - h \,\}, \qquad M_k = k - b(k)\\
\mathrm{RV}^{\mathrm{trail}}_k &= 100\sqrt{\frac{252}{M_k}\sum_{j=b(k)+1}^{k} r_j^{2}} \quad \text{(requires a full 30-day lookback and } M_k \ge 10\text{)}
\end{align*}
Worked example. With closes $100, 101, 99.5, 100.5, 100, 101.5$ the squared log returns sum to $0.0006694$ over $N=5$ days, so
$\mathrm{RV} = 100\sqrt{252 \times 0.0006694/5} = 18.4$ vol points.
```

### Premium and ratios

```latex
\begin{align*}
\text{premium}_k &= V_k - \mathrm{RV}_k\\
\text{realized-to-implied} &= \frac{\tfrac1n\sum_k \mathrm{RV}_k}{\tfrac1n\sum_k V_k} \quad \text{(ratio of means, as on the KPI strip)}\\
\text{share VIX above realized} &= \frac{100}{n}\sum_k \mathbf{1}\{V_k > \mathrm{RV}_k\}
\end{align*}
```

### Sampling and effective sample size

```latex
\noindent \textbf{Daily:} every valid start date; neighbouring windows share up to 21 returns, so
\[
n_{\mathrm{eff}} = \max\!\left(1, \operatorname{round}\!\left(\frac{n}{21}\right)\right).
\]
\textbf{Non-overlapping:} keep the first window, then repeatedly the first window whose start date is on or after the previous window's end date; $n_{\mathrm{eff}} = n$.
```

### Calibration shares and Wilson intervals

```latex
\begin{align*}
\hat p_c &= \frac{100}{n}\sum_k \mathbf{1}\{|z_k| \le c\}\\
\hat p_{<-2} &= \frac{100}{n}\sum_k \mathbf{1}\{z_k < -2\}, \qquad
\hat p_{>2} = \frac{100}{n}\sum_k \mathbf{1}\{z_k > 2\}
\end{align*}
Normal benchmarks: $100\,(2\Phi(c) - 1) = 68.27$ for $c=1$ and $95.45$ for $c=2$, and $100\,\Phi(-2) = 2.28$ for each tail.
Wilson 95\% interval with proportion $p = \hat p/100$, $m = n_{\mathrm{eff}}$, $z_{0.975} = 1.96$:
\[
\frac{p + \frac{z^2}{2m} \;\pm\; z\sqrt{\frac{p(1-p)}{m} + \frac{z^2}{4m^2}}}{1 + \frac{z^2}{m}}
\]
truncated to $[0, 1]$ and multiplied by 100.
```

### Distribution of standardized moves

```latex
\begin{align*}
\bar z &= \frac1n\sum_k z_k, \qquad s_z = \sqrt{\frac1n\sum_k (z_k - \bar z)^2}\\
\text{excess kurtosis} &= \frac{\frac1n\sum_k (z_k - \bar z)^4}{\left(\frac1n\sum_k (z_k - \bar z)^2\right)^{2}} - 3
\end{align*}
Histogram bins $[a, b)$ of width $0.5$ on $[-4, 4]$, with the outer bins open-ended. The normal reference count is $n\,[\Phi(b) - \Phi(a)]$, with $\Phi(-\infty)=0$ and $\Phi(\infty)=1$.
```

### Regression with Newey-West errors

```latex
Fit $y_k = \alpha + \beta x_k + \varepsilon_k$ by ordinary least squares with $X = [\,1\ \ x\,]$ and residuals $\hat e_k$:
\begin{align*}
\hat\beta &= \frac{\sum_k (x_k - \bar x)(y_k - \bar y)}{\sum_k (x_k - \bar x)^2}, \qquad \hat\alpha = \bar y - \hat\beta \bar x, \qquad
R^2 = 1 - \frac{\sum_k \hat e_k^2}{\sum_k (y_k - \bar y)^2}\\
\widehat{\operatorname{Var}}(\hat\theta) &= (X^\top X)^{-1}\, \hat S\, (X^\top X)^{-1}\\
\hat S &= \Gamma_0 + \sum_{l=1}^{L} w_l\left(\Gamma_l + \Gamma_l^\top\right), \qquad
\Gamma_l = \sum_{k=l+1}^{n} \hat e_k \hat e_{k-l}\, X_k^\top X_{k-l}, \qquad w_l = 1 - \frac{l}{L+1}\\
t_\beta &= \frac{\hat\beta}{\operatorname{se}(\hat\beta)}
\end{align*}
The lag is $L = 21$ for daily windows and $L = 3$ for non-overlapping windows (clipped to $n-1$). The models are:
\begin{center}
\begin{tabular}{@{}lll@{}}
\toprule
Model & $y$ & $x$\\
\midrule
Magnitude (Mincer--Zarnowitz) & $\mathrm{RV}_k$ & $V_k$\\
Trailing benchmark & $\mathrm{RV}_k$ & $\mathrm{RV}^{\mathrm{trail}}_k$\\
Absolute move & $|R_k|$ & $\sigma_k$\\
Direction & $R_k$ & $V_k$\\
\bottomrule
\end{tabular}
\end{center}
An unbiased volatility forecast has $\alpha = 0$ and $\beta = 1$; the page reports $t = (\hat\beta - 1)/\operatorname{se}(\hat\beta)$ for that test. The trailing benchmark and the VIX regression are compared on the same dates, those with a full lookback.
```

### Rank correlation and quantiles

```latex
\begin{align*}
\rho_S &= \operatorname{corr}\big(\operatorname{rank}(V_k),\ \operatorname{rank}(|R_k|)\big) \quad \text{(Pearson correlation of average ranks, so ties share a rank)}\\
q_p &= x_{(\lfloor u \rfloor)} + (u - \lfloor u \rfloor)\left(x_{(\lceil u \rceil)} - x_{(\lfloor u \rfloor)}\right), \qquad u = p\,(n-1)
\end{align*}
Quintile buckets split at $q_{0.2}, q_{0.4}, q_{0.6}, q_{0.8}$ of the selected VIX values; level buckets split at $15, 20, 25, 30, 40$, each lower bound inclusive.
```

### Predictive grade (readout)

```latex
With the magnitude regression's $R^2$, slope and $t_\beta$:
\[
\text{grade} =
\begin{cases}
\text{none} & \hat\beta \le 0 \ \text{ or } \ t_\beta < 2 \ \text{ or } \ R^2 < 0.10\\
\text{weak} & 0.10 \le R^2 < 0.30\\
\text{moderate} & 0.30 \le R^2 < 0.50\\
\text{strong} & R^2 \ge 0.50
\end{cases}
\]
```

### Expanding-window out-of-sample test

```latex
For a test window starting at $d_k$, the training set contains only windows whose 30 days had finished before $d_k$:
\[
\mathcal{T}_k = \{\, s : d_{e(s)} < d_k \,\}, \qquad \text{test only if } |\mathcal{T}_k| \ge n_0 \text{ and } \mathrm{RV}^{\mathrm{trail}}_k \text{ exists,}
\]
with $n_0 = 60$ (non-overlapping) or $504$ (daily). Fit by ordinary least squares on $\mathcal{T}_k$ only:
\begin{align*}
(\hat a_k, \hat b_k) &= \text{OLS of } \mathrm{RV}_s \text{ on } V_s, \quad s \in \mathcal{T}_k\\
(\hat c_k, \hat g_k) &= \text{OLS of } R_s \text{ on } V_s, \quad s \in \mathcal{T}_k
\end{align*}
Forecasts of the next-30-day realized volatility $\mathrm{RV}_k$ and return $R_k$:
\begin{align*}
\widehat{\mathrm{RV}}^{\text{raw}}_k &= V_k\\
\widehat{\mathrm{RV}}^{\text{cal}}_k &= \hat a_k + \hat b_k V_k\\
\widehat{\mathrm{RV}}^{\text{trail}}_k &= \mathrm{RV}^{\mathrm{trail}}_k\\
\widehat{\mathrm{RV}}^{\text{mean}}_k &= \frac{1}{|\mathcal{T}_k|}\sum_{s \in \mathcal{T}_k} \mathrm{RV}_s\\
\widehat{R}^{\text{mean}}_k &= \frac{1}{|\mathcal{T}_k|}\sum_{s \in \mathcal{T}_k} R_s\\
\widehat{R}^{\text{VIX}}_k &= \hat c_k + \hat g_k V_k
\end{align*}
Points are skipped while the training VIX has no variation. With forecast error $u^{m}_k = \text{outcome}_k - \text{forecast}^{m}_k$ over the $T$ test windows:
\begin{align*}
\mathrm{RMSE}_m &= \sqrt{\tfrac1T \sum_k (u^m_k)^2}, \qquad \mathrm{MAE}_m = \tfrac1T\sum_k |u^m_k|, \qquad \mathrm{bias}_m = -\tfrac1T\sum_k u^m_k\\
\text{skill}_m &= 1 - \frac{\sum_k (u^m_k)^2}{\sum_k (u^{\text{bench}}_k)^2}\\
C_\tau &= \sum_{k \le \tau}\left[(u^{\text{bench}}_k)^2 - (u^m_k)^2\right]
\end{align*}
Here skill is the out-of-sample $R^2$ against the expanding mean and $C_\tau$ is the cumulative advantage plotted on the chart. The Diebold--Mariano test of equal squared-error loss between models $A$ and $B$, with $\delta_k = (u^A_k)^2 - (u^B_k)^2$:
\begin{align*}
\bar\delta &= \frac1T\sum_k \delta_k, \qquad \hat\gamma_l = \frac1T\sum_{k=l+1}^{T}(\delta_k - \bar\delta)(\delta_{k-l} - \bar\delta)\\
\widehat{\mathrm{LRV}} &= \hat\gamma_0 + 2\sum_{l=1}^{L}\left(1 - \frac{l}{L+1}\right)\hat\gamma_l, \qquad
\mathrm{DM} = \frac{\bar\delta}{\sqrt{\widehat{\mathrm{LRV}}/T}}
\end{align*}
A value below $-2$ means model $A$ has a significantly smaller squared error. The test is reported for each forecast against the expanding mean and against the trailing-volatility forecast, with the same $L$ as the regressions.
```

## Data and provenance

| Series | Source | Coverage | Badge |
|---|---|---|---|
| VIX close (`VIXCLS`) | CBOE via FRED, Gold `fred_latest_observation` | 1990 onward | `DB` |
| SPY close (`SPY:close`) | Gold `equity_total_return_index` | 1993 onward | `DB` |
| SPY total return (`SPY:total_return_index`) | Gold `equity_total_return_index` | 1993 onward | `DB` |
| S&P 500 index (`SP500`) | S&P Dow Jones Indices via FRED, Gold `fred_latest_observation` | latest ten years only | `DB` |

The route reads Gold only. If the database is unreachable or a series is empty, the page shows an error. It never substitutes simulated data. The page aligns the series and computes every statistic in the browser, so control changes are instant. The `DATA AS OF` date is the last VIX close; a freshness tag appears when the Gold load is behind.

## Assumptions

- **Price basis:** the default is SPY price (no dividends), the closest long-history match to the price index the VIX options are written on. SPY also carries a 0.09% fee and small tracking error. Use the FRED index to check the proxy over its ten years.
- **Zero drift:** the implied band is centred on zero. Over 30 days the equity drift (roughly 0.5–0.8%) is small next to a 4–6% band, but it shifts the shares slightly toward the upside.
- **Lognormal benchmark:** the ±1σ and ±2σ benchmarks assume normally distributed log returns. Real returns have fat tails, which the kurtosis figure shows.
- **Close timing:** the VIX settles at 4:15 pm ET; the index closes at 4:00 pm.
- **Calendar:** windows run 30 calendar days; realized volatility annualizes with 252 trading days.
- **History:** Gold holds the latest revision of each series; the VIX is not revised in practice.

### Reference results (SPY price, full history, as of 2026-10-06)

| Measure | Non-overlapping | Daily |
|---|---|---|
| Windows (effective) | 439 (439) | 8,455 (about 403) |
| Inside ±1σ | 85.0% | 83.5% |
| Inside ±2σ | 98.9% | 98.7% |
| Falls beyond −2σ | 0.91% | 1.17% |
| Realized ÷ implied vol | 0.82 | 0.81 |
| Mean premium | 3.5 vol pts | 3.7 vol pts |
| VIX above subsequent realized vol | 83% of windows | 84% of windows |
| Mincer–Zarnowitz β (t) | 0.85 (14.5) | 0.88 (14.6) |
| Mincer–Zarnowitz R² | 49% | 52% |
| Trailing-vol R², same dates | 42% | 42% |
| Direction slope per VIX point (t) | +0.084% (1.5) | +0.056% (1.6) |
| Direction R² | 2.1% | 1.0% |

**Out of sample** (expanding window, SPY price, full history):

| Measure | Non-overlapping | Daily |
|---|---|---|
| Test windows | 378 (1997–2026) | 7,931 (1995–2026) |
| Volatility skill: VIX as quoted | 37% | 38% |
| Volatility skill: VIX recalibrated | 49% | 51% |
| Volatility skill: trailing 30-day vol | 32% | 31% |
| RMSE, recalibrated VIX versus trailing (vol points) | 7.46 versus 8.60 | 7.07 versus 8.37 |
| Diebold–Mariano t, recalibrated VIX versus trailing | −2.9 | −3.2 |
| Return skill: VIX regression | +0.2% (not significant) | −0.9% (not significant) |

In real time the VIX forecast volatility well and beat the naive trailing-volatility forecast with statistical significance, once recalibrated to remove its upward bias. The raw VIX still beat the historical mean but carried a bias of about +3.5 vol points. As a return forecast it added nothing: skill is indistinguishable from zero. Most of the volatility skill comes from 2008 and 2020, where the historical mean badly missed spikes (the large steps in the chart).

The S&P 500 index from FRED (2016–2026, daily windows) gives a similar picture: realized ÷ implied 0.80 and R² 38%. Its direction slope is significant (t 3.7) but explains 6% of returns, and comes from far fewer independent windows (about 121) dominated by the 2020 rebound.

## Export

Each of three panels has a **CSV** button. Files begin with `#` comment lines (source, basis, sampling, date range, data-as-of date, horizon) and then a header row. Numbers are written at full precision, missing values are blank, and text cells that a spreadsheet could read as a formula are neutralized.

| File | Contents |
|---|---|
| `vixr_windows_<basis>[_dates].csv` | One row per window in the current selection: dates, VIX, implied 1σ, forward return, standardized move, realized and trailing volatility, trading days |
| `vixr_buckets_<basis>[_dates].csv` | The bucket table, with blank bounds for the open-ended first and last bucket |
| `vixr_forecasts_<basis>[_dates].csv` | One row per out-of-sample window: training size, outcomes and all six forecasts |

## Outputs and how to read them

| Output | How to read it |
|---|---|
| **Latest VIX** | The newest close and the ±1σ move it implies to its 30-day horizon |
| **Inside ±1σ** | Above 68% means the VIX overstated typical moves; the interval says whether the gap is noise |
| **Beyond −2σ** | How often the market fell more than twice the implied move |
| **Realized ÷ implied** | Below 1 is the variance risk premium: option buyers paid for more volatility than arrived |
| **Magnitude R²** | Share of next-month realized volatility the VIX explains; compare with the trailing-vol figure underneath |
| **Direction** | Percent return per VIX point with its t-statistic; abs(t) below 2 means no reliable signal |
| **Scatter** | Points between the green curves landed inside ±1σ; red points broke ±2σ |
| **Band over time** | Where breaches cluster (1998, 2008, 2020 crashes; quiet years rarely break) |
| **Distribution** | A peak taller than the normal curve means moves were usually smaller than implied; fat outer bins mean crashes |
| **VIX vs realized** | The orange line usually sits above the blue: the premium. Spikes in blue above orange are surprises |
| **Bucket table** | Average outcomes by VIX level. Check n before trusting a high-VIX bucket |
| **Out-of-sample skill** (KPI) | The recalibrated VIX's out-of-sample R² against the historical mean |
| **Out-of-sample test** | Skill, error and Diebold–Mariano tests for each forecast, and the cumulative advantage chart |

## Validation

- **Exact cases** (`src/lib/vixImpliedForward.test.ts`): the implied-move formula, window end dates (including weekend targets), realized volatility on a path with known daily returns, trailing volatility, OLS on an exact line, Newey–West equal to White errors at lag 0 and wider under autocorrelation, Wilson intervals, Spearman with ties, bucket edges and quintile sizes.
- **Edge cases:** missing VIX days, invalid dates and values (including impossible dates such as 2020-13-01), feed outages, unsorted or duplicated input, empty input, a VIX that never varies (regressions report "not enough variation", not NaN), and samples below 10 windows.
- **Simulated markets with known volatility:**
  - a VIX equal to true volatility reads as calibrated (inside ±1σ between 60% and 76%, ratio near 1);
  - a VIX 25% too high reads as overstated with a positive premium;
  - a VIX that tracks regime-switching volatility grades as a strong magnitude predictor.
- **Independent reference:** `scripts/fixtures/vixr_reference.py` recomputes every statistic with numpy and scipy (its own window logic, matrix-form Newey–West, and a walk-forward that refits from scratch at each test point). The golden tests hold the engine to those values on two real Gold excerpts: the 2007–09 crisis and the calm of 2017.
- **No look-ahead:** changing any outcome after a date leaves every earlier forecast unchanged, and altering windows that were still open on a test date leaves that forecast unchanged.
- **Route** (`src/app/api/market-volatility/vix-forward/route.test.ts`): basis selection, date and number normalization (a null value is never read as 0), fail-closed behaviour with no database, missing series and database errors.
- **CSV:** escaping, formula neutralization, blank missing values, round-trip of numbers, and one row per window or forecast.
- **Browser** (`test/vixr.spec.ts`): the live page and every panel, control changes, failure states, the Guide button, phone width, and CSV downloads that honor the current controls.

## Limitations

- The in-sample statistics describe the history they were fitted on. The out-of-sample panel tests real-time use, but it is one historical path: skill depends heavily on a few crises, and the recalibration coefficients are re-estimated on the whole history to date, not on a rolling recent window.
- Results are sensitive to a handful of crisis windows (1998, 2008, 2020). Use **Before 2008** and **Since 2008** to see how stable they are.
- The FRED S&P 500 series covers only ten years; long history depends on SPY as a proxy.
- The VIX is a 30-day measure; other horizons would need VIX9D, VIX3M or the full term structure, which are not in Gold.
- No transaction-cost or tradable-strategy test: a variance risk premium in the data is not the same as a profitable volatility-selling strategy.

## Status and governance

- **Spec:** none. This is an analytics module in the Markets group, next to [Market Volatility](/market-volatility).
- **Data:** Gold only, with no simulated fallback. Production use needs no service and no approval gate; the page is read-only.

## References

- Help & FAQ: [VIXR help](/guides/VIXR/help)
- Open the module: [VIX Implied vs Forward](/market-volatility/implied-vs-forward)
- [Cboe VIX methodology](https://cdn.cboe.com/api/global/us_indices/governance/Volatility_Index_Methodology_Cboe_Volatility_Index.pdf)
- FRED series: [VIXCLS](https://fred.stlouisfed.org/series/VIXCLS) and [SP500](https://fred.stlouisfed.org/series/SP500)
- Code: `src/lib/vixImpliedForward.ts`, `src/app/api/market-volatility/vix-forward/route.ts`, `src/app/market-volatility/implied-vs-forward/`
- Related: [Market Volatility](/market-volatility), [Volatility Forecaster](/ml/volatility-forecaster)
