"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard", exact: true },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/nifty-weekly", label: "Nifty Weekly" },
  { href: "/stocks", label: "Stocks" },
  { href: "/strike-selector", label: "Strike Selector" },
  { href: "/import-export", label: "Import/Export" },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b bg-card px-3 py-2 scroll-thin">
      {NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <ThemeToggle className="ml-auto shrink-0" />
    </header>
  );
}
