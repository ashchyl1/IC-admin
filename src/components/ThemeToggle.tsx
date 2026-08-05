"use client";
import * as React from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Light/dark switch. The theme class is applied to <html> before hydration by
 * the inline script in the root layout; this button just flips it and persists
 * the choice. Rendered only after mount so the icon never mismatches on hydration.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = React.useState(false);
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {mounted ? (dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />) : <Moon className="h-4 w-4" />}
    </button>
  );
}
