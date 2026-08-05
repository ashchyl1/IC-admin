import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";

/**
 * Chrome for the recommendations admin: sidebar, mobile nav, padded main.
 *
 * This lives in a route group so the decision of "which shell" is made by the
 * router on the server, from the URL. It used to be a client component in the
 * root layout that branched on usePathname(), which is a hydration hazard: the
 * server and the client can disagree about the pathname on the first render and
 * then produce different DOM. Route groups do not change the URLs.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
