"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListChecks,
  Building2,
  ArrowLeftRight,
  LineChart,
  Crosshair,
  CalendarRange,
  CandlestickChart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/recommendations", label: "Recommendations", icon: ListChecks },
  { href: "/nifty-weekly", label: "Nifty Weekly", icon: CalendarRange },
  { href: "/stocks", label: "Stocks", icon: Building2 },
  { href: "/strike-selector", label: "Strike Selector", icon: Crosshair },
  { href: "/import-export", label: "Import / Export", icon: ArrowLeftRight },
];

/**
 * Kept in its own group because it is a different kind of destination: a
 * full-width workspace with its own chrome and its own Supabase login, not
 * another page inside this sidebar shell. Grouping it separately sets that
 * expectation before the click rather than after.
 */
const WORKSPACES = [
  { href: "/paper-trading", label: "Paper Trading", icon: CandlestickChart },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <LineChart className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold">IndiaCharts</div>
          <div className="text-xs text-muted-foreground">Recommendations</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Workspaces
        </div>
        {WORKSPACES.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center justify-between border-t p-4 text-xs text-muted-foreground">
        <div>
          <div className="font-medium text-foreground">Admin</div>
          <div>Single-user MVP</div>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
