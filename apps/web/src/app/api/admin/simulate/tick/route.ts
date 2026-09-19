/**
 * POST/GET /api/admin/simulate/tick
 *
 * Vercel-safe simulation pump. Claims the next PENDING step(s) of the
 * active run from sim_run_steps (DB checkpoint queue), executes them,
 * and marks them DONE. Called by:
 *   • Vercel Cron with CRON_SECRET (where the plan supports frequent crons)
 *   • pg_cron's neop_sim_driver() with the DB-stored driver secret — the
 *     database itself drives the queue whenever a run is active, so runs
 *     progress even where Vercel cron is unavailable (Hobby fires once/day).
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

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function authorize(request: NextRequest, supabase: ReturnType<typeof serviceClient>): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  // 1. Vercel Cron header (set automatically when CRON_SECRET is configured)
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  // 2. DB-stored simulation driver secret — pg_cron's neop_sim_driver() posts
  //    with this credential. Lives in sim_driver_config (RLS-locked; service
  //    role only), rotates with a single UPDATE.
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    if (token.length >= 24 && token.length <= 256) {
      const { data } = await supabase
        .from("sim_driver_config")
        .select("cron_secret")
        .eq("id", 1)
        .maybeSingle();
      if (data?.cron_secret && data.cron_secret === token) {
        return true;
      }
    }
  }
  // 3. Admin session (dashboard pumper)
  const { requireAdminWithDetails, isAdminDetailsSuccess } = await import("@/lib/admin-auth");
  const auth = await requireAdminWithDetails(request);
  return isAdminDetailsSuccess(auth);
}

async function handle(request: NextRequest) {
  const supabase = serviceClient();

  const ok = await authorize(request, supabase);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
