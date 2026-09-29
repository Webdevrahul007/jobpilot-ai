import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Catch TypeScript and ESLint errors at build time — never deploy broken code
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // Standalone output bundles everything needed to run without node_modules
  // Required for the production Docker image to be lean
  output: "standalone",

  // Forward /api/* calls to the Express backend during dev and prod
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000/api/v1"}/:path*`,
      },
    ];
  },

  // Reduce attack surface
  poweredByHeader: false,
};

export default nextConfig;
