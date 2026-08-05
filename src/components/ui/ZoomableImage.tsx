"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  src: string;
  alt?: string;
  className?: string;
}

/**
 * An <img> that opens full-screen on click. The overlay renders in a portal at
 * a high z-index (above modals), closes on backdrop click / Esc, and locks page
 * scroll while open.
 */
export function ZoomableImage({ src, alt = "", className }: Props) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Click to view full screen"
        className={cn("group relative block cursor-zoom-in overflow-hidden", className)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="h-full w-full object-contain" />
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>

      {mounted && open &&
        createPortal(
          <div
            className="modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 sm:p-8"
            onClick={() => setOpen(false)}
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              className="modal-panel max-h-full max-w-full cursor-default rounded-md object-contain shadow-2xl"
            />
          </div>,
          document.body
        )}
    </>
  );
}
