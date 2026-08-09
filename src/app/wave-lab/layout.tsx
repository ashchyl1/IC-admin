import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wave Lab — Elliott Wave analysis",
  description:
    "Two chart terminals with the full Elliott Wave toolset, Fibonacci and Lucas validation, Bollinger Bands and EMAs, fed from Zerodha. Analysis only — no orders are placed.",
};

/**
 * The workspace owns the whole viewport and manages its own scrolling, so this
 * layout exists only to keep the body from adding one of its own.
 */
export default function WaveLabLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 overflow-hidden">{children}</div>;
}
