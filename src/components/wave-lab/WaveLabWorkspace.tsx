"use client";

/**
 * Wave Lab shell: layout switch, link toggle, theme, connection badge. §3, §10.
 *
 * The layout switch must not lose state, so both terminals stay mounted and the
 * hidden one is collapsed by CSS grid rather than unmounted. Unmounting would
 * throw away each terminal's loaded candles — and, once phase 3 lands, its
 * drawings — every time someone flicked between one and two panes.
 */

import * as React from "react";
import { Columns2, Link2, Link2Off, Moon, Square, Sun, Waves } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/wave-lab/workspace-store";
import { ConnectionBadge } from "./ConnectionBadge";
import { Terminal } from "./Terminal";

export function WaveLabWorkspace() {
  const layout = useWorkspace((s) => s.layout);
  const linked = useWorkspace((s) => s.linked);
  const setLayout = useWorkspace((s) => s.setLayout);
  const setLinked = useWorkspace((s) => s.setLinked);

  const [dark, setDark] = React.useState(false);
  // Zustand's persist hydrates after mount, so the first paint would otherwise
  // use defaults and then snap to stored values — a visible flicker.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setReady(true);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.theme = next ? "dark" : "light";
    } catch {
      // Private mode: the toggle still works for this session.
    }
  }

  return (
    <div
      data-theme={dark ? "dark" : "light"}
      className="wave-lab flex h-screen flex-col bg-[var(--wl-bg)] text-[var(--wl-text)]"
    >
      {/* --------------------------------------------------------- top nav -- */}
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--wl-border)] px-3 py-1.5">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--wl-text-strong)]"
        >
          <Waves className="h-4 w-4 text-[var(--wl-blue)]" />
          Wave Lab
        </Link>
        <span className="rounded-[3px] bg-[var(--wl-subtle)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--wl-muted)]">
          Elliott terminal
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center rounded-[3px] border border-[var(--wl-border)]">
            <LayoutButton on={layout === 1} onClick={() => setLayout(1)} title="One chart">
              <Square className="h-3.5 w-3.5" />
            </LayoutButton>
            <LayoutButton on={layout === 2} onClick={() => setLayout(2)} title="Two charts">
              <Columns2 className="h-3.5 w-3.5" />
            </LayoutButton>
          </div>

          <button
            type="button"
            onClick={() => setLinked(!linked)}
            aria-pressed={linked}
            title={
              linked
                ? "Linked — terminal B follows A's symbol"
                : "Unlinked — each terminal keeps its own symbol"
            }
            className={cn(
              "flex items-center gap-1 rounded-[3px] border px-1.5 py-1 text-[10px] font-semibold tracking-wide transition-colors",
              linked
                ? "border-[var(--wl-blue)] bg-[var(--wl-blue)]/10 text-[var(--wl-blue)]"
                : "border-[var(--wl-border)] text-[var(--wl-muted)] hover:bg-[var(--wl-hover)]"
            )}
          >
            {linked ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
            LINK
          </button>

          <ConnectionBadge />

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-[3px] border border-[var(--wl-border)] p-1 text-[var(--wl-muted)] transition-colors hover:bg-[var(--wl-hover)]"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {/* ------------------------------------------------------- terminals -- */}
      <main
        className={cn(
          "grid min-h-0 flex-1 gap-1 p-1",
          // Rows must be explicit. With auto rows the stacked pane sizes to
          // content, and terminal B collapses to ~30px while A takes the lot.
          layout === 2
            ? "grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1"
            : "grid-cols-1 grid-rows-1"
        )}
      >
        {ready ? (
          <>
            {/* Both wrapped identically: an asymmetric wrapper was the other
                half of the collapse, since Terminal fills its parent. */}
            <div className="flex min-h-0 min-w-0">
              <Terminal id="A" dark={dark} />
            </div>
            {/* Kept mounted when hidden, so switching layout loses nothing. */}
            <div className={cn("flex min-h-0 min-w-0", layout === 1 && "hidden")}>
              <Terminal id="B" dark={dark} />
            </div>
          </>
        ) : (
          <div className="grid place-items-center text-[13px] text-[var(--wl-muted)]">
            Loading workspace…
          </div>
        )}
      </main>
    </div>
  );
}

function LayoutButton({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        "p-1 transition-colors",
        on
          ? "bg-[var(--wl-blue)] text-white"
          : "text-[var(--wl-muted)] hover:bg-[var(--wl-hover)] hover:text-[var(--wl-text)]"
      )}
    >
      {children}
    </button>
  );
}
