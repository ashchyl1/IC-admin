import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "IndiaCharts Recommendations Admin",
  description: "Admin portal for stock-market recommendation records",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Apply the saved theme before anything paints to avoid a light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.theme==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        {/* Each route group brings its own chrome: (admin) renders the sidebar
            shell, /paper-trading renders the full-width terminal. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
