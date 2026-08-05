import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Clickable stock tag used everywhere a recommendation's stocks are shown.
 * Clicking opens the Bird's Eye View for that stock. Server-component safe.
 */
export function StockTag({
  stockId,
  displayName,
  size = "sm",
  className,
}: {
  stockId: string;
  displayName: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Link
      href={`/stocks/${encodeURIComponent(stockId)}/bird-eye`}
      title={`Bird's Eye View: ${displayName}`}
      className={cn(
        "inline-flex items-center rounded-md bg-primary/10 font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
    >
      {displayName}
    </Link>
  );
}
