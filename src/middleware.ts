import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase auth cookie and gates the paper-trading area.
 *
 * The matcher is scoped deliberately: the existing recommendations admin has
 * its own access model and must keep working untouched, so this middleware
 * never runs for those routes.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() revalidates the token with Supabase; getSession() would trust the
  // cookie contents, which is not safe to authorise on.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // The sign-in page lives under /paper-trading, so it has to be exempt from
  // the gate below or an unauthenticated visit redirects to itself forever.
  const isSignIn = pathname === "/paper-trading/sign-in";

  if (!user && !isSignIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/paper-trading/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isSignIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/paper-trading";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/paper-trading/:path*"],
};
