import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scalper Window — paper trading",
  description:
    "Single-screen NIFTY and BANKNIFTY options scalping workspace. Paper trading only — no broker is connected.",
};

/**
 * The workspace takes the whole viewport and manages its own scrolling, so this
 * layout only exists to keep the body from adding one of its own.
 */
export default function ScalperLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 overflow-hidden">{children}</div>;
}
