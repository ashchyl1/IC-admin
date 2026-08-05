"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** id of the element that labels the dialog (for a11y) */
  labelledBy?: string;
}

/**
 * Generic modal: dimmed backdrop, click-outside + Esc to close, portal to
 * <body>, and a scroll lock while open. Renders above page content (z-50) and
 * is self-contained so it never interferes with other modals or the editor.
 */
export function Modal({ open, onClose, children, className, labelledBy }: ModalProps) {
  // Portals need the DOM; render nothing until mounted (SSR-safe).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    // Move focus into the dialog, keep Tab cycling inside it, and give focus
    // back to the opener on close.
    const opener = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panelRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      {/* Dimmed backdrop — clicking it closes the modal */}
      <div
        className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          "focus-visible:outline-none",
          "modal-panel relative z-10 my-6 w-full max-w-3xl rounded-lg border bg-card text-card-foreground shadow-2xl",
          className
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}
