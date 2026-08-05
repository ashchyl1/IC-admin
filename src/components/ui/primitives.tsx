import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive" | "subtle";
export type ButtonSize = "sm" | "md" | "icon";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-input bg-transparent hover:bg-accent",
  ghost: "hover:bg-accent",
  subtle: "bg-muted text-foreground hover:bg-accent",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  icon: "h-9 w-9",
};

/**
 * Button styling for elements that aren't <button>s (e.g. <Link>/<a> styled as
 * buttons). Nesting a <Button> inside a link is invalid HTML — use this instead.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
    );
  }
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function Badge({
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "green" | "amber" | "red" | "blue" | "slate" }) {
  const tones: Record<string, string> = {
    default: "bg-muted text-muted-foreground",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

export function statusTone(status: string): "green" | "slate" | "amber" {
  return status === "active" ? "green" : status === "closed" ? "slate" : "amber";
}

export function sourceTone(source: string): "blue" | "green" | "amber" | "slate" | "red" {
  return (
    { manual: "blue", website: "green", excel: "amber", scrape: "red", api: "slate" } as const
  )[source] ?? "slate";
}

export function typeTone(recommendationType: string): "green" | "amber" | "red" | "slate" {
  return (
    { Enter: "green", Update: "amber", Exit: "red" } as const
  )[recommendationType] ?? "slate";
}
