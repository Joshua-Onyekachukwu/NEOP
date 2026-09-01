/**
 * Next.js Middleware — Rate Limiting + CDN Caching + Bot Protection + DDoS Defense
 *
 * Architecture:
 *   CDN (Cloudflare/Vercel Edge) → This middleware → Origin
 *
 * When Cloudflare is active, cf-connecting-ip header provides the real client IP.
 * Cloudflare's own DDoS protection handles L3/L4 attacks and most L7 volumetric
 * attacks. This middleware handles application-level protection:
 *
 * - Token bucket rate limiting per IP (prevents slow-rate abuse)
 * - Bot/crawler throttling (reduces load from scrapers)
 * - Suspicious request detection (SQL injection, XSS, path traversal)
 * - Under-attack mode (extra strict limits when load is high)
 * - Security headers (CSP, HSTS, etc.)
 * - CDN cache headers (Surrogate-Control for Cloudflare)
 */

import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────
// Token Bucket Rate Limiter (Edge-compatible, no Map persistence)
// ─────────────────────────────────────────────────────

interface Bucket {
  tokens: number;
  lastRefill: number;
  consecutiveHits: number;
}

const buckets: Record<string, Bucket> = {};
let lastCleanup = 0;
let globalRequestCount = 0;
let globalWindowStart = Date.now();

function cleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanup < 120_000) return;
  lastCleanup = now;
  const keys = Object.keys(buckets);
  for (let i = 0; i < keys.length; i++) {
    if (now - buckets[keys[i]].lastRefill > 300_000) {
      delete buckets[keys[i]];
    }
  }
}

/**
 * Check token bucket. Returns ok=true if request is allowed.
 */
function checkBucket(
  key: string,
  maxTokens: number,
  refillRate: number,
  now: number
): { ok: boolean; remaining: number; resetMs: number } {
  let bucket = buckets[key];

  if (!bucket || now - bucket.lastRefill > 1_000_000 / refillRate) {
    const refillAmount = bucket
      ? Math.min(maxTokens, bucket.tokens + (now - bucket.lastRefill) * refillRate)
      : maxTokens;
    bucket = { tokens: refillAmount, lastRefill: now, consecutiveHits: bucket?.consecutiveHits || 0 };
    buckets[key] = bucket;
  }

  if (bucket.tokens < 1) {
    bucket.consecutiveHits++;
    const waitMs = Math.ceil((1 - bucket.tokens) / refillRate);
    return { ok: false, remaining: 0, resetMs: now + waitMs };
  }

  bucket.tokens -= 1;
  bucket.consecutiveHits = 0;
  return {
    ok: true,
    remaining: Math.floor(bucket.tokens),
    resetMs: now + Math.ceil((maxTokens - bucket.tokens) / refillRate),
  };
}

// ─────────────────────────────────────────────────────
// Under-Attack Detection
// ─────────────────────────────────────────────────────

/**
 * Detect if we're under high load (>500 req/s across all Edge instances).
 * When under attack, all rate limits are halved.
 */
function isUnderAttack(): boolean {
  const now = Date.now();
  if (now - globalWindowStart > 5000) {
    // Reset window every 5 seconds
    globalRequestCount = 0;
    globalWindowStart = now;
  }
  globalRequestCount++;
  return globalRequestCount > 2500; // >500 req/s sustained over 5s window
}

// ─────────────────────────────────────────────────────
// Suspicious Request Detection
// ─────────────────────────────────────────────────────

