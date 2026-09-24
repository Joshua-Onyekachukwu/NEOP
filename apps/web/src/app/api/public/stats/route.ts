/**
 * GET /api/public/stats
 *
 * Dashboard statistics endpoint.
 * Uses shared api-cache layer — database hit only once per 30 seconds.
 * CDN serves from edge for 30s, stale for 120s.
 *
 * Also acts as an OPPORTUNISTIC SIMULATION PUMP: while a simulation run
 * is active, each request (throttled to once per minute per warm
 * instance, fire-and-forget) calls the tick endpoint so queued steps
 * keep executing. This keeps production runs progressing across
 * serverless cold starts even when Vercel Cron is unavailable
 * (Hobby plans run crons at most once/day). The pump is a no-op when
 * no run is active.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedStats } from "@/lib/api-cache";
import { publicLimiter, rateLimitResponse, addRateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ── Opportunistic pump state (per warm serverless instance) ─────
// Backstop only. The authoritative driver is the in-database pg_cron job
// (`SELECT neop_sim_tick_local(24, 50000)` every minute), which needs no
// external runtime. This HTTP pump exists for the case where that job is
// unavailable — but it is a SECOND driver racing the same single-flight
// claim_simulation_step(), and every warm instance carries its own timer, so
// it multiplies into several competing drivers per minute. Measured Sep 24:
// with the public site actively polling, run throughput fell from the tick's
// 24 steps/min ceiling to ~11/min purely on that contention. Kept as a
// 10-minute fallback so it costs ~1 extra claim/minute instead of ~1/instance.
let lastPumpAt = 0;
const PUMP_INTERVAL_MS = 600_000;

function pumpSimulationQueue(request: NextRequest): void {
  const now = Date.now();
  if (now - lastPumpAt < PUMP_INTERVAL_MS) return;
  lastPumpAt = now;

  // Fire-and-forget: never delays or fails the public response.
  (async () => {
    try {
      const secret = process.env.CRON_SECRET;
      const origin = request.nextUrl.origin;
      const res = await fetch(`${origin}/api/admin/simulate/tick?max=10`, {
        method: "POST",
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(50_000),
      });
      const body: any = await res.json().catch(() => null);
      if (body?.processed || body?.last_error) {
        console.log(
          `[stats-pump] steps=${body.processed ?? 0} remaining=${body.remaining ?? "?"}` +
            (body.last_error ? ` err=${body.last_error}` : "")
        );
      }
    } catch {
      // Pump is best-effort only; public stats never fails because of it.
    }
  })();
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = publicLimiter.check(request);
  if (!rateResult.ok) return rateLimitResponse(rateResult);

  // Drive the active simulation run if one exists (throttled, async).
  pumpSimulationQueue(request);

  try {
    const stats = await getCachedStats();
    const response = NextResponse.json(stats, {
      headers: {
        // Extra safety: route handler cache headers override middleware
        "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
        "Surrogate-Control": "max-age=30, stale-if-error=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
    return addRateLimitHeaders(response, rateResult);
  } catch (error) {
    console.error("Error in stats API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
