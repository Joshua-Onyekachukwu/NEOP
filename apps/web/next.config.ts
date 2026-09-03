import type { NextConfig } from "next";

const securityHeaders = [
  // ── DDoS / Attack Surface Reduction ──
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-XSS-Protection",
    value: "0", // Modern browsers don't use this; CSP is better
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  // ── Permissions Policy — lock down browser features ──
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=(self)", // Agents need GPS for check-in
      "interest-cohort=()",
      "browsing-topics=()",
      "join-ad-interest-group=()",
      "run-ad-auction=()",
      "ad-storage=()",
      "analytics-storage=()",
    ].join(", "),
  },
  // ── Content Security Policy — prevent injection attacks ──
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://lvtfrfrnqxqwjuematum.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  // ── Prevent Cloudflare from adding X-Powered-By ──
  {
    key: "X-Powered-By",
    value: "VoteWatch",
  },
];

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  async headers() {
    return [
      {
        // Security headers on all pages
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Cache public API responses at CDN level
        source: "/api/public/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
          },
        ],
      },
      {
        // Cache config endpoint longer
        source: "/api/public/config",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
          },
        ],
      },
      {
        // Static assets — aggressive cache
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
