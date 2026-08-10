/**
 * Reading a wave analysis back in.
 *
 * The other half of the Claude loop: a count that Claude proposes — or one you
 * exported yesterday — is parsed here and put back on the chart. Two shapes are
 * accepted:
 *
 *   1. A full `indiacharts.wave-analysis/v1` bundle, as written by `export.ts`.
 *   2. A bare `{ drawings: [...] }` object, which is all Claude needs to emit
 *      to propose a count. Times may be ISO strings or chart seconds, and the
 *      origin may be given either as a labelled `origin` point or as the first
 *      entry in the list.
 *
 * Anything malformed is reported rather than silently dropped — a wave count
 * that loses a pivot on import is worse than one that refuses to load.
 */

import { toChartTime } from "@/lib/scalper/time";
import { DEGREES, isDegree, type DegreeKey } from "./degrees";
import { TOOLS, type ToolId } from "./patterns";
import { newId, type Drawing, type WavePoint } from "./types";
import { SCHEMA_ID } from "./export";

export interface ImportedTerminal {
  /** Terminal id from the bundle, when present — used to match panes. */
  id?: string;
  symbol?: string;
  interval?: string;
  title?: string;
  drawings: Drawing[];
}

export interface ImportResult {
  ok: boolean;
  terminals: ImportedTerminal[];
  errors: string[];
  warnings: string[];
}

type Json = Record<string, unknown>;

export function parseAnalysis(input: string | unknown): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let payload: unknown = input;
  if (typeof input === "string") {
    try {
      payload = JSON.parse(input) as unknown;
    } catch (error) {
      return {
        ok: false,
        terminals: [],
        errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
        warnings,
      };
    }
  }

  const root = asObject(payload);
  if (!root) {
    return { ok: false, terminals: [], errors: ["Expected a JSON object at the top level."], warnings };
  }

  if (typeof root.schema === "string" && root.schema !== SCHEMA_ID) {
    warnings.push(`Schema is "${root.schema}", expected "${SCHEMA_ID}". Parsing anyway.`);
  }

  const rawTerminals = Array.isArray(root.terminals)
    ? root.terminals
    : Array.isArray(root.drawings)
      ? [{ drawings: root.drawings }]
      : null;

  if (!rawTerminals) {
    return {
      ok: false,
      terminals: [],
      errors: ['No "terminals" array and no top-level "drawings" array to read.'],
      warnings,
    };
  }

  const terminals: ImportedTerminal[] = [];
  rawTerminals.forEach((entry, terminalIndex) => {
    const record = asObject(entry);
    if (!record) {
      errors.push(`Terminal ${terminalIndex}: not an object.`);
      return;
    }
    const rawDrawings = Array.isArray(record.drawings) ? record.drawings : [];
    const drawings: Drawing[] = [];

    rawDrawings.forEach((raw, drawingIndex) => {
      const parsed = parseDrawing(asObject(raw), `Terminal ${terminalIndex} drawing ${drawingIndex}`, errors, warnings);
      if (parsed) drawings.push(parsed);
    });

    terminals.push({
      id: typeof record.id === "string" ? record.id : undefined,
      symbol: typeof record.symbol === "string" ? record.symbol : undefined,
      interval: typeof record.interval === "string" ? record.interval : undefined,
      title: typeof record.title === "string" ? record.title : undefined,
      drawings,
    });
  });

  const total = terminals.reduce((sum, terminal) => sum + terminal.drawings.length, 0);
  if (total === 0 && errors.length === 0) errors.push("No usable drawings found in the file.");

  return { ok: errors.length === 0 && total > 0, terminals, errors, warnings };
}

function parseDrawing(
  record: Json | null,
  where: string,
  errors: string[],
  warnings: string[]
): Drawing | null {
  if (!record) {
    errors.push(`${where}: not an object.`);
    return null;
  }

  const tool = String(record.tool ?? "");
  if (!(tool in TOOLS)) {
    errors.push(`${where}: unknown tool "${tool}". Expected one of ${Object.keys(TOOLS).join(", ")}.`);
    return null;
  }
  const spec = TOOLS[tool as ToolId];

  const degreeRaw = String(record.degree ?? "intermediate");
  let degree: DegreeKey = "intermediate";
  if (isDegree(degreeRaw)) degree = degreeRaw;
  else {
    // Tolerate the human label ("Grand Supercycle") as well as the key.
    const match = Object.values(DEGREES).find(
      (entry) => entry.label.toLowerCase() === degreeRaw.toLowerCase()
    );
    if (match) degree = match.key;
    else warnings.push(`${where}: unknown degree "${degreeRaw}", defaulted to Intermediate.`);
  }

  const rawPoints = Array.isArray(record.points) ? record.points : [];
  const points: WavePoint[] = [];

  rawPoints.forEach((rawPoint, i) => {
    const point = asObject(rawPoint);
    if (!point) {
      errors.push(`${where}: point ${i} is not an object.`);
      return;
    }
    const price = Number(point.price);
    if (!Number.isFinite(price)) {
      errors.push(`${where}: point ${i} has no numeric price.`);
      return;
    }
    const time = parsePointTime(point);
    if (time === null) {
      errors.push(`${where}: point ${i} has no readable time (expected an ISO string or chart seconds).`);
      return;
    }
    points.push({ time, price });
  });

  if (points.length < 2) {
    errors.push(`${where}: needs at least 2 points, got ${points.length}.`);
    return null;
  }
  if (points.length > spec.points) {
    warnings.push(`${where}: ${points.length} points for a ${spec.points}-point tool; extras were dropped.`);
    points.length = spec.points;
  }
  if (points.length < spec.points) {
    warnings.push(`${where}: ${points.length} of ${spec.points} points — imported as an incomplete count.`);
  }

  // Points out of time order are almost always a transcription slip; sorting
  // silently would hide a real mistake in a proposed count, so warn.
  const ordered = points.every((point, i) => i === 0 || point.time >= points[i - 1].time);
  if (!ordered) {
    warnings.push(`${where}: points were not in chronological order and have been sorted.`);
    points.sort((a, b) => a.time - b.time);
  }

  const variantRaw = typeof record.variant === "string" ? record.variant : undefined;
  const variant = spec.variants.some((entry) => entry.id === variantRaw)
    ? variantRaw
    : spec.variants[0]?.id;
  if (variantRaw && variant !== variantRaw) {
    warnings.push(`${where}: unknown variant "${variantRaw}", defaulted to "${variant}".`);
  }

  const now = Date.now();
  return {
    id: typeof record.id === "string" && record.id !== "" ? record.id : newId("wd"),
    tool: tool as ToolId,
    degree,
    variant,
    points,
    note: typeof record.note === "string" ? record.note : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Accepts `time` in chart seconds, or `iso`/`time`/`date` as a timestamp
 * string. ISO input is converted through `toChartTime` so it lands on the same
 * axis the chart draws on.
 */
function parsePointTime(point: Json): number | null {
  const numeric = Number(point.time);
  if (Number.isFinite(numeric) && numeric > 1e8) return Math.round(numeric);

  for (const key of ["iso", "time", "date", "datetime"]) {
    const value = point[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    const parsed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (Number.isFinite(parsed)) return toChartTime(parsed);
  }
  return null;
}

function asObject(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

/** Compact on-disk form for the browser's own saved sessions. */
export interface PersistedTerminal {
  symbol: string;
  title: string;
  instrumentToken?: number;
  interval: string;
  chartType: string;
  scale: string;
  drawings: Drawing[];
  degree: DegreeKey;
  indicators: unknown;
}
