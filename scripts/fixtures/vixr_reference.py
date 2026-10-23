#!/usr/bin/env python3
"""
Independent reference implementation of the VIXR statistics, used to generate the golden expected values in
src/lib/__fixtures__/vixr/expected-*.json. It deliberately shares no code or structure with
src/lib/vixImpliedForward.ts: windows come from bisect, regressions from numpy matrix algebra with a textbook
Newey-West sandwich, rank correlation from scipy.

Usage: python3 scripts/fixtures/vixr_reference.py   (rewrites the expected files next to the Gold excerpts)
"""
import bisect
import json
import math
import pathlib
from datetime import date, timedelta

import numpy as np
from scipy import stats as sp

ROOT = pathlib.Path(__file__).resolve().parents[2] / "src" / "lib" / "__fixtures__" / "vixr"
HORIZON = 30
MAX_GAP = 5
NW_DAILY, NW_MONTHLY = 21, 3
OVERLAP = 21


def d(s):
    return date.fromisoformat(s)


def windows(vix, spy):
    vix = dict(vix)
    dates = [x[0] for x in spy]
    px = np.array([x[1] for x in spy], dtype=float)
    ords = [d(x).toordinal() for x in dates]
    sq = np.concatenate([[0.0], np.cumsum(np.diff(np.log(px)) ** 2)])  # sq[k] = sum of squared returns up to k
    out = []
    for i, dt in enumerate(dates):
        if dt not in vix:
            continue
        target = ords[i] + HORIZON
        if ords[-1] < target:
            continue
        j = bisect.bisect_right(ords, target) - 1
        if j <= i or target - ords[j] > MAX_GAP:
            continue
        v = vix[dt]
        sigma = v * math.sqrt(HORIZON / 365)
        lr = math.log(px[j] / px[i])
        # trailing: closes from the first date >= (date - 30d) up to date
        lo = bisect.bisect_left(ords, ords[i] - HORIZON)
        trailing = None
        if ords[0] <= ords[i] - HORIZON and i - lo >= 10:
            trailing = math.sqrt(252 * (sq[i] - sq[lo]) / (i - lo)) * 100
        out.append(dict(
            date=dt, end=dates[j], vix=v, sigma=sigma,
            ret=(math.exp(lr) - 1) * 100, z=lr * 100 / sigma,
            rv=math.sqrt(252 * (sq[j] - sq[i]) / (j - i)) * 100, trailing=trailing,
        ))
    return out


def monthly(obs):
    out, nxt = [], ""
    for o in obs:
        if o["date"] < nxt:
            continue
        out.append(o)
        nxt = o["end"]
    return out


def ols_nw(x, y, lag):
    x, y = np.asarray(x, float), np.asarray(y, float)
    n = len(x)
    X = np.column_stack([np.ones(n), x])
    beta = np.linalg.solve(X.T @ X, X.T @ y)
    e = y - X @ beta
    xtx_inv = np.linalg.inv(X.T @ X)
    S = (X * e[:, None]).T @ (X * e[:, None])
    for l in range(1, min(lag, n - 1) + 1):
        w = 1 - l / (lag + 1) if l <= lag else 0
        G = (X[l:] * e[l:, None]).T @ (X[:-l] * e[:-l, None])
        S += w * (G + G.T)
    cov = xtx_inv @ S @ xtx_inv
    r2 = 1 - (e @ e) / np.sum((y - y.mean()) ** 2)
    se = np.sqrt(np.diag(cov))
    return dict(alpha=beta[0], beta=beta[1], r2=r2, seAlpha=se[0], seBeta=se[1], tBeta=beta[1] / se[1], n=n)


def wilson(hits, n, eff):
    p = hits / n
    z = 1.959964
    den = 1 + z * z / eff
    centre = (p + z * z / (2 * eff)) / den
    half = z * math.sqrt(p * (1 - p) / eff + z * z / (4 * eff * eff)) / den
    return dict(pct=p * 100, ciLow=max(0, centre - half) * 100, ciHigh=min(1, centre + half) * 100)


