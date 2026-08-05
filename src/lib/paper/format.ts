/** Display helpers. All money formatting goes through here so it stays consistent. */

export function money(value: number | string | null | undefined, currency = "INR") {
  const n = toNumber(value);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function num(value: number | string | null | undefined, digits = 2) {
  const n = toNumber(value);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function pct(value: number | string | null | undefined, digits = 2) {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function signed(value: number | string | null | undefined, currency = "INR") {
  const n = toNumber(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${money(n, currency)}`;
}

/**
 * Postgres numeric arrives over PostgREST as a string to preserve precision.
 * Parse at the display boundary only -- never for ledger arithmetic, which
 * happens in the database.
 */
export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function n(value: number | string | null | undefined): number {
  return toNumber(value) ?? 0;
}

/** Render a UTC timestamp in the session's market timezone. */
export function marketTime(iso: string | null | undefined, timeZone = "Asia/Kolkata", withDate = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    ...(withDate ? { year: "numeric", month: "short", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function pnlTone(value: number | string | null | undefined) {
  const v = toNumber(value);
  if (v === null || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}
