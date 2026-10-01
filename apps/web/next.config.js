/** @type {import('next').NextConfig} */
const nextConfig = {
  // Catch TypeScript and ESLint errors at build time
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // Standalone output for lean Docker image
  output: "standalone",

  // Forward /api/* calls to the Express backend
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/:path*`,
      },
    ];
  },

  poweredByHeader: false,
};

module.exports = nextConfig;
