import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";
import crypto from "crypto";
const { randomUUID } = crypto;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type AIPolicy = "FAST_ONLY" | "ALWAYS_REVIEW" | "AI_ONLY";

const NVIDIA_KEYS = [
  process.env.NVIDIA_API_KEY_1,
  process.env.NVIDIA_API_KEY_2,
  process.env.NVIDIA_API_KEY_3,
  process.env.NVIDIA_API_KEY_4,
  process.env.NVIDIA_API_KEY_5,
].filter(Boolean) as string[];

function pickNvidiaKey(retry: number): string {
  const idx = (retry * 7 + Math.floor(Math.random() * NVIDIA_KEYS.length)) % Math.max(1, NVIDIA_KEYS.length);
  return NVIDIA_KEYS[idx] || process.env.NVIDIA_API_KEY || "";
}

async function retryWithBackoff<T>(
  fn: (key: string, signal: AbortSignal) => Promise<T>,
  retries = 3
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    const signal = AbortSignal.timeout(25000);
    const key = pickNvidiaKey(i);
    try {
      return await fn(key, signal);
    } catch (e: any) {
      lastErr = e;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  }
  throw lastErr || new Error("ALL_RETRIES_EXHAUSTED");
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, adminUser } = auth;

    const body = await request.json();
    const submission_id: string = body.submission_id;
    const force_ai: boolean = body.force_ai || false;
    const publish: boolean = body.publish !== false;
    const ai_policy: AIPolicy = body.ai_policy || "FAST_ONLY";

    if (!submission_id) {
      return NextResponse.json({ error: "submission_id required" }, { status: 400 });
    }

    const { data: pairData, error: pairErr } = await supabase
      .rpc("get_or_create_both_submissions_pair", { p_submission_id: submission_id })
      .single();

    if (pairErr || !pairData) {
      return NextResponse.json({ error: "Pair lookup failed" }, { status: 500 });
    }

    const {
      canonical_id,
      election_id,
      polling_unit_id: pu_id,
      submission1_id,
      submission2_id,
    } = pairData as any;

    if (!submission2_id) {
      await supabase
        .from("canonical_pu_results")
        .upsert({
          id: canonical_id,
          election_id,
          pu_id,
          status: "ONE_SUBMISSION",
          submission1_id,
          updated_at: new Date().toISOString(),
        });
      return NextResponse.json({ status: "ONE_SUBMISSION", canonical_id });
    }

    const loadSub = async (sid: string) => {
      const { data: sub } = await supabase
        .from("result_submissions")
        .select("*, party_results ( votes, parties ( id, abbreviation, name, color ) )")
        .eq("id", sid)
        .single();
      return sub;
    };

    const [sub1, sub2] = await Promise.all([loadSub(submission1_id), loadSub(submission2_id)]);

    const toParties = (s: any) =>
      (s?.party_results || []).map((pr: any) => ({
        abbr: pr?.parties?.abbreviation || "?",
        votes: Number(pr?.votes || 0),
        party_id: pr?.parties?.id,
      }));

    const p1 = toParties(sub1);
    const p2 = toParties(sub2);

    const sum1 = p1.reduce((s: number, p: any) => s + p.votes, 0);
    const sum2 = p2.reduce((s: number, p: any) => s + p.votes, 0);
    const math_ok_1 = sum1 === Number(sub1?.valid_votes || 0);
    const math_ok_2 = sum2 === Number(sub2?.valid_votes || 0);

    const totals_ok =
      Number(sub1?.valid_votes) === Number(sub2?.valid_votes) &&
      Number(sub1?.rejected_votes) === Number(sub2?.rejected_votes) &&
      Number(sub1?.total_votes) === Number(sub2?.total_votes);

    const partyMap1 = new Map(p1.map((p: any) => [p.abbr, p.votes]));
    const partiesCommon = Array.from(
      new Set([...p1.map((p: any) => p.abbr), ...p2.map((p: any) => p.abbr)])
    );

    let max_diff = 0;
    let identical = totals_ok;
    const perPartyDiffs: any[] = [];
    for (const abbr of partiesCommon) {
      const v1 = partyMap1.get(abbr) || 0;
      const v2 = new Map(p2.map((p: any) => [p.abbr, p.votes])).get(abbr) || 0;
      const d = Math.abs(v1 - v2);
      if (d > 0) identical = false;
      if (d > max_diff) max_diff = d;
      perPartyDiffs.push({ abbr, v1, v2, diff: v1 - v2, abs: d });
    }
    const totals_diff =
      Math.abs(Number(sub1?.valid_votes || 0) - Number(sub2?.valid_votes || 0)) +
      Math.abs(Number(sub1?.rejected_votes || 0) - Number(sub2?.rejected_votes || 0));
    if (totals_diff > max_diff) max_diff = totals_diff;

    if (identical && p1.length !== p2.length) identical = false;

    const deterministic_checks = {
      totals_ok,
      math_ok_1,
      math_ok_2,
      per_party_diffs: perPartyDiffs,
    };

    const verification_id = randomUUID();
    await supabase.from("verifications").upsert({
      id: verification_id,
      canonical_id,
      election_id,
      pu_id,
      submission1_id,
      submission2_id,
      status: "DETERMINISTIC_RUNNING",
      max_diff,
      identical,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let final_status = "MATCH";
    let ai_present = false;
    let aiWarnings = false;
    let aiWarns = false;

    const skipAiForFastPath =
      identical && max_diff <= 2 && !force_ai && ai_policy !== "ALWAYS_REVIEW";

    if (!skipAiForFastPath && ai_policy !== "AI_ONLY" && !force_ai) {
      if (!(identical && max_diff <= 2)) {
        // proceed to AI below
      }
    }

    if (!skipAiForFastPath) {
      const callNVIDIA = async (modelType: string, model: string) => {
        try {
          const r = await retryWithBackoff(async (key, signal) => {
            const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: "system", content: `Election verification ${modelType}` },
                  {
                    role: "user",
                    content: JSON.stringify({
                      sub1: { valid: sub1?.valid_votes, rejected: sub1?.rejected_votes, parties: p1 },
                      sub2: { valid: sub2?.valid_votes, rejected: sub2?.rejected_votes, parties: p2 },
                      max_diff,
                      identical,
                    }),
                  },
                ],
                max_tokens: 500,
                temperature: 0,
              }),
              signal,
            });
            if (!res.ok) throw new Error(`NVIDIA ${res.status}`);
            const j = await res.json();
            return j;
          }, 2);
          return { ok: true, data: r };
        } catch (e: any) {
          return { ok: false, error: e?.message || "ALL_RETRIES_EXHAUSTED" };
        }
      };

      const [visionRes, evidenceRes, anomalyRes, consistencyRes] = await Promise.all([
        callNVIDIA("VISION", "meta/llama-3.1-70b-instruct"),
        callNVIDIA("EVIDENCE", "meta/llama-3.1-70b-instruct"),
        callNVIDIA("ANOMALY", "nvidia/nemotron-4-405b-instruct"),
        callNVIDIA("CONSISTENCY", "mistralai/mixtral-8x7b-instruct-v0.1"),
      ]);

      const allFailed =
        !visionRes.ok && !evidenceRes.ok && !anomalyRes.ok && !consistencyRes.ok;

      if (allFailed) {
        await supabase
          .from("verifications")
          .update({ status: "NVIDIA_FAILED", updated_at: new Date().toISOString() })
          .eq("id", verification_id);
        await supabase
          .from("canonical_pu_results")
          .update({ status: "HUMAN_REVIEW", updated_at: new Date().toISOString() })
          .eq("id", canonical_id);
        try {
          await supabase.rpc("call_enqueue_dead_letter", {
            p_queue: "nvidia_failed",
            p_payload: JSON.stringify({ verification_id, canonical_id, pu_id }),
          });
        } catch {}
        return NextResponse.json({
          success: true,
          status: "NVIDIA_FAILED",
          canonical_id,
          verification_id,
          deterministic_checks,
          identical,
          max_diff,
          ai_present: false,
        });
      }

      ai_present = visionRes.ok || evidenceRes.ok || anomalyRes.ok || consistencyRes.ok;
      const textBlob = JSON.stringify({ visionRes, evidenceRes, anomalyRes, consistencyRes });
      aiWarnings =
        textBlob.includes("WARN") ||
        textBlob.includes("DISCREPANCY") ||
        textBlob.includes("FLAG") ||
        textBlob.includes("SUSPICIOUS");
      aiWarns = aiWarnings;

      await supabase
        .from("verifications")
        .update({
          ai_vision_result: visionRes.ok ? visionRes.data : null,
          ai_evidence_result: evidenceRes.ok ? evidenceRes.data : null,
          ai_anomaly_result: anomalyRes.ok ? anomalyRes.data : null,
          ai_consistency_result: consistencyRes.ok ? consistencyRes.data : null,
          ai_warnings: aiWarnings,
          updated_at: new Date().toISOString(),
        })
        .eq("id", verification_id);
    }

    if (skipAiForFastPath) {
      final_status = "MATCH";
    } else if (identical && !aiWarns) {
      final_status = "MATCH";
    } else if (max_diff <= 2 && !aiWarnings) {
      final_status = "MATCH";
    } else {
      final_status = "DISCREPANCY";
    }

    let out_canonical_id: string | null = null;
    let out_superseded = 0;
    let out_party_count = 0;

    if (final_status === "MATCH") {
      await supabase
        .from("verifications")
        .update({ status: "MATCH", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", verification_id);

      if (publish) {
        const chosen = sub1;
        const parties_jsonb = p1.map((p: any) => ({ party_id: p.party_id, votes: p.votes }));
        const { data: pubData, error: pubErr } = await supabase.rpc("publish_canonical_result", {
          p_election_id: election_id,
          p_pu_id: pu_id,
          p_status: "PUBLISHED",
          p_valid_votes: Number(chosen?.valid_votes || 0),
          p_rejected_votes: Number(chosen?.rejected_votes || 0),
          p_total_votes: Number(chosen?.total_votes || 0),
          p_source1_id: submission1_id,
          p_source2_id: submission2_id,
          p_party_votes: parties_jsonb,
          p_admin_id: adminUser.id,
        });
        if (pubData && !pubErr) {
          const pd: any = pubData;
          out_canonical_id = pd?.out_canonical_id || pd?.canonical_id || canonical_id;
          out_superseded = Number(pd?.out_superseded || pd?.superseded_count || 0);
          out_party_count = Number(pd?.out_party_count || pd?.party_count || p1.length);
        }
      } else {
        await supabase
          .from("canonical_pu_results")
          .update({ status: "VERIFIED", updated_at: new Date().toISOString() })
          .eq("id", canonical_id);
        out_canonical_id = canonical_id;
      }

      try {
        await supabase.from("audit_log").insert({
          action: "VERIFICATION_COMPLETED_MATCH",
          actor_id: adminUser.id,
          actor_type: "admin",
          resource_type: "verifications",
          resource_id: verification_id,
          metadata: { canonical_id, pu_id, max_diff, identical, ai_present },
          created_at: new Date().toISOString(),
        });
      } catch {}
    } else {
      await supabase
        .from("verifications")
        .update({ status: "DISCREPANCY", updated_at: new Date().toISOString() })
        .eq("id", verification_id);
      await supabase
        .from("canonical_pu_results")
        .update({ status: "HUMAN_REVIEW", updated_at: new Date().toISOString() })
        .eq("id", canonical_id);
      try {
        await supabase.from("audit_log").insert({
          action: "VERIFICATION_DISCREPANCY",
          actor_id: adminUser.id,
          actor_type: "admin",
          resource_type: "verifications",
          resource_id: verification_id,
          metadata: { canonical_id, pu_id, max_diff, identical, ai_present, aiWarnings },
          created_at: new Date().toISOString(),
        });
      } catch {}
    }

    try {
      revalidateTag("stats");
      revalidateTag("party-results");
      revalidateTag("public-results");
      revalidateTag("config");
      revalidatePath("/");
      revalidatePath("/results");
      revalidatePath("/live");
    } catch {}

    return NextResponse.json({
      success: true,
      status: final_status,
      canonical_id: out_canonical_id || canonical_id,
      verification_id,
      out_superseded,
      out_party_count,
      deterministic_checks,
      identical,
      max_diff,
      ai_present,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
