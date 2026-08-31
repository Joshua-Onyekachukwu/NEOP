/**
 * Next.js Middleware — Rate Limiting + Cache Headers
 *
 * Runs before every API request on the Edge runtime.
 * Uses plain objects (not Map) for Edge compatibility.
 * Placed at project root (required by Next.js 15).
 */

import { NextRequest, NextResponse } from "next/server";

// ── In-memory rate limit store ──
let store: Record<string, { count: number; resetMs: number }> = {};
let lastCleanup = 0;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;
  const keys = Object.keys(store);
  for (let i = 0; i < keys.length; i++) {
    if (store[keys[i]] && store[keys[i]].resetMs <= now) {
      delete store[keys[i]];
    }
  }
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "127.0.0.1";
}

function checkLimit(
  ip: string,
  category: string,
  windowMs: number,
  max: number
): { ok: boolean; remaining: number; resetMs: number } {
  cleanup();
  const key = ip + ":" + category;
  const now = Date.now();
  const resetMs = now + windowMs;

  const existing = store[key];
  if (!existing || existing.resetMs <= now) {
    store[key] = { count: 1, resetMs };
    return { ok: true, remaining: max - 1, resetMs };
  }

  existing.count++;
  return {
    ok: existing.count <= max,
    remaining: Math.max(0, max - existing.count),
    resetMs: existing.resetMs,
  };
}

// ── Category detection ──
function getCategory(pathname: string): string {
  if (pathname.indexOf("/api/auth") === 0) return "auth";
  if (pathname.indexOf("/api/admin/simulate") === 0) return "simulate";
  if (pathname.indexOf("/api/admin") === 0) return "admin";
  if (pathname.indexOf("/api/me") === 0) return "agent";
  if (pathname.indexOf("/api/verify") === 0) return "verify";
  if (pathname.indexOf("/api/") === 0) return "public";
  return "";
}

function getLimit(category: string): { windowMs: number; max: number } {
  switch (category) {
    case "auth":     return { windowMs: 60000, max: 10 };
    case "admin":    return { windowMs: 60000, max: 60 };
    case "agent":    return { windowMs: 60000, max: 60 };
    case "verify":   return { windowMs: 60000, max: 30 };
    case "simulate": return { windowMs: 60000, max: 5 };
    case "public":   return { windowMs: 60000, max: 180 };
    default:         return { windowMs: 60000, max: 180 };
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept API routes
  if (pathname.indexOf("/api/") !== 0) {
    return NextResponse.next();
  }

  const category = getCategory(pathname);
  if (!category) return NextResponse.next();

  const config = getLimit(category);
  const ip = getClientIp(request);
  const result = checkLimit(ip, category, config.windowMs, config.max);

  let response: NextResponse;

  if (!result.ok) {
    const retryAfter = Math.ceil((result.resetMs - Date.now()) / 1000);
    response = NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.max(retryAfter, 1)) } }
    );
  } else {
    response = NextResponse.next();
  }

  // ── Rate limit headers on ALL API responses ──
  response.headers.set("X-RateLimit-Limit", String(config.max));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));

  // ── Cache headers ──

  // Public endpoints — CDN cache
  if (pathname.indexOf("/api/public/") === 0) {
    if (
      pathname === "/api/public/config" ||
      pathname === "/api/public/polling-units"
    ) {
      // Static metadata: 5 min CDN
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=300, stale-while-revalidate=600"
      );
    } else if (
      pathname === "/api/public/stats" ||
      pathname === "/api/public/party-results"
    ) {
      // Semi-static: 30 sec CDN
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=30, stale-while-revalidate=120"
      );
    } else {
      // Dynamic: 10 sec CDN (results, disruptions, export, status-changes)
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=10, stale-while-revalidate=30"
      );
    }
  }

  // Admin/agent/auth/verify — never cache
  if (
    pathname.indexOf("/api/admin") === 0 ||
    pathname.indexOf("/api/me") === 0 ||
    pathname.indexOf("/api/verify") === 0 ||
    pathname.indexOf("/api/auth") === 0
  ) {
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
