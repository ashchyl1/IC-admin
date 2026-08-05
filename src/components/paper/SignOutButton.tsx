"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="underline underline-offset-4"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/paper-trading/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
