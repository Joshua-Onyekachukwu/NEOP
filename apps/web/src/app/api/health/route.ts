/**
 * GET /api/health
 *
 * Lightweight health check for load balancers, Vercel Healthchecks, and uptime monitors.
 * Returns 200 always — does NOT check database (to avoid cold-start overhead).
 * Database health is checked separately via /api/public/stats.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Track server start time
const startedAt = Date.now();

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    region: process.env.VERCEL_REGION || "local",
  }, {
    headers: {
      "Cache-Control": "no-store",
      "Surrogate-Control": "no-store",
    },
  });
}
