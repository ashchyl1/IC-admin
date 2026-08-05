"use client";
import * as React from "react";
import { ChevronDown, ChevronUp, ImageOff, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ZoomableImage } from "@/components/ui/ZoomableImage";
import { cn } from "@/lib/utils";
import type { Recommendation } from "@/lib/nifty-weekly/schema";
import { StructuredPanel, formatWeek } from "./StructuredPanel";

interface Props {
  /** The full feed, newest week first. */
  items: Recommendation[];
  /** Index into `items`, or -1 when the dialog is closed. */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onEdit: (rec: Recommendation) => void;
}

/** Wheel travel (px) needed to move one card. One trackpad flick clears it. */
const WHEEL_THRESHOLD = 40;
/** Ignore wheel input for this long after a move, to swallow momentum tails. */
const NAV_COOLDOWN_MS = 320;

/**
 * True when `target`, or any scrollable ancestor up to `boundary`, still has
 * room to scroll in `dir`.
 *
 * This is what lets a long Notes block scroll normally: the wheel only moves to
 * the next card once the text underneath the pointer has nothing left to give.
 */
function innerCanScroll(target: EventTarget | null, dir: number, boundary: HTMLElement): boolean {
  let node = target instanceof HTMLElement ? target : null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1;
    if (scrollable) {
      // 1px of slack: fractional scrollTop values never reach the exact end.
      if (dir > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      if (dir < 0 && node.scrollTop > 1) return true;
    }
    if (node === boundary) break;
    node = node.parentElement;
  }
  return false;
}

/**
 * The expanded card, with the feed navigable by mouse wheel.
 *
 * Scrolling down moves to the next card *down the feed*, which is the older
 * week — the same direction the list reads. Up goes to the newer week. It stops
 * at both ends rather than wrapping, so you always know where you are.
 */
export function DetailModal({ items, index, onIndexChange, onClose, onEdit }: Props) {
  const open = index >= 0 && index < items.length;
  const rec = open ? items[index] : null;

  const panelRef = React.useRef<HTMLDivElement>(null);
  const textPaneRef = React.useRef<HTMLDivElement>(null);
  const accumulated = React.useRef(0);
  const lastNavAt = React.useRef(0);

  const go = React.useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= items.length) return false;
      onIndexChange(next);
      // Start the incoming card at the top rather than inheriting the previous
      // card's scroll position.
      requestAnimationFrame(() => textPaneRef.current?.scrollTo({ top: 0 }));
      return true;
    },
    [index, items.length, onIndexChange]
  );

  // A native listener, because preventDefault() needs a non-passive wheel
  // handler and React's synthetic onWheel does not guarantee that.
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;

    const onWheel = (e: WheelEvent) => {
      const dir = Math.sign(e.deltaY);
      if (dir === 0) return;
      if (innerCanScroll(e.target, dir, panel)) return; // let the text scroll first

      e.preventDefault();

      const now = Date.now();
      if (now - lastNavAt.current < NAV_COOLDOWN_MS) {
        // Still coasting from the last flick; drop it so momentum cannot skip
        // several weeks at once.
        accumulated.current = 0;
        return;
      }

      // Direction change should not be satisfied by leftover travel.
      if (Math.sign(accumulated.current) !== dir) accumulated.current = 0;
      accumulated.current += e.deltaY;

      if (Math.abs(accumulated.current) < WHEEL_THRESHOLD) return;
      accumulated.current = 0;
      lastNavAt.current = now;
      go(dir);
    };

    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, [open, go]);

  // Keyboard equivalent: the wheel gesture is invisible, and arrows are what a
  // keyboard user will reach for. Escape and Tab are handled by Modal.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if (typing) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        if (go(1)) e.preventDefault();
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        if (go(-1)) e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, go]);

  const atNewest = index <= 0;
  const atOldest = index >= items.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="rec-detail-title"
      className="kite-theme max-w-6xl"
    >
      {rec && (
        <div ref={panelRef}>
          {/* ------------------------------------------------ header ---- */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3 pr-14">
            <h2 id="rec-detail-title" className="text-base font-semibold text-foreground">
              {rec.symbol} {rec.timeframe} — week ending {formatWeek(rec.weekEnding)}
            </h2>

            <button
              type="button"
              onClick={() => onEdit(rec)}
              className="inline-flex items-center gap-1.5 rounded-[3px] border border-input px-2 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>

            {/* Navigation, mirroring the wheel gesture so it is discoverable. */}
            <div className="ml-auto flex items-center gap-1">
              <span className="kite-num mr-1 text-[13px] text-muted-foreground">
                {index + 1} / {items.length}
              </span>
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={atNewest}
                title="Newer week (scroll up, or ↑)"
                aria-label="Newer week"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[3px] border border-input transition-colors",
                  atNewest
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : "text-foreground hover:bg-accent"
                )}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={atOldest}
                title="Older week (scroll down, or ↓)"
                aria-label="Older week"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[3px] border border-input transition-colors",
                  atOldest
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : "text-foreground hover:bg-accent"
                )}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ------------------------------------------------ body ------ */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="flex items-center justify-center border-b bg-muted p-3 lg:border-b-0 lg:border-r">
              {rec.chartImageUrl ? (
                <ZoomableImage
                  key={rec.id}
                  src={rec.chartImageUrl}
                  alt={`${rec.symbol} ${rec.timeframe} chart for the week ending ${rec.weekEnding}`}
                  className="max-h-[70vh] w-full"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                  <ImageOff className="h-7 w-7" />
                  <span className="text-[13px]">No chart image</span>
                </div>
              )}
            </div>

            <div ref={textPaneRef} className="max-h-[70vh] overflow-y-auto p-5">
              <StructuredPanel rec={rec} variant="detail" />
            </div>
          </div>

          <div className="border-t px-5 py-2 text-center text-xs text-muted-foreground">
            Scroll to move between weeks · newer above, older below
          </div>
        </div>
      )}
    </Modal>
  );
}
