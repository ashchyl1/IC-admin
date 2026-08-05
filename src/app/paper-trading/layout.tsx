import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/paper/SignOutButton";

export const metadata = { title: "Paper trading" };
export const dynamic = "force-dynamic";

export default async function PaperTradingLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3">
          <Link href="/paper-trading" className="text-sm font-semibold">
            Paper trading
          </Link>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
            simulated — no broker connected
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <Link href="/" className="underline underline-offset-4">
              Recommendations admin
            </Link>
            {user ? (
              <>
                <span className="hidden sm:inline">{user.email}</span>
                <SignOutButton />
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-4">{children}</main>
    </div>
  );
}
