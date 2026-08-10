/**
 * Wave degree notation.
 *
 * Elliott's nine degrees, with the label decoration that distinguishes a
 * Primary count from its Minute subdivisions. The scheme follows Frost &
 * Prechter's convention as closely as a browser font allows: three tiers of
 * uppercase roman for the largest degrees, three of arabic in the middle, three
 * of lowercase roman for the smallest, wrapped in circles, parentheses or
 * brackets to separate the tiers.
 *
 * Colour and type size carry the same information redundantly, because on a
 * busy chart the wrapper alone is hard to read at a glance.
 */

export type DegreeKey =
  | "grandSupercycle"
  | "supercycle"
  | "cycle"
  | "primary"
  | "intermediate"
  | "minor"
  | "minute"
  | "minuette"
  | "subminuette";

export type LabelKind = "motive" | "corrective";

type Numerals = "roman-upper" | "arabic" | "roman-lower";
type Wrapper = "brackets" | "parens" | "circled" | "none";

export interface DegreeSpec {
  key: DegreeKey;
  label: string;
  /** 1 = largest. Drives font size and z-order. */
  rank: number;
  numerals: Numerals;
  letterCase: "upper" | "lower";
  wrapper: Wrapper;
  color: string;
  /** Typical span, shown as a hint in the degree picker. */
  span: string;
}

export const DEGREES: Record<DegreeKey, DegreeSpec> = {
  grandSupercycle: {
    key: "grandSupercycle",
    label: "Grand Supercycle",
    rank: 1,
    numerals: "roman-upper",
    letterCase: "upper",
    wrapper: "brackets",
    color: "#f472b6",
    span: "multi-century",
  },
  supercycle: {
    key: "supercycle",
    label: "Supercycle",
    rank: 2,
    numerals: "roman-upper",
    letterCase: "upper",
    wrapper: "parens",
    color: "#fb7185",
    span: "40–70 years",
  },
  cycle: {
    key: "cycle",
    label: "Cycle",
    rank: 3,
    numerals: "roman-upper",
    letterCase: "upper",
    wrapper: "none",
    color: "#fb923c",
    span: "1–several years",
  },
  primary: {
    key: "primary",
    label: "Primary",
    rank: 4,
    numerals: "arabic",
    letterCase: "upper",
    wrapper: "circled",
    color: "#facc15",
    span: "months–years",
  },
  intermediate: {
    key: "intermediate",
    label: "Intermediate",
    rank: 5,
    numerals: "arabic",
    letterCase: "upper",
    wrapper: "parens",
    color: "#a3e635",
    span: "weeks–months",
  },
  minor: {
    key: "minor",
    label: "Minor",
    rank: 6,
    numerals: "arabic",
    letterCase: "upper",
    wrapper: "none",
    color: "#34d399",
    span: "weeks",
  },
  minute: {
    key: "minute",
    label: "Minute",
    rank: 7,
    numerals: "roman-lower",
    letterCase: "lower",
    wrapper: "brackets",
    color: "#38bdf8",
    span: "days",
  },
  minuette: {
    key: "minuette",
    label: "Minuette",
    rank: 8,
    numerals: "roman-lower",
    letterCase: "lower",
    wrapper: "parens",
    color: "#818cf8",
    span: "hours",
  },
  subminuette: {
    key: "subminuette",
    label: "Subminuette",
    rank: 9,
    numerals: "roman-lower",
    letterCase: "lower",
    wrapper: "none",
    color: "#c084fc",
    span: "minutes",
  },
};

export const DEGREE_KEYS: DegreeKey[] = [
  "grandSupercycle",
  "supercycle",
  "cycle",
  "primary",
  "intermediate",
  "minor",
  "minute",
  "minuette",
  "subminuette",
];

export const DEFAULT_DEGREE: DegreeKey = "intermediate";

export function isDegree(value: string): value is DegreeKey {
  return Object.prototype.hasOwnProperty.call(DEGREES, value);
}

/** One step down the ladder — what a subdivision of this wave would be. */
export function childDegree(degree: DegreeKey): DegreeKey {
  const index = DEGREE_KEYS.indexOf(degree);
  return DEGREE_KEYS[Math.min(index + 1, DEGREE_KEYS.length - 1)];
}

export function parentDegree(degree: DegreeKey): DegreeKey {
  const index = DEGREE_KEYS.indexOf(degree);
  return DEGREE_KEYS[Math.max(index - 1, 0)];
}

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"];
const CIRCLED_DIGITS = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

/**
 * Decorate a bare wave label (`3`, `C`, `W`) for a degree.
 *
 * Numeric labels follow the degree's numeral tier; letters keep their identity
 * and only take the case and wrapper, because an Elliott B wave is a B at every
 * degree.
 */
export function decorateLabel(base: string, degree: DegreeKey): string {
  const spec = DEGREES[degree];
  const digit = Number(base);

  if (Number.isFinite(digit) && base.trim() !== "") {
    switch (spec.numerals) {
      case "roman-upper":
        return wrap(ROMAN[digit]?.toUpperCase() ?? base, spec.wrapper, true);
      case "roman-lower":
        return wrap(ROMAN[digit] ?? base, spec.wrapper, false);
      default:
        return wrap(base, spec.wrapper, spec.letterCase === "upper", digit);
    }
  }

  const letter = spec.letterCase === "upper" ? base.toUpperCase() : base.toLowerCase();
  return wrap(letter, spec.wrapper, spec.letterCase === "upper");
}

function wrap(text: string, wrapper: Wrapper, upper: boolean, digit?: number): string {
  switch (wrapper) {
    case "brackets":
      return `[${text}]`;
    case "parens":
      return `(${text})`;
    case "circled": {
      if (digit !== undefined && digit >= 1 && digit <= 9) return CIRCLED_DIGITS[digit];
      // U+24B6 Ⓐ / U+24D0 ⓐ — one circled glyph per letter.
      const code = text.charCodeAt(0);
      if (upper && code >= 65 && code <= 90) return String.fromCharCode(0x24b6 + (code - 65));
      if (!upper && code >= 97 && code <= 122) return String.fromCharCode(0x24d0 + (code - 97));
      return text;
    }
    default:
      return text;
  }
}

/** Label type size in px, largest degree biggest. */
export function labelFontSize(degree: DegreeKey): number {
  const rank = DEGREES[degree].rank;
  return Math.round(15 - (rank - 1) * 0.7);
}
