/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` and a running `next dev` both write here. Pointing a build at
  // its own directory (NEXT_DIST_DIR=.next-build npm run build) keeps a
  // production build from clobbering the dev server's chunks mid-session.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The desktop build ships the server itself, so it needs Next to trace the
  // app and its real dependencies into one directory. Gated on an env flag
  // because `output: "standalone"` changes what `next build` emits, and the
  // web deployment should keep emitting exactly what it does today.
  ...(process.env.DESKTOP_BUILD === "1" ? { output: "standalone" } : {}),
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  // exceljs and prisma are heavy CJS deps; keep them external to the server bundle
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "@prisma/client"],
  },
};

export default nextConfig;
