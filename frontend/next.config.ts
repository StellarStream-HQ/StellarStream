import type { NextConfig } from "next";

const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL ?? "";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },

  // ── Experimental Features ───────────────────────────────────────────────────
  experimental: {
    // Optimize imports to reduce bundle size
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  // ── Production Optimizations ───────────────────────────────────────────────
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  
  // ── React Configuration ────────────────────────────────────────────────────
  reactStrictMode: true,

  // ── CDN asset prefix ────────────────────────────────────────────────────────
  // When NEXT_PUBLIC_CDN_URL is set (e.g. https://cdn.stellarstream.app),
  // Next.js will rewrite all /_next/static/* and /public/* asset URLs to
  // point at the CDN edge, giving users in high-latency regions (Africa,
  // SE Asia) cached responses from the nearest PoP.
  assetPrefix: CDN_URL || undefined,

  // ── Image optimisation ──────────────────────────────────────────────────────
  images: {
    // Serve optimised images from the CDN when available
    path: CDN_URL ? `${CDN_URL}/_next/image` : "/_next/image",

    // Accept WebP and AVIF for modern browsers; fall back to original format
    formats: ["image/avif", "image/webp"],

    // Cache optimised images at the edge for 7 days (in seconds)
    minimumCacheTTL: 60 * 60 * 24 * 7,

    // Allow images served from the API backend and common CDN domains
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.stellarstream.app",
      },
      {
        protocol: "https",
        hostname: "**.stellarstream.app",
      },
    ],

    // Disable the built-in loader when a CDN is configured so the CDN
    // handles resizing instead of the Next.js image server
    ...(CDN_URL
      ? { loader: "custom", loaderFile: "./lib/cdn-image-loader.ts" }
      : {}),
  },

  // ── HTTP response headers ───────────────────────────────────────────────────
  async headers() {
    return [
      // Static assets: immutable, 1-year cache + CDN edge cache
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          // Instruct Vercel/Cloudflare edge to cache for 1 year
          { key: "CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Vercel-CDN-Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Public SVG / WebP / AVIF assets
      {
        source: "/:path*.(svg|webp|avif|png|jpg|jpeg|ico|woff2|woff)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
          { key: "CDN-Cache-Control", value: "public, max-age=604800" },
          { key: "Vercel-CDN-Cache-Control", value: "public, max-age=604800" },
        ],
      },
      // Public stream preview pages: short CDN TTL so data stays fresh
      {
        source: "/view-stream/:id*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=60, stale-while-revalidate=300",
          },
          { key: "CDN-Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" },
          { key: "Vercel-CDN-Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" },
        ],
      },
    ];
  },

  compiler: {
    // Strip console.log in production; keep console.error and console.warn
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },

  // ── Redirects & Rewrites ───────────────────────────────────────────────────
  async redirects() {
    return [
      // Redirect old routes if needed
      {
        source: "/old-path",
        destination: "/new-path",
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        // API rewrites
        {
          source: "/api/:path*",
          destination: "/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
