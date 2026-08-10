/**
 * Wave degrees and their notation. §4.1.
 *
 * The critical rule (§12.4): a label's decoration is derived **at render time
 * from the drawing's current degree**, never baked in when the drawing is
 * created. Store "3" and decorate it to "③" on the way to the screen — bake it
 * in and changing a drawing's degree silently leaves the old notation behind,
 * which is the kind of bug an analyst discovers only when a chart they trusted
 * turns out to be labelled at two degrees at once.
 */

export const DEGREES = [
  "grand-supercycle",
  "supercycle",
  "cycle",
  "primary",
  "intermediate",
  "minor",
  "minute",
  "minuette",
  "subminuette",
] as const;

export type Degree = (typeof DEGREES)[number];

export interface DegreeMeta {
  id: Degree;
  label: string;
  /** Font size in px — higher degrees read larger, as they do on paper. */
  fontSize: number;
}

export const DEGREE_META: Record<Degree, DegreeMeta> = {
  "grand-supercycle": { id: "grand-supercycle", label: "Grand Supercycle", fontSize: 17 },
  supercycle: { id: "supercycle", label: "Supercycle", fontSize: 16 },
  cycle: { id: "cycle", label: "Cycle", fontSize: 15 },
  primary: { id: "primary", label: "Primary", fontSize: 14 },
  intermediate: { id: "intermediate", label: "Intermediate", fontSize: 13 },
  minor: { id: "minor", label: "Minor", fontSize: 12 },
  minute: { id: "minute", label: "Minute", fontSize: 11 },
  minuette: { id: "minuette", label: "Minuette", fontSize: 10 },
  subminuette: { id: "subminuette", label: "Subminuette", fontSize: 9 },
};

/** 1..5 -> roman. Waves never exceed five, so a table beats an algorithm. */
const ROMAN_UPPER = ["I", "II", "III", "IV", "V"];
const ROMAN_LOWER = ["i", "ii", "iii", "iv", "v"];
const CIRCLED_DIGIT = ["①", "②", "③", "④", "⑤"];

const CIRCLED_LETTER: Record<string, string> = {
  A: "Ⓐ",
  B: "Ⓑ",
  C: "Ⓒ",
  D: "Ⓓ",
  E: "Ⓔ",
  W: "Ⓦ",
  X: "Ⓧ",
  Y: "Ⓨ",
  Z: "Ⓩ",
};

/**
 * How each degree dresses a motive (numeric) and a corrective (lettered)
 * label. `wrap` is applied after the glyph substitution.
 */
interface Notation {
  motive: (n: number) => string;
  corrective: (letter: string) => string;
}

const NOTATION: Record<Degree, Notation> = {
  "grand-supercycle": {
    motive: (n) => `[${ROMAN_UPPER[n - 1] ?? n}]`,
    corrective: (l) => `[${CIRCLED_LETTER[l] ?? l}]`,
  },
  supercycle: {
    motive: (n) => `(${ROMAN_UPPER[n - 1] ?? n})`,
    corrective: (l) => `(${CIRCLED_LETTER[l] ?? l})`,
  },
  cycle: {
    motive: (n) => ROMAN_UPPER[n - 1] ?? String(n),
    corrective: (l) => CIRCLED_LETTER[l] ?? l,
  },
  primary: {
    motive: (n) => CIRCLED_DIGIT[n - 1] ?? String(n),
    corrective: (l) => CIRCLED_LETTER[l] ?? l,
  },
  intermediate: {
    motive: (n) => `(${n})`,
    corrective: (l) => `(${l})`,
  },
  minor: {
    motive: (n) => String(n),
    corrective: (l) => l,
  },
  minute: {
    motive: (n) => `[${ROMAN_LOWER[n - 1] ?? n}]`,
    corrective: (l) => `[${l.toLowerCase()}]`,
  },
  minuette: {
    motive: (n) => `(${ROMAN_LOWER[n - 1] ?? n})`,
    corrective: (l) => `(${l.toLowerCase()})`,
  },
  subminuette: {
    motive: (n) => ROMAN_LOWER[n - 1] ?? String(n),
    corrective: (l) => l.toLowerCase(),
  },
};

/**
 * Decorate a bare label ("3", "A", "W") for a degree.
 *
 * Call this at render. Never store the result.
 */
export function decorateLabel(base: string, degree: Degree): string {
  const notation = NOTATION[degree];
  if (!notation) return base;
  const asNumber = Number(base);
  return Number.isInteger(asNumber) && asNumber > 0
    ? notation.motive(asNumber)
    : notation.corrective(base.toUpperCase());
}

/**
 * One degree finer / coarser, so drilling into a subwave picks the right
 * degree without the analyst having to remember the ordering (§4.1).
 * Clamped at both ends rather than wrapping — wrapping from Subminuette back
 * to Grand Supercycle would be silently, spectacularly wrong.
 */
export function childDegree(degree: Degree): Degree {
  const i = DEGREES.indexOf(degree);
  return DEGREES[Math.min(i + 1, DEGREES.length - 1)];
}

export function parentDegree(degree: Degree): Degree {
  const i = DEGREES.indexOf(degree);
  return DEGREES[Math.max(i - 1, 0)];
}
