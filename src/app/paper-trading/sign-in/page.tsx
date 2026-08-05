import { Suspense } from "react";
import { Card } from "@/components/ui/primitives";
import { SignInForm } from "@/components/paper/SignInForm";

export const dynamic = "force-dynamic";

/**
 * The form reads `?next=` with useSearchParams(), which Next requires to sit
 * under a Suspense boundary. Without one the whole page silently de-opts to
 * client-side rendering, so the server sends a shell that does not match what
 * React then renders — a hydration mismatch on the login screen.
 */
export default function SignInPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
      <Suspense
        fallback={
          <Card className="w-full p-6">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-4 w-56 animate-pulse rounded bg-muted" />
            <div className="mt-6 h-9 w-full animate-pulse rounded bg-muted" />
            <div className="mt-4 h-9 w-full animate-pulse rounded bg-muted" />
            <div className="mt-6 h-9 w-full animate-pulse rounded bg-muted" />
          </Card>
        }
      >
        <SignInForm />
      </Suspense>
    </div>
  );
}
