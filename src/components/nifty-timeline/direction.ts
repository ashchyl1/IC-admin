import type { Direction } from "@/lib/nifty-timeline/recommendations";

/**
 * One palette entry per published Trend, shared by the chart and the panel so a
 * regime band and its pill can never disagree about what "Down then Up" means.
 *
 * `pill` is for HTML, `swatch` for SVG. The SVG side is a plain colour string
 * rather than a Tailwind `fill-*` class because these marks need explicit
 * opacities, and an alpha modifier on a `hsl(var(--x))` colour is not something
 * Tailwind can compose. Both still track the theme through the variable.
 */
export const DIRECTION_STYLE: Record<
  Direction,
  { label: string; pill: string; swatch: string }
> = {
  Up: {
    label: "Up",
    pill: "bg-buy/10 text-buy ring-buy/30",
    swatch: "hsl(var(--kite-buy, 122 39% 49%))",
  },
  Down: {
    label: "Down",
    pill: "bg-sell/10 text-sell ring-sell/30",
    swatch: "hsl(var(--kite-sell, 14 100% 57%))",
  },
  DownThenUp: {
    label: "Down then Up",
    pill: "bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400",
    swatch: "rgb(245 158 11)",
  },
  Neutral: {
    label: "Neutral",
    pill: "bg-muted text-muted-foreground ring-border",
    swatch: "rgb(148 163 184)",
  },
};

/** Theme variables, resolved at paint time, for SVG attributes. */
export const CHART_COLORS = {
  buy: "hsl(var(--kite-buy, 122 39% 49%))",
  sell: "hsl(var(--kite-sell, 14 100% 57%))",
  border: "hsl(var(--border))",
  muted: "hsl(var(--muted-foreground))",
  primary: "hsl(var(--primary))",
  foreground: "hsl(var(--foreground))",
  card: "hsl(var(--card))",
};
