/**
 * POST/GET /api/admin/simulate/tick
 *
 * Vercel-safe simulation pump. Claims the next PENDING step(s) of the
 * active run from sim_run_steps (DB checkpoint queue), executes them,
 * and marks them DONE. Called by:
 *   • Vercel Cron (every minute) with CRON_SECRET — keeps production
 *     runs progressing across serverless cold starts.
 *   • The admin dashboard / launch route pumper with an admin token.
 *
 * Every step is idempotent and durably recorded, so a run resumes from
 * the queue no matter how many times the serverless function restarts.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { executeTickSteps } from "@/lib/sim-engine";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest): Promise<boolean> {
  // 1. Vercel Cron header (set automatically when CRON_SECRET is configured)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  // 2. Admin session (dashboard pumper)
  const { requireAdminWithDetails, isAdminDetailsSuccess } = await import("@/lib/admin-auth");
  const auth = await requireAdminWithDetails(request);
  return isAdminDetailsSuccess(auth);
}

async function handle(request: NextRequest) {
  const ok = await authorize(request);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const url = new URL(request.url);
  const maxSteps = Math.max(1, Math.min(60, Number(url.searchParams.get("max")) || 12));
  const runId = url.searchParams.get("run");

  try {
    const result = await executeTickSteps(supabase, {
      runId: runId || null,
      maxSteps,
      budgetMs: 45_000,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "tick failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
