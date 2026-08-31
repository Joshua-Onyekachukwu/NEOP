/**
 * Next.js Middleware — Rate Limiting + Cache Headers
 *
 * Runs before every request on the Edge runtime.
 * Applies rate limits per route category and cache headers to public endpoints.
 */

import { NextRequest, NextResponse } from "next/server";

// ── In-memory rate limit store (per Edge instance) ──
const store = new Map<string, { count: number; resetMs: number }>();
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, val] of store) {
    if (val.resetMs <= now) store.delete(key);
  }
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "127.0.0.1";
}

function checkRateLimit(
  ip: string,
  category: string,
  windowMs: number,
  max: number
): { ok: boolean; remaining: number; resetMs: number } {
  cleanup();
  const key = `${ip}:${category}`;
  const now = Date.now();
  const resetMs = now + windowMs;

  const existing = store.get(key);
  if (!existing || existing.resetMs <= now) {
    store.set(key, { count: 1, resetMs });
    return { ok: true, remaining: max - 1, resetMs };
  }

  existing.count++;
  const remaining = Math.max(0, max - existing.count);
  return { ok: existing.count <= max, remaining, resetMs: existing.resetMs };
}

// ── Rate limit configs per route category ──
const RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  auth:    { windowMs: 60_000, max: 10 },   // 10/min — brute force protection
  admin:   { windowMs: 60_000, max: 60 },   // 60/min
  agent:   { windowMs: 60_000, max: 60 },   // 60/min
  verify:  { windowMs: 60_000, max: 30 },   // 30/min
  simulate:{ windowMs: 60_000, max: 5 },    // 5/min — expensive
  public:  { windowMs: 60_000, max: 180 },  // 180/min — read-heavy
};

function getCategory(pathname: string): string {
  if (pathname.startsWith("/api/auth")) return "auth";
  if (pathname.startsWith("/api/admin")) return "admin";
  if (pathname.startsWith("/api/me")) return "agent";
  if (pathname.startsWith("/api/verify")) return "verify";
  if (pathname.includes("/simulate")) return "simulate";
  if (pathname.startsWith("/api/")) return "public";
  return ""; // Non-API routes get no rate limiting
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const category = getCategory(pathname);
  if (!category) return NextResponse.next();

  const config = RATE_LIMITS[category];
  const ip = getClientIp(request);
  const result = checkRateLimit(ip, category, config.windowMs, config.max);

  // Build response (either next or rate-limited)
  let response: NextResponse;

  if (!result.ok) {
    const retryAfter = Math.ceil((result.resetMs - Date.now()) / 1000);
    response = NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(retryAfter, 1)),
        },
      }
    );
  } else {
    response = NextResponse.next();
  }

  // Add rate limit headers to all API responses
  response.headers.set("X-RateLimit-Limit", String(config.max));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));

  // ── Cache headers for public endpoints ──
  if (pathname.startsWith("/api/public/")) {
    // Static metadata: 5 min cache
    if (
      pathname === "/api/public/config" ||
      pathname === "/api/public/polling-units"
    ) {
      response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    }
    // Semi-static: 30 sec cache (stats, party results)
    else if (
      pathname === "/api/public/stats" ||
      pathname === "/api/public/party-results"
    ) {
      response.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    }
    // Dynamic: 10 sec cache (results, disruptions, export)
    else if (
      pathname === "/api/public/results" ||
      pathname === "/api/public/disruptions" ||
      pathname === "/api/public/export" ||
      pathname === "/api/public/polling-units/status-changes" ||
      pathname === "/api/public/pu-availability"
    ) {
      response.headers.set("Cache-Control", "public, s-maxage=10, stale-while-revalidate=30");
    }
    // Default for other public endpoints
    else {
      response.headers.set("Cache-Control", "public, s-maxage=15, stale-while-revalidate=60");
    }
  }

  // No cache for admin/agent/write endpoints
  if (
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/me") ||
    pathname.startsWith("/api/verify") ||
    pathname.startsWith("/api/auth")
  ) {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
