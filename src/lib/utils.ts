import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Deterministic slug used as the Stock master key. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Best-effort ticker guess from a display name (uppercase, no spaces). */
export function symbolGuess(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].toUpperCase().slice(0, 12);
  return words
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 12);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human-readable date, e.g. "17 Jul 2026". UTC-based so stored dates never shift. */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** A generic listing link (not a specific article). */
export function isGenericLink(u: string | null | undefined): boolean {
  if (!u) return true;
  return /\/stocks\/?$/.test(u.trim());
}