def summarize(obs, sampling):
    n = len(obs)
    lag = NW_DAILY if sampling == "daily" else NW_MONTHLY
    eff = max(1, round(n / OVERLAP)) if sampling == "daily" else n
    z = np.array([o["z"] for o in obs])
    vix = np.array([o["vix"] for o in obs])
    rv = np.array([o["rv"] for o in obs])
    ret = np.array([o["ret"] for o in obs])
    kurt = np.mean((z - z.mean()) ** 4) / np.mean((z - z.mean()) ** 2) ** 2 - 3
    paired = [o for o in obs if o["trailing"] is not None]
    buckets = {}
    edges = [15, 20, 25, 30, 40]
    for o in obs:
        k = sum(1 for e in edges if o["vix"] >= e)
        buckets.setdefault(k, []).append(o)
    return dict(
        n=n, effectiveN=eff, lag=lag, start=obs[0]["date"], end=obs[-1]["date"],
        meanVix=vix.mean(), meanImpliedMovePct=np.mean([o["sigma"] for o in obs]),
        meanForwardReturnPct=ret.mean(), medianForwardReturnPct=float(np.median(ret)),
        pctPositive=float((ret > 0).mean() * 100),
        within1=wilson(int((abs(z) <= 1).sum()), n, eff), within2=wilson(int((abs(z) <= 2).sum()), n, eff),
        beyondMinus2=wilson(int((z < -2).sum()), n, eff), beyondPlus2=wilson(int((z > 2).sum()), n, eff),
        zMean=z.mean(), zStd=float(np.sqrt(np.mean((z - z.mean()) ** 2))), zExcessKurtosis=kurt,
        meanRealizedVolPct=rv.mean(), volRatio=rv.mean() / vix.mean(),
        medianVolRatio=float(np.median(rv / vix)), meanPremiumPts=vix.mean() - rv.mean(),
        pctVixAboveRealized=float((vix > rv).mean() * 100),
        realizedOnVix=ols_nw(vix, rv, lag),
        absReturnOnImplied=ols_nw([o["sigma"] for o in obs], abs(ret), lag),
        spearmanVixAbsReturn=float(sp.spearmanr(vix, abs(ret)).statistic),
        returnOnVix=ols_nw(vix, ret, lag),
        correlationReturnVix=float(np.corrcoef(vix, ret)[0, 1]),
        benchmark=dict(
            n=len(paired),
            vixR2=ols_nw([o["vix"] for o in paired], [o["rv"] for o in paired], lag)["r2"],
            trailingR2=ols_nw([o["trailing"] for o in paired], [o["rv"] for o in paired], lag)["r2"],
        ) if len(paired) > 2 else None,
        regimeBuckets={str(k): dict(
            n=len(v), meanVix=float(np.mean([o["vix"] for o in v])),
            meanForwardReturnPct=float(np.mean([o["ret"] for o in v])),
            pctPositive=float(np.mean([o["ret"] > 0 for o in v]) * 100),
            realizedToImplied=float(np.mean([o["rv"] for o in v]) / np.mean([o["vix"] for o in v])),
            within1Pct=float(np.mean([abs(o["z"]) <= 1 for o in v]) * 100),
        ) for k, v in sorted(buckets.items())},
    )


# Minimum training windows used for the golden walk-forward expectations (small, because the excerpts are short).
MIN_TRAIN = {"crisis_2007_2009": {"daily": 252, "monthly": 15}, "calm_2017": {"daily": 100, "monthly": 5}}


def dm_t(ea, eb, lag):
    d = np.asarray(ea) ** 2 - np.asarray(eb) ** 2
    n = len(d)
    if n < 3:
        return None
    c = d - d.mean()
    L = max(0, min(lag, n - 1))
    lrv = float(c @ c) / n
    for l in range(1, L + 1):
        lrv += 2 * (1 - l / (L + 1)) * float(c[l:] @ c[:-l]) / n
    if not lrv > 1e-18:
        return None
    return float(d.mean() / math.sqrt(lrv / n))


