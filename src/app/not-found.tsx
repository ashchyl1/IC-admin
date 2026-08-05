import Link from "next/link";
import { buttonClasses } from "@/components/ui/primitives";

/**
 * Root 404 for anything outside the (admin) group — that group keeps its own
 * not-found.tsx so admin 404s still render inside the sidebar shell.
 */
export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-8">
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          That page doesn&apos;t exist, or it isn&apos;t yours to view.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className={buttonClasses("outline")}>
            Dashboard
          </Link>
          <Link href="/paper-trading" className={buttonClasses("primary")}>
            Paper trading
          </Link>
        </div>
      </div>
    </div>
  );
}
