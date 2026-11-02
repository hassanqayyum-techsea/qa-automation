import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
    authInterrupts: true, // enables forbidden() for permission checks
    // The icon barrel re-exports ~1,000 icons; without this, dev pages load all of them.
    optimizePackageImports: ["@your-job-search-genius/odyssey-ui"],
    // Console pages read the session and live data on every request by design (see (console)/layout.tsx),
    // so only validate segments that opt in with `export const instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Odyssey UI ships TypeScript source that resolves its internals through "@/".
  transpilePackages: ["@your-job-search-genius/odyssey-ui"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
