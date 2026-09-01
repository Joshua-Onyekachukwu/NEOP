/**
 * NEOP DDoS Protection Worker
 *
 * Runs on Cloudflare's edge network — BEFORE traffic reaches Vercel.
 * Provides:
 *   1. Geographic filtering (optional — block non-Nigerian traffic)
 *   2. Advanced bot detection and blocking
 *   3. Challenge pages for suspicious traffic
 *   4. Rate limiting that persists across edge locations (KV-backed)
 *   5. Blocked IP list
 *   6. Known attack pattern blocking
 *
 * Deploy with: npx wrangler deploy
 */

interface Env {
  // KV namespace for rate limiting (create via wrangler kv:namespace create RATE_LIMITS)
  RATE_LIMITS: KVNamespace;
  // Optional: admin secret for managing blocked IPs
  ADMIN_SECRET: string;
}

// ── Configuration ──

const CONFIG = {
  // Set to true to block traffic from outside Nigeria
  // WARNING: Enable only on election day — blocks diaspora viewers
  GEO_BLOCK_ENABLED: false,

  // Allowed countries (ISO 3166-1 alpha-2)
  // When GEO_BLOCK_ENABLED is true, only these countries can access
  ALLOWED_COUNTRIES: ["NG"],

  // Rate limits: requests per minute per IP
  RATE_LIMITS: {
    default: 200,
    api: 100,
    "api/auth": 15,
    "api/admin": 60,
    "api/admin/simulate": 5,
    "api/public": 300,
  },

  // Challenge duration in seconds
  CHALLENGE_DURATION: 300,

  // Blocked user agents (partial matches)
  BLOCKED_UA: [
    "sqlmap",
    "nikto",
    "nessus",
    "masscan",
    "nmap",
    "zgrab",
    "gobuster",
    "dirbuster",
    "ffuf",
    "wfuzz",
    "hydra",
    "medusa",
    "burpsuite",
    "owasp zap",
  ],
};

// ── Main Handler ──

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // ── Admin API: manage blocked IPs ──
    if (url.pathname === "/__admin/block-ip") {
      return handleAdmin(request, env);
    }

    // ── Health check: always pass ──
    if (url.pathname === "/api/health") {
      return fetch(request);
    }

    // ── Geographic blocking ──
    if (CONFIG.GEO_BLOCK_ENABLED) {
      const country = request.headers.get("cf-ipcountry") || "XX";
      if (!CONFIG.ALLOWED_COUNTRIES.includes(country)) {
        return new Response(
          JSON.stringify({
            error: "This service is currently only available in Nigeria.",
            message: "During the election period, access is restricted to Nigerian IP addresses.",
          }),
          {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // ── Blocked user agent ──
    const ua = (request.headers.get("user-agent") || "").toLowerCase();
    for (const blocked of CONFIG.BLOCKED_UA) {
      if (ua.includes(blocked)) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // ── Blocked IPs (KV-backed) ──
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const blockedKey = `blocked:${ip}`;
    if (env.RATE_LIMITS) {
      const isBlocked = await env.RATE_LIMITS.get(blockedKey);
      if (isBlocked) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // ── Rate limiting (KV-backed, persists across edge locations) ──
    if (env.RATE_LIMITS) {
      const rateResult = await checkRateLimit(env.RATE_LIMITS, ip, url.pathname);
      if (!rateResult.allowed) {
        return new Response(
          JSON.stringify({
            error: "Rate limit exceeded",
            retry_after_seconds: rateResult.retryAfter,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(rateResult.retryAfter),
              "X-RateLimit-Limit": String(rateResult.limit),
              "X-RateLimit-Remaining": "0",
            },
          }
        );
      }
    }

    // ── Path-based suspicious request detection ──
    const suspiciousPatterns = [
      /\.\.\/|\.\.\\|%2e%2e/i,
      /union\s+(all\s+)?select/i,
      /<script/i,
      /javascript:/i,
      /wp-login|wp-admin|xmlrpc|\.env|\.git/i,
      /phpmyadmin|admin\.php|shell\.php/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(decodeURIComponent(url.pathname))) {
        console.warn(`[DDoS] Blocked suspicious path: ${url.pathname} from ${ip}`);
        return new Response("Forbidden", { status: 403 });
      }
    }

    // ── Challenge suspicious traffic ──
    // If request has no User-Agent or suspicious patterns, issue a challenge
    if (!ua || (ua.length < 10 && !url.pathname.startsWith("/api/public"))) {
      // For API requests without UA, return 403
      if (url.pathname.startsWith("/api/")) {
        return new Response(
          JSON.stringify({ error: "User-Agent required" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // ── Pass through to origin (Vercel) ──
    const response = await fetch(request);

    // ── Add Cloudflare observability headers ──
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("X-Served-By", "Cloudflare-NEOP");

    return newResponse;
  },
};

// ── Rate Limiting with KV ──

async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  pathname: string
): Promise<{ allowed: boolean; retryAfter: number; limit: number }> {
  // Determine rate limit based on path
  let limit = CONFIG.RATE_LIMITS.default;
  for (const [prefix, max] of Object.entries(CONFIG.RATE_LIMITS)) {
    if (pathname.startsWith(`/${prefix}`) || pathname === `/${prefix}`) {
      limit = max;
      break;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `ratelimit:${ip}:${pathname}:${Math.floor(now / 60)}`;
  const prevWindowKey = `ratelimit:${ip}:${pathname}:${Math.floor(now / 60) - 1}`;

  // Get current window count
  const current = parseInt((await kv.get(windowKey)) || "0", 10);
  const prev = parseInt((await kv.get(prevWindowKey)) || "0", 10);

  // Sliding window: weigh previous window by remaining time
  const weight = (60 - (now % 60)) / 60;
  const effectiveCount = prev * weight + current;

  if (effectiveCount >= limit) {
    const retryAfter = 60 - (now % 60);
    return { allowed: false, retryAfter, limit };
  }

  // Increment counter
  await kv.put(windowKey, String(current + 1), { expirationTtl: 120 });

  return {
    allowed: true,
    retryAfter: 0,
    limit,
  };
}

// ── Admin API for managing blocked IPs ──

async function handleAdmin(request: Request, env: Env): Promise<Response> {
  // Verify admin secret
  const authHeader = request.headers.get("Authorization");
  if (!env.ADMIN_SECRET || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const ip = url.searchParams.get("ip");

  if (!ip) {
    return new Response(
      JSON.stringify({ error: "Missing ?ip= parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (request.method === "POST") {
    // Block IP
    await env.RATE_LIMITS.put(`blocked:${ip}`, "true", { expirationTtl: 86400 });
    return new Response(
      JSON.stringify({ blocked: ip, expires_in: "24h" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  if (request.method === "DELETE") {
    // Unblock IP
    await env.RATE_LIMITS.delete(`blocked:${ip}`);
    return new Response(
      JSON.stringify({ unblocked: ip }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // GET: check if IP is blocked
  const isBlocked = await env.RATE_LIMITS.get(`blocked:${ip}`);
  return new Response(
    JSON.stringify({ ip, blocked: !!isBlocked }),
    { headers: { "Content-Type": "application/json" } }
  );
}
