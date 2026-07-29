/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The borrower portal is deliberately dependency-poor (design 05 §10.1):
  // no engine, no tRPC root, no grid. Anything added here widens the blast
  // radius of an internet-facing, unauthenticated-entry surface.
  //
  // No root-level `loading.tsx` exists in this app and none may be added: a
  // full-viewport route Suspense fallback never resolved in a PRODUCTION
  // build and froze apps/web on 2026-07-29.
  poweredByHeader: false,
};

export default nextConfig;