def walk_forward(obs, min_train, lag):
    """Refit from scratch for every test point on windows that finished strictly before it (no running sums)."""
    pts = []
    for t in obs:
        train = [o for o in obs if o["end"] < t["date"]]
        if len(train) < min_train or t["trailing"] is None:
            continue
        x = np.array([o["vix"] for o in train])
        if np.var(x) * len(x) ** 2 <= 1e-9:
            continue
        X = np.column_stack([np.ones(len(x)), x])
        bv = np.linalg.lstsq(X, np.array([o["rv"] for o in train]), rcond=None)[0]
        br = np.linalg.lstsq(X, np.array([o["ret"] for o in train]), rcond=None)[0]
        pts.append(dict(
            date=t["date"], vix=t["vix"], rv=t["rv"], ret=t["ret"], trainN=len(train),
            vix_raw=t["vix"], vix_calibrated=bv[0] + bv[1] * t["vix"], trailing=t["trailing"],
            hist_mean=float(np.mean([o["rv"] for o in train])),
            ret_mean=float(np.mean([o["ret"] for o in train])), ret_vix=br[0] + br[1] * t["vix"],
        ))
    if len(pts) < 10:
        return None
    n = len(pts)
    err = lambda a, f: [p[a] - p[f] for p in pts]
    ev = {m: err("rv", m) for m in ["vix_raw", "vix_calibrated", "trailing", "hist_mean"]}
    er = {m: err("ret", m) for m in ["ret_mean", "ret_vix"]}
    mse = lambda e: float(np.mean(np.square(e)))

    def score(e, bench, trailing, is_bench):
        return dict(
            rmse=math.sqrt(mse(e)), mae=float(np.mean(np.abs(e))), bias=float(-np.mean(e)),
            oosR2=0.0 if is_bench else 1 - mse(e) / mse(bench),
            dmVsBenchmark=None if is_bench else dm_t(e, bench, lag),
            dmVsTrailing=dm_t(e, trailing, lag) if trailing is not None else None,
        )

    vol = {m: score(ev[m], ev["hist_mean"], ev["trailing"] if m != "trailing" else None, m == "hist_mean") for m in ev}
    ret = {m: score(er[m], er["ret_mean"], None, m == "ret_mean") for m in er}
    return dict(n=n, minTrain=min_train, lag=lag, firstTest=pts[0]["date"], lastTest=pts[-1]["date"],
                trainAtFirstTest=pts[0]["trainN"], trainAtLastTest=pts[-1]["trainN"], vol=vol, returns=ret,
                lastPoint={k: pts[-1][k] for k in ["date", "vix_calibrated", "hist_mean", "ret_vix", "ret_mean"]})


def tidy(value):
    if isinstance(value, dict):
        return {k: tidy(v) for k, v in value.items()}
    if isinstance(value, (np.floating, float)):
        return float(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    return value


def main():
    for path in sorted(ROOT.glob("gold-*.json")):
        raw = json.loads(path.read_text())
        obs = windows(raw["vix"], raw["spy"])
        result = dict(
            _about="Generated by scripts/fixtures/vixr_reference.py with numpy and scipy; independent of the TypeScript engine.",
            windowsBuilt=len(obs),
            first=obs[0], last=obs[-1],
            daily=summarize(obs, "daily"),
            monthly=summarize(monthly(obs), "monthly"),
        )
        key = path.stem.replace("gold-", "")
        result["daily"]["walkForward"] = walk_forward(obs, MIN_TRAIN[key]["daily"], NW_DAILY)
        result["monthly"]["walkForward"] = walk_forward(monthly(obs), MIN_TRAIN[key]["monthly"], NW_MONTHLY)
        out = ROOT / path.name.replace("gold-", "expected-")
        out.write_text(json.dumps(tidy(result), indent=1) + "\n")
        print(out.name, "windows", len(obs), "monthly", result["monthly"]["n"])


if __name__ == "__main__":
    main()
