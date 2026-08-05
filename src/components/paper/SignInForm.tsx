"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  // Only allow same-origin relative paths back, so a crafted ?next= cannot turn
  // the login into an open redirect.
  const next = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : "/paper-trading";

  const [mode, setMode] = React.useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    try {
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
          return;
        }
        setNotice("Account created. Confirm the link in your email, then sign in.");
        setMode("sign-in");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full p-6">
      <h1 className="text-lg font-semibold">Paper trading</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "sign-in"
          ? "Sign in to load your replay sessions and journal."
          : "Create an account to start a replay session."}
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
            {notice}
          </p>
        ) : null}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-muted-foreground underline underline-offset-4"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
          setNotice(null);
        }}
      >
        {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </Card>
  );
}
