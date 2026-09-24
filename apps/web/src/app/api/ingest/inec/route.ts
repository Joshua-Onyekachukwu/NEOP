/**
 * POST /api/ingest/inec — Phase 3 INEC feed connector (controlled ingestion boundary)
 *
 * Contract (INEC_FEED_REHEARSAL_PLAN.md Phase 3 + brief):
 *   • Default OFF. Requires ALL of: env INEC_INGEST_ENABLED=true,
 *     system_config.inec_ingest_enabled=true, provisioned inec_ingest_config row.
 *   • Auth: Bearer secret vs inec_ingest_config.ingest_secret (provisioned via
 *     audited SQL, server-only, RLS deny-all), optional IP allowlist.
 *   • Raw ledger first: EVERY inbound payload is ledgered before any pipeline
 *     write; payloads are trigger-immutable; deletes are blocked.
 *   • Idempotency: (election, polling_unit_code, source_sequence) — a PENDING/
 *     ACCEPTED ledger row with the same (PU, sequence) is a no-op reply;
 *     the same (PU, sequence) with a DIFFERENT identity hash is QUARANTINED
 *     (conflict, never silently applied); identical identity hash re-delivered
 *     after acceptance is DUPLICATE (idempotent no-op).
 *     The identity hash covers the RESULT (schema, election, PU, sequence,
 *     party votes, rejected ballots) and deliberately EXCLUDES `observed_at`
 *     and `transport`: a real feed re-stamps those on every retry, and they do
 *     not change the result. Including them would turn a retry storm into a
 *     quarantine storm and mask genuine conflicts in the noise.
 *   • Normalized results go through the EXISTING pipeline: one submission per
 *     unit via inec_accept_result() (transactional, party-sum verified),
 *     deterministic verification row, no canonical write here (public
 *     publication stays the canonical pipeline's job, as with agents).
 *   • Kill switch: set system_config.inec_ingest_enabled=false (or unset env)
 *     → endpoint rejects everything; accepted data and the ledger remain.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const serviceClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// ── Payload schema (INEC IReV/EVM-shaped; versioned) ─────────
const resultSchema = z.object({
  schema_version: z.literal("1.0"),
  election_code: z.string().min(1).max(64),
  polling_unit_code: z.string().min(1).max(32),
  source_sequence: z.number().int().nonnegative(),
  observed_at: z.string().datetime(),
  result: z.object({
    accredited_voters: z.number().int().nonnegative().optional(),
    rejected_ballots: z.number().int().nonnegative(),
    party_votes: z
      .array(z.object({ abbr: z.string().min(1).max(16), votes: z.number().int().nonnegative() }))
      .min(1),
  }),
  transport: z.record(z.string(), z.unknown()).optional(),
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status });

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "") || "unknown";
}

async function authorize(
  request: NextRequest,
  supabase: ReturnType<typeof serviceClient>
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length < 40) {
    return { ok: false, status: 401, error: "missing_bearer_token" };
  }
  const token = auth.slice("Bearer ".length);

  const { data: cfg, error } = await supabase
    .from("inec_ingest_config")
    .select("ingest_secret, allowed_ips")
    .eq("id", 1)
    .maybeSingle();

  if (error || !cfg) {
    // Unprovisioned = connector inert.
    return { ok: false, status: 503, error: "connector_not_provisioned" };
  }
  // Constant-time-ish comparison (no early-exit on content).
  const a = Buffer.from(token);
  const b = Buffer.from(cfg.ingest_secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "invalid_token" };
  }

  const ip = clientIp(request);
  if (cfg.allowed_ips && cfg.allowed_ips.length > 0 && !cfg.allowed_ips.includes(ip)) {
    return { ok: false, status: 403, error: "ip_not_allowed" };
  }
  return { ok: true };
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function getFlags(supabase: ReturnType<typeof serviceClient>) {
  const { data } = await supabase
    .from("system_config")
    .select("inec_ingest_enabled, inec_rehearsal_mode, active_election_id, data_mode")
    .eq("id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();
  // Two-key gate: the DB flag is the operational kill switch (defaults FALSE,
  // so a fresh deployment is OFF). The env var is a hard override:
  //   INEC_INGEST_ENABLED=false  → OFF regardless of the DB flag
  //   unset / true               → the DB flag decides
  return {
    enabled: !!data?.inec_ingest_enabled && process.env.INEC_INGEST_ENABLED !== "false",
    rehearsal: !!data?.inec_rehearsal_mode,
    activeElectionId: data?.active_election_id ?? null,
    dataMode: data?.data_mode ?? "AWAITING_DATA",
  };
}

// ── Batch payload: { batch_id, results: [...] } ──────────────
const batchSchema = z.object({
  batch_id: z.string().min(1).max(64).optional(),
  results: z.array(resultSchema).min(1).max(500),
});

export async function POST(request: NextRequest) {
  const supabase = serviceClient();

  const auth = await authorize(request, supabase);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error }, auth.status);
  }

  const flags = await getFlags(supabase);
  if (!flags.enabled) {
    // Kill switch (DB flag or env) — explicit, machine-readable.
    return json(
      {
        ok: false,
        error: "inec_ingest_disabled",
        hint: "Set system_config.inec_ingest_enabled=true (env INEC_INGEST_ENABLED=false overrides to OFF).",
      },
      503
    );
  }

  // Feed-isolation gate: real feed data may only enter during a LIVE_ELECTION,
  // or in explicitly enabled rehearsal mode (supervised drills, tagged in the
  // ledger). This is what makes it structurally impossible for a real feed to
  // write into a simulated or awaiting dataset by accident.
  if (flags.dataMode !== "LIVE_ELECTION" && !flags.rehearsal) {
    return json(
      {
        ok: false,
        error: "data_mode_gate",
        data_mode: flags.dataMode,
        hint: "Ingestion requires data_mode=LIVE_ELECTION, or inec_rehearsal_mode=true for supervised drills.",
      },
      409
    );
  }

  // Parse body ONCE (size-capped).
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return json({ ok: false, error: "unreadable_body" }, 400);
  }
  if (bodyText.length > 2_000_000) {
    return json({ ok: false, error: "payload_too_large", max_bytes: 2_000_000 }, 413);
  }

  const parsedBatch = batchSchema.safeParse(JSON.parse(bodyText || "{}"));
  if (!parsedBatch.success) {
    return json(
      {
        ok: false,
        error: "schema_validation_failed",
        issues: parsedBatch.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      422
    );
  }
  const batch = parsedBatch.data;
  const batchId = batch.batch_id ?? sha256(bodyText).slice(0, 12);

  // Election contract: the feed's election_code must name the ACTIVE election.
  // A feed pointed at any other election is rejected wholesale (never partially
  // applied), keeping real feed data structurally unable to target a simulated
  // election and vice versa.
  const electionId = flags.activeElectionId;
  if (!electionId) {
    return json({ ok: false, error: "no_active_election" }, 409);
  }
  const { data: activeElection, error: elecErr } = await supabase
    .from("elections")
    .select("id")
    .eq("id", electionId)
    .maybeSingle();
  if (elecErr || !activeElection) {
    return json({ ok: false, error: "active_election_unresolvable" }, 500);
  }
  const codeSet = new Set(batch.results.map((r) => r.election_code));
  if (codeSet.size !== 1 || !codeSet.has(electionId)) {
    return json(
      {
        ok: false,
        error: "election_code_mismatch",
        expected: electionId,
        received: [...codeSet],
      },
      422
    );
  }

  // Resolve PU codes + party abbreviations up front (batch-efficient).
  const puCodes = [...new Set(batch.results.map((r) => r.polling_unit_code))];
  const partyAbbrs = [...new Set(batch.results.flatMap((r) => r.result.party_votes.map((p) => p.abbr)))];

  const { data: puRows, error: puErr } = await supabase
    .from("polling_units")
    .select("id, official_code")
    .in("official_code", puCodes);
  const puMap = new Map((puRows ?? []).map((p) => [p.official_code, p.id]));
  if (puErr) {
    return json({ ok: false, error: "pu_lookup_failed" }, 500);
  }

  const { data: partyRows, error: partyErr } = await supabase
    .from("parties")
    .select("id, abbreviation")
    .in("abbreviation", partyAbbrs)
    .eq("status", "ACTIVE");
  const partyMap = new Map((partyRows ?? []).map((p) => [p.abbreviation, p.id]));
  if (partyErr) {
    return json({ ok: false, error: "party_lookup_failed" }, 500);
  }

  // ── Per-result processing: ledger first, then validate → accept ──
  type Outcome = {
    polling_unit_code: string;
    source_sequence: number;
    status: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "QUARANTINED";
    submission_id?: string;
    reason?: string;
  };
  const outcomes: Outcome[] = [];

  for (const r of batch.results) {
    // Identity hash — what makes two deliveries THE SAME RESULT.
    // observed_at / transport are delivery metadata (re-stamped on retry) and
    // are intentionally not part of result identity; the full payload
    // (including them) is still ledgered verbatim and immutably.
    const canonical = JSON.stringify({
      schema_version: r.schema_version,
      election_code: r.election_code,
      polling_unit_code: r.polling_unit_code,
      source_sequence: r.source_sequence,
      result: r.result,
    });
    const payloadHash = sha256(canonical);

    // Existing ledger rows for this (PU, sequence): idempotency + conflicts.
    const { data: prior, error: priorErr } = await supabase
      .from("inec_feed_raw")
      .select("id, payload_sha256, status, normalized_submission_id")
      .eq("polling_unit_code", r.polling_unit_code)
      .eq("source_sequence", r.source_sequence)
      .order("received_at", { ascending: false });
    if (priorErr) {
      outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: "REJECTED", reason: "ledger_lookup_failed" });
      continue;
    }
    const priorAccepted = (prior ?? []).find((p) => p.status === "ACCEPTED");
    const priorAcceptedSub = priorAccepted?.normalized_submission_id;
    const priorPending = (prior ?? []).find((p) => p.status === "PENDING");

    // 1) Identical payload already ACCEPTED → idempotent no-op.
    if (priorAccepted && priorAccepted.payload_sha256 === payloadHash) {
      await supabase
        .from("inec_feed_raw")
        .insert({
          batch_id: batchId,
          source_sequence: r.source_sequence,
          polling_unit_code: r.polling_unit_code,
          election_id: electionId,
          payload: r,
          payload_sha256: payloadHash,
          status: "DUPLICATE",
          transport_meta: { ip: clientIp(request), ua: request.headers.get("user-agent") ?? "", ...(r.transport ?? {}) },
        });
      outcomes.push({
        polling_unit_code: r.polling_unit_code,
        source_sequence: r.source_sequence,
        status: "DUPLICATE",
        submission_id: priorAcceptedSub ?? undefined,
        reason: "already_accepted",
      });
      continue;
    }

    // 2) Same (PU, sequence), different payload, prior ACCEPTED/PENDING → conflict.
    if ((priorAccepted || priorPending) && !(priorAccepted && priorAccepted.payload_sha256 === payloadHash)) {
      await supabase.from("inec_feed_raw").insert({
        batch_id: batchId,
        source_sequence: r.source_sequence,
        polling_unit_code: r.polling_unit_code,
        election_id: electionId,
        payload: r,
        payload_sha256: payloadHash,
        status: "QUARANTINED",
        reject_reason: "conflicting_payload_for_same_sequence",
        transport_meta: { ip: clientIp(request), ua: request.headers.get("user-agent") ?? "" },
      });
      outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: "QUARANTINED", reason: "conflicting_payload_for_same_sequence" });
      continue;
    }

    // 3) Deterministic validation against real reference data.
    const puId = puMap.get(r.polling_unit_code);
    if (!puId) {
      await supabase.from("inec_feed_raw").insert({
        batch_id: batchId, source_sequence: r.source_sequence, polling_unit_code: r.polling_unit_code,
        election_id: electionId, payload: r, payload_sha256: payloadHash,
        status: "REJECTED", reject_reason: "unknown_polling_unit",
        transport_meta: { ip: clientIp(request) },
      });
      outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: "REJECTED", reason: "unknown_polling_unit" });
      continue;
    }
    const unknownParty = r.result.party_votes.find((p) => !partyMap.has(p.abbr));
    if (unknownParty) {
      await supabase.from("inec_feed_raw").insert({
        batch_id: batchId, source_sequence: r.source_sequence, polling_unit_code: r.polling_unit_code,
        election_id: electionId, payload: r, payload_sha256: payloadHash,
        status: "REJECTED", reject_reason: `unknown_party:${unknownParty.abbr}`,
        transport_meta: { ip: clientIp(request) },
      });
      outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: "REJECTED", reason: `unknown_party:${unknownParty.abbr}` });
      continue;
    }

    const votes = r.result.party_votes.map((p) => p.votes);
    const validVotes = votes.reduce((a, b) => a + b, 0);

    // 4) Ledger PENDING, then transactional accept.
    const { data: ledgerRow, error: ledErr } = await supabase
      .from("inec_feed_raw")
      .insert({
        batch_id: batchId,
        source_sequence: r.source_sequence,
        polling_unit_code: r.polling_unit_code,
        election_id: electionId,
        payload: r,
        payload_sha256: payloadHash,
        status: "PENDING",
        transport_meta: { ip: clientIp(request), ua: request.headers.get("user-agent") ?? "", rehearsal: flags.rehearsal },
      })
      .select("id")
      .single();
    if (ledErr || !ledgerRow) {
      outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: "REJECTED", reason: "ledger_write_failed" });
      continue;
    }

    const { data: subId, error: acceptErr } = await supabase.rpc("inec_accept_result", {
      p_election_id: electionId,
      p_polling_unit_id: puId,
      p_valid_votes: validVotes,
      p_rejected_votes: r.result.rejected_ballots,
      p_party_votes: r.result.party_votes,
      p_idempotency_key: `inec:${electionId}:${r.polling_unit_code}:${r.source_sequence}`,
    });

    if (acceptErr || !subId) {
      const reason = String(acceptErr?.message ?? "accept_failed");
      const mapped = reason.includes("DUPLICATE_IDEMPOTENCY_KEY")
        ? { status: "DUPLICATE" as const, why: "idempotency_key_exists" }
        : reason.includes("PARTY_SUM_MISMATCH")
          ? { status: "REJECTED" as const, why: reason }
          : { status: "REJECTED" as const, why: reason };
      await supabase
        .from("inec_feed_raw")
        .update({
          status: mapped.status,
          reject_reason: mapped.why,
        })
        .eq("id", ledgerRow.id);
      outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: mapped.status, reason: mapped.why });
      continue;
    }

    await supabase.from("inec_feed_raw").update({ status: "ACCEPTED", normalized_submission_id: subId }).eq("id", ledgerRow.id);
    await supabase.rpc("inec_record_deterministic_verification", {
      p_election_id: electionId,
      p_polling_unit_id: puId,
      p_submission_id: subId,
      p_checks: {
        party_sum_matches_valid_votes: true,
        schema_version: r.schema_version,
        source: "INEC_FEED",
        observed_at: r.observed_at,
        payload_sha256: payloadHash,
      },
    });

    outcomes.push({ polling_unit_code: r.polling_unit_code, source_sequence: r.source_sequence, status: "ACCEPTED", submission_id: subId ?? undefined });
  }

  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  return json({ ok: true, batch_id: batchId, counts, results: outcomes }, 200);
}
