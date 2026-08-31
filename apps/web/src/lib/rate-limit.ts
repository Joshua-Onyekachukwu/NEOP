/**
 * In-memory rate limiter for Next.js API routes.
 *
 * Uses a sliding-window counter per IP address.
 * Works in Vercel serverless (each instance has its own Map, but limits are per-instance
 * which is acceptable — a real deployment would use Redis/Upstash).
 *
 * Usage:
 *   const limiter = rateLimit({ windowMs: 60_000, max: 60 });
 *   const result = limiter.check(request);
 *   if (!result.ok) return rateLimitResponse(result);
 */

import { NextRequest, NextResponse } from "next/server";

interface RateLimitConfig {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Maximum requests per window per IP */
  max: number;
}

interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
}

// In-memory store — resets on cold start (acceptable for serverless)
const store = new Map<string, { count: number; resetMs: number }>();

// Cleanup old entries every 5 minutes
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 300_000) return;
  lastCleanup = now;
  for (const [key, val] of store) {
    if (val.resetMs <= now) store.delete(key);
  }
}

function getClientIp(request: NextRequest): string {
  // Vercel/Cloudflare: x-forwarded-for
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  // Fallback
  return request.headers.get("x-real-ip") || "127.0.0.1";
}

/**
 * Create a rate limiter with the given config.
 * Returns a .check() method to test incoming requests.
 */
export function rateLimit(config: RateLimitConfig) {
  cleanup();

  return {
    check(request: NextRequest): RateLimitResult {
      const ip = getClientIp(request);
      const key = `${ip}:${config.windowMs}`;
      const now = Date.now();
      const resetMs = now + config.windowMs;

      const existing = store.get(key);
      if (!existing || existing.resetMs <= now) {
        // New window
        store.set(key, { count: 1, resetMs });
        return { ok: true, remaining: config.max - 1, resetMs, limit: config.max };
      }

      existing.count++;
      const remaining = Math.max(0, config.max - existing.count);

      if (existing.count > config.max) {
        return { ok: false, remaining: 0, resetMs: existing.resetMs, limit: config.max };
      }

      return { ok: true, remaining, resetMs: existing.resetMs, limit: config.max };
    },
  };
}

/**
 * Build a rate-limit exceeded response with proper headers.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.ceil((result.resetMs - Date.now()) / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(retryAfter, 1)),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
      },
    }
  );
}

/**
 * Add rate-limit headers to a successful response.
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));
  return response;
}

// ── Pre-configured limiters ──

/** Public API: generous — 120 req/min per IP */
export const publicLimiter = rateLimit({ windowMs: 60_000, max: 120 });

/** Admin API: moderate — 60 req/min per IP */
export const adminLimiter = rateLimit({ windowMs: 60_000, max: 60 });

/** Agent API: moderate — 60 req/min per IP */
export const agentLimiter = rateLimit({ windowMs: 60_000, max: 60 });

/** Auth endpoints: strict — 10 req/min per IP (prevents brute force) */
export const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });

/** Simulation: very strict — 5 req/min per IP */
export const simulationLimiter = rateLimit({ windowMs: 60_000, max: 5 });

/** Verify endpoints: moderate — 30 req/min per IP */
export const verifyLimiter = rateLimit({ windowMs: 60_000, max: 30 });
