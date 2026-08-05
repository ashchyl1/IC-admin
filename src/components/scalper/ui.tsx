"use client";

/**
 * Dark-theme primitives for the scalping workspace.
 *
 * The rest of this admin app is light/dark themed through CSS variables. The
 * scalper is deliberately dark-only and self-contained: a trading pad that
 * changes colour with a theme toggle is a pad whose green and red cannot be
 * trusted at a glance.
 */

import * as React from "react";

export const clsx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

// ------------------------------------------------------------------ card ---

export function Panel({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={clsx(
        "flex min-h-0 flex-col rounded-lg border border-slate-800/80 bg-[#111823]",
        className
      )}
    >
      {title !== undefined ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800/70 px-2.5 py-1.5">
          <div className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {title}
          </div>
          {right ? <div className="flex shrink-0 items-center gap-1.5">{right}</div> : null}
        </header>
      ) : null}
      <div className={clsx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

// --------------------------------------------------------------- buttons ---

type ButtonTone = "neutral" | "buy" | "sell" | "accent" | "danger" | "ghost";

const TONES: Record<ButtonTone, string> = {
  neutral:
    "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700 disabled:hover:bg-slate-800",
  buy: "bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500/60 disabled:hover:bg-emerald-600",
  sell: "bg-rose-600 text-white hover:bg-rose-500 border border-rose-500/60 disabled:hover:bg-rose-600",
  accent: "bg-cyan-600 text-white hover:bg-cyan-500 border border-cyan-400/50 disabled:hover:bg-cyan-600",
  danger:
    "bg-rose-950 text-rose-200 hover:bg-rose-900 border border-rose-700/70 disabled:hover:bg-rose-950",
  ghost: "bg-transparent text-slate-300 hover:bg-slate-800 border border-slate-700/70",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; size?: "sm" | "md" | "lg" }
>(function Button({ tone = "neutral", size = "sm", className, ...props }, ref) {
  const sizes = {
    sm: "h-7 px-2.5 text-[11px]",
    md: "h-8 px-3 text-xs",
    lg: "h-11 px-3 text-sm",
  };
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400",
        "disabled:cursor-not-allowed disabled:opacity-40",
        sizes[size],
        TONES[tone],
        className
      )}
    />
  );
});

// -------------------------------------------------------------- controls ---

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  tone = "accent",
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  tone?: "accent" | "warn";
  disabled?: boolean;
}) {
  const on = tone === "warn" ? "bg-amber-500" : "bg-cyan-500";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={typeof label === "string" ? label : undefined}
      title={hint}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400",
        checked
          ? "border-slate-600 bg-slate-800 text-slate-100"
          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      <span
        className={clsx(
          "relative h-3.5 w-6 shrink-0 rounded-full transition-colors",
          checked ? on : "bg-slate-700"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all",
            checked ? "left-3" : "left-0.5"
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "sm",
}: {
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-slate-800 bg-slate-900/60 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={clsx(
              "rounded font-semibold transition-colors",
              size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
              active ? "bg-cyan-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "h-7 rounded-md border border-slate-800 bg-slate-900/60 px-2 text-[11px] font-semibold text-slate-100",
        "focus:border-cyan-500 focus:outline-none",
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberField({
  value,
  onChange,
  label,
  step = 1,
  min = 0,
  max,
  suffix,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <label className={clsx("flex items-center justify-between gap-2 text-[11px]", className)}>
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="h-7 w-24 rounded-md border border-slate-800 bg-slate-900/60 px-2 text-right font-mono text-[11px] text-slate-100 focus:border-cyan-500 focus:outline-none"
        />
        {suffix ? <span className="w-6 text-slate-500">{suffix}</span> : null}
      </span>
    </label>
  );
}

/** Lot stepper: big targets, because this is clicked mid-trade. */
export function Stepper({
  value,
  onChange,
  onBump,
  min = 1,
  max = 99,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  /** Relative change, so a burst of clicks is not flattened by a stale `value`. */
  onBump?: (delta: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  const step = (delta: number) =>
    onBump ? onBump(delta) : onChange(Math.min(max, Math.max(min, value + delta)));

  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        onClick={() => step(-1)}
        disabled={value <= min}
        className="h-7 w-7 rounded-md border border-slate-700 bg-slate-800 text-sm font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
        }}
        className="h-7 w-12 rounded-md border border-slate-700 bg-slate-900 text-center font-mono text-xs font-bold text-slate-100 focus:border-cyan-500 focus:outline-none"
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        onClick={() => step(1)}
        disabled={value >= max}
        className="h-7 w-7 rounded-md border border-slate-700 bg-slate-800 text-sm font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

// ----------------------------------------------------------------- atoms ---

export function Stat({
  label,
  value,
  tone,
  mono = true,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="truncate text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("truncate text-xs font-semibold", mono && "font-mono", tone ?? "text-slate-200")}>
        {value}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "slate",
  title,
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "red" | "amber" | "cyan" | "violet";
  title?: string;
}) {
  const tones = {
    slate: "border-slate-700 bg-slate-800/70 text-slate-300",
    green: "border-emerald-700/60 bg-emerald-900/40 text-emerald-300",
    red: "border-rose-700/60 bg-rose-900/40 text-rose-300",
    amber: "border-amber-600/60 bg-amber-900/40 text-amber-300",
    cyan: "border-cyan-700/60 bg-cyan-900/40 text-cyan-300",
    violet: "border-violet-700/60 bg-violet-900/40 text-violet-300",
  };
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: "green" | "red" | "amber" | "slate" }) {
  const tones = {
    green: "bg-emerald-400",
    red: "bg-rose-400",
    amber: "bg-amber-400",
    slate: "bg-slate-500",
  };
  return <span className={clsx("inline-block h-2 w-2 rounded-full", tones[tone])} aria-hidden="true" />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-slate-700 bg-slate-800 px-1 py-px font-sans text-[10px] font-bold text-slate-300">
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------- drawer ---

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-4xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      />
      <div
        className={clsx(
          "relative flex h-full w-full flex-col border-l border-slate-800 bg-[#0d131c] shadow-2xl",
          width
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-[11px] text-slate-400">{subtitle}</div> : null}
          </div>
          <Button tone="ghost" onClick={onClose}>
            Close <Kbd>Esc</Kbd>
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>
      </div>
    </div>
  );
}
