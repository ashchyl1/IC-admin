/** Display formatting for the scalping workspace. Terse by design — the pad is dense. */

const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function price(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return digits === 0 ? inr0.format(value) : inr.format(value);
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${inr.format(value)}`;
}

/** Signed rupees — the P&L primitive. */
export function pnl(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${inr.format(Math.abs(value))}`;
}

export function signedPoints(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${inr.format(Math.abs(value)).replace(/\.00$/, digits === 0 ? "" : ".00")}`;
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

/** 12,34,567 -> 12.3L, 1,23,45,678 -> 1.23Cr. Used for OI and volume. */
export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return inr0.format(value);
}

/** Strike rendered the way an Indian trader reads it: 24,000. */
export function strikeLabel(strike: number): string {
  return inr0.format(strike);
}

/**
 * Spelled-out timeframe for badges. The compact form is fine in a segmented
 * control, but uppercased in a badge "1M" reads as one month.
 */
export function timeframeLabel(timeframe: string): string {
  const map: Record<string, string> = {
    "1m": "1 min",
    "3m": "3 min",
    "5m": "5 min",
    "15m": "15 min",
    "1h": "1 hour",
    "1d": "1 day",
  };
  return map[timeframe] ?? timeframe;
}

export function toneFor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-slate-400";
  return value > 0 ? "text-emerald-400" : "text-rose-400";
}

export function bgToneFor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "bg-slate-700/40";
  return value > 0 ? "bg-emerald-500/15" : "bg-rose-500/15";
}
