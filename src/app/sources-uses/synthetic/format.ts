/** Display-only rounding (spec012 SU-SIM: the solve itself stays continuous). */
export const mm = (v: number, dp = 1) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}mm`;
export const num = (v: number, dp = 1) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const bps = (v: number, dp = 0) => `${num(v, dp)}bp`;
export const pct = (v: number, dp = 1) => `${num(v * 100, dp)}%`;
export const signed = (v: number, fmt: (x: number) => string) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : fmt(0));
