/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` and a running `next dev` both write here. Pointing a build at
  // its own directory (NEXT_DIST_DIR=.next-build npm run build) keeps a
  // production build from clobbering the dev server's chunks mid-session.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  // exceljs and prisma are heavy CJS deps; keep them external to the server bundle
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "@prisma/client"],
  },
};

export default nextConfig;