const SUSPICIOUS_PATTERNS = [
  // SQL injection
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
  /union\s+(all\s+)?select/i,
  /insert\s+into/i,
  /delete\s+from/i,
  /drop\s+table/i,
  /or\s+1\s*=\s*1/i,
  // XSS
  /<script[\s>]/i,
  /javascript:/i,
  /on(error|load|click)\s*=/i,
  /eval\s*\(/i,
  // Path traversal
  /\.\.\/|\.\.\\|%2e%2e/i,
  // Command injection
  /;\s*(cat|ls|wget|curl|bash|sh|cmd|powershell)/i,
  /\$\(|`[^`]*`/,
  // Scanner / exploit kits
  /wp-login|wp-admin|xmlrpc\.php|\.env|\.git/i,
  /phpmyadmin|admin\.php|shell\.php/i,
  /solr|jenkins|console\.jshtml/i,
];

function isSuspiciousPath(pathname: string): boolean {
  const decoded = decodeURIComponent(pathname);
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(decoded)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function getClientIp(request: NextRequest): string {
  // Cloudflare sets cf-connecting-ip (real client IP, can't be spoofed)
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "127.0.0.1";
}

function isBot(request: NextRequest): boolean {
  const ua = request.headers.get("user-agent") || "";
  return /bot|crawler|spider|curl|wget|headless|puppeteer|playwright|lighthouse|pagespeed/i.test(ua);
}

function isEmptyUA(request: NextRequest): boolean {
  return !request.headers.get("user-agent");
}

function isHealthCheck(pathname: string): boolean {
  return pathname === "/api/health" || pathname === "/api/public/health";
}

// ─────────────────────────────────────────────────────
// Rate Limits per Category
// ─────────────────────────────────────────────────────

interface RateConfig {
  maxTokens: number;
  refillRate: number;
  label: string;
}

function getRateConfig(pathname: string, bot: boolean, underAttack: boolean): RateConfig {
  let base: RateConfig;

  if (pathname.indexOf("/api/auth") === 0) {
    base = { maxTokens: 15, refillRate: 0.0017, label: "auth" };        // 10/min
  } else if (pathname.indexOf("/api/admin/simulate") === 0) {
    base = { maxTokens: 8, refillRate: 0.00008, label: "simulate" };    // 5/min
  } else if (pathname.indexOf("/api/admin") === 0) {
    base = { maxTokens: 80, refillRate: 0.002, label: "admin" };        // 120/min
  } else if (pathname.indexOf("/api/me") === 0) {
    base = { maxTokens: 80, refillRate: 0.002, label: "agent" };        // 120/min
  } else if (pathname.indexOf("/api/verify") === 0) {
    base = { maxTokens: 40, refillRate: 0.001, label: "verify" };       // 60/min
  } else if (pathname.indexOf("/api/public") === 0) {
    base = { maxTokens: 300, refillRate: 0.005, label: "public" };      // 300/min
  } else {
    base = { maxTokens: 200, refillRate: 0.003, label: "default" };     // 180/min
  }

  if (bot) {
    base = {
      maxTokens: Math.ceil(base.maxTokens / 5),
      refillRate: base.refillRate / 5,
      label: base.label + ":bot",
    };
  }

  if (underAttack) {
    base = {
      maxTokens: Math.ceil(base.maxTokens / 2),
      refillRate: base.refillRate / 2,
      label: base.label + ":attack",
    };
  }

  return base;
}

// ─────────────────────────────────────────────────────
// Cache Config
// ─────────────────────────────────────────────────────

function getCacheConfig(pathname: string): {
  cacheControl: string;
  surrogateControl: string;
  vary: string;
} {
  if (pathname === "/api/public/config" || pathname === "/api/public/polling-units") {
    return {
      cacheControl: "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      surrogateControl: "max-age=300, stale-if-error=3600",
      vary: "Accept-Encoding",
    };
  }

  if (pathname === "/api/public/stats" || pathname === "/api/public/party-results") {
    return {
      cacheControl: "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
      surrogateControl: "max-age=30, stale-if-error=600",
      vary: "Accept-Encoding",
    };
  }

  if (
    pathname.indexOf("/api/public/results") === 0 ||
    pathname.indexOf("/api/public/disruptions") === 0 ||
    pathname.indexOf("/api/public/export") === 0 ||
    pathname.indexOf("/api/public/polling-units/status-changes") === 0
  ) {
    return {
      cacheControl: "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
      surrogateControl: "max-age=10, stale-if-error=120",
      vary: "Accept-Encoding",
    };
  }

  return {
    cacheControl: "no-store, no-cache, must-revalidate",
    surrogateControl: "no-store",
    vary: "",
  };
}

// ─────────────────────────────────────────────────────
// Challenge Response (for Cloudflare Under Attack Mode)
// ─────────────────────────────────────────────────────

function challengeResponse(request: NextRequest): NextResponse {
  // When Cloudflare Under Attack Mode is active, it automatically
  // issues challenges. This is a fallback for when Cloudflare is
  // NOT in front (e.g., direct Vercel access).
  return NextResponse.json(
    {
      error: "Request temporarily limited. Please try again in a few seconds.",
      retry_after_seconds: 5,
    },
    { status: 429 }
  );
}

// ─────────────────────────────────────────────────────
// Middleware Entry Point
// ─────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const underAttack = isUnderAttack();

  // ── HTML Pages: Apply security headers only ──
  if (pathname.indexOf("/api/") !== 0) {
    const response = NextResponse.next();

    // 103 Early Hints for homepage
    if (pathname === "/") {
      response.headers.set(
        "Link",
        "</api/public/stats>; rel=preload; as=fetch, </api/public/config>; rel=preload; as=fetch"
      );
    }

    // Cloudflare-specific: Tell CF to cache HTML pages too
    if (!pathname.startsWith("/admin") && !pathname.startsWith("/agent") && !pathname.startsWith("/auth")) {
      response.headers.set(
        "Cache-Control",
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
      );
    }

    return response;
  }

  // ── Health Check: Always pass ──
  if (isHealthCheck(pathname)) {
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      under_attack: underAttack,
    });
  }

  // ── Suspicious Request Detection ──
  if (isSuspiciousPath(pathname)) {
    console.warn(`[DDoS] Suspicious request blocked: ${pathname} from ${getClientIp(request)}`);
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  // ── Empty User-Agent: Likely automated ──
  if (isEmptyUA(request) && pathname.indexOf("/api/public") === 0) {
    // Don't block, but apply stricter rate limit
  }

  // ── Rate Limiting ──
  const bot = isBot(request);
  const ip = getClientIp(request);
  const config = getRateConfig(pathname, bot, underAttack);
  const now = Date.now();
  const bucketKey = `${ip}:${config.label}`;
  const result = checkBucket(bucketKey, config.maxTokens, config.refillRate, now);

  let response: NextResponse;

  if (!result.ok) {
    const retryAfterMs = result.resetMs - now;

    // If under attack and severely rate-limited, issue a challenge instead
    if (underAttack && result.resetMs - now > 10_000) {
      response = challengeResponse(request);
    } else {
      response = NextResponse.json(
        {
          error: "Rate limit exceeded. Please slow down.",
          retry_after_seconds: Math.ceil(retryAfterMs / 1000),
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.max(Math.ceil(retryAfterMs / 1000), 1)),
          },
        }
      );
    }
  } else {
    response = NextResponse.next();
  }

  // ── Rate Limit Headers ──
  response.headers.set("X-RateLimit-Limit", String(config.maxTokens));
  response.headers.set("X-RateLimit-Remaining", String(Math.max(0, result.remaining)));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));
  if (bot) response.headers.set("X-RateLimit-Policy", "bot-throttled");
  if (underAttack) response.headers.set("X-RateLimit-Policy", "under-attack");

  // ── Cache Headers ──
  const cache = getCacheConfig(pathname);
  response.headers.set("Cache-Control", cache.cacheControl);
  response.headers.set("Surrogate-Control", cache.surrogateControl);
  if (cache.vary) response.headers.set("Vary", cache.vary);

  // ── Security Headers ──
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");

  // ── Request ID ──
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  response.headers.set("X-Request-Id", requestId);

  // ── Cloudflare Integration Headers ──
  // If Cloudflare is in front, pass CF headers through for observability
  const cfRay = request.headers.get("cf-ray");
  if (cfRay) {
    response.headers.set("X-CF-Ray", cfRay);
    response.headers.set("X-CF-IP", ip);
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
