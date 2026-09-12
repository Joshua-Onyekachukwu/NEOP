/**
 * POST /api/admin/import-agents
 * Admin-only bulk CSV import of volunteers + their polling-unit assignments.
 *
 * Accepts EITHER:
 *   (a) JSON body       { csv_text: string, election_id?, dry_run?, default_state_id? }
 *   (b) Multipart form   field "csv" = file upload
 *
 * CSV header row is flexible — any of these column aliases (case-insensitive,
 * whitespace trimmed) map to the same logical field:
 *
 *   full_name    : name, fullname, full_name, volunteer, agent, observer
 *   email        : email, e-mail, email_address
 *   phone        : phone, mobile, telephone, whatsapp, contact  (DEDUP KEY — normalize NG +234)
 *   state        : state, state_name, state_code, state_id
 *   lga          : lga, lga_name, lga_code, lga_id, local_government
 *   ward         : ward, ward_name, ward_code, ward_id
 *   polling_unit : pu, polling_unit, pollingunit, pu_code, pu_name,
 *                  polling_unit_code, polling_unit_id, official_code
 *   election     : election, election_id, election_name
 *
 * Behaviour per row:
 *   1. Validate required column (phone).
 *   2. Normalize phone (strip non-digit, prefix +234 if NG 10-digit).
 *   3. Lookup volunteer by phone.  If FOUND → skip insert, mark
 *      volunteer_skipped, still try assignment (one per election).
 *   4. If volunteer NOT FOUND →
 *        a. Resolve state_id/lga_id by name OR code OR UUID.
 *        b. Resolve polling_unit_id via official_code OR (ward + pu name).
 *        c. INSERT user_account { id: uuid, email, full_name, auth_provider: 'csv_import' }
 *        d. INSERT volunteer { user_id, phone, state_id, lga_id,
 *                              selected_polling_unit_id, status: 'REGISTERED',
 *                              verification_status: 'NOT_REQUESTED',
 *                              training_status: 'NOT_STARTED' }
 *        e. volunteer_inserted++
 *   5. If (election_id resolved AND polling_unit_id resolved AND volunteer found/inserted):
 *        a. Check existing agent_assignments WHERE volunteer_id + election_id
 *           → FOUND → assignment_skipped++
 *        b. Else count current observers (non-released/suspended) for
 *           (pu, election).  If >= 2 → assignment_skipped++ ("PU full").
 *        c. Else INSERT agent_assignments { volunteer_id, pu_id, election_id,
 *                                           status: 'ASSIGNED',
 *                                           observer_number: count+1 }
 *           → assignment_inserted++
 *        d. Also bump volunteer.status → 'ACTIVE' (mirrors /api/admin/assign).
 *   6. Any row-level error is collected in errors[] (row, error, phone) —
 *      processing never aborts mid-file.
 *   7. At end write 1 audit_log row:
 *        actor_id = adminUser.id, action = VOLUNTEER_BULK_IMPORT,
 *        metadata = JSON summary { totals, dry_run, filename? }
 *
 * Constraints honoured (belt + suspenders with DB):
 *   - volunteers.user_id UNIQUE          → user_account created first.
 *   - agent_assignments UNIQUE(volunteer, election) → explicit pre-check.
 *   - agent_assignments UNIQUE(pu, election, observer_number) + MAX 2 → pre-count.
 *
 * dry_run=true performs all lookups + reports what WOULD happen but writes
 * zero rows (no audit log either).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// ── Constants ───────────────────────────────────────────────────────────────
const MAX_OBSERVERS_PER_PU = 2;

// Column alias map → normalized logical key.
const COLUMN_ALIASES: Record<string, string> = {
  name: "full_name",
  fullname: "full_name",
  full_name: "full_name",
  volunteer: "full_name",
  agent: "full_name",
  observer: "full_name",
  "full name": "full_name",

  email: "email",
  "e-mail": "email",
  email_address: "email",
  emailaddress: "email",

  phone: "phone",
  mobile: "phone",
  telephone: "phone",
  whatsapp: "phone",
  contact: "phone",
  phone_number: "phone",
  phonenumber: "phone",

  state: "state",
  state_name: "state",
  statename: "state",
  state_code: "state_code",
  statecode: "state_code",
  state_id: "state_id",

  lga: "lga",
  lga_name: "lga",
  lganame: "lga",
  lga_code: "lga_code",
  lgacode: "lga_code",
  lga_id: "lga_id",
  local_government: "lga",
  localgovernment: "lga",
  local_govt: "lga",

  ward: "ward",
  ward_name: "ward",
  wardname: "ward",
  ward_code: "ward_code",
  wardcode: "ward_code",
  ward_id: "ward_id",

  pu: "polling_unit",
  polling_unit: "polling_unit",
  pollingunit: "polling_unit",
  pu_code: "pu_code",
  pucode: "pu_code",
  pu_name: "polling_unit",
  puname: "polling_unit",
  polling_unit_code: "pu_code",
  polling_unit_id: "polling_unit_id",
  pollingunitid: "polling_unit_id",
  official_code: "pu_code",

  election: "election",
  election_id: "election_id",
  election_name: "election",
  electionname: "election",
};

// ── Types ───────────────────────────────────────────────────────────────────
interface ParsedRow {
  full_name?: string;
  email?: string;
  phone?: string;
  state?: string;
  state_code?: string;
  state_id?: string;
  lga?: string;
  lga_code?: string;
  lga_id?: string;
  ward?: string;
  ward_code?: string;
  ward_id?: string;
  polling_unit?: string;
  pu_code?: string;
  polling_unit_id?: string;
  election?: string;
  election_id?: string;
}

interface RowError {
  row: number;
  phone?: string;
  error: string;
}

interface ImportSummary {
  dry_run: boolean;
  rows_parsed: number;
  volunteer_inserted: number;
  volunteer_skipped: number;
  volunteer_errors: number;
  assignment_inserted: number;
  assignment_skipped: number;
  assignment_skipped_pu_full: number;
  assignment_errors: number;
  errors: RowError[];
}

// ── Minimal RFC4180 CSV parser ─────────────────────────────────────────────
// Handles double-quoted fields, escaped quotes (""), commas inside quotes,
// and Windows/Unix line endings.  Not a full library — sufficient for admin
// CSV exports produced by Excel / Google Sheets.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let curRow: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text.charCodeAt(i);

    if (inQuotes) {
      if (ch === 34 /* " */) {
        if (text.charCodeAt(i + 1) === 34) {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += text[i];
      i++;
      continue;
    }

    // not in quotes
    if (ch === 34 /* " */) {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === 44 /* , */) {
      curRow.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) i++; // CRLF
      curRow.push(cur);
      cur = "";
      rows.push(curRow);
      curRow = [];
      i++;
      continue;
    }
    if (ch === 10 /* \n */) {
      curRow.push(cur);
      cur = "";
      rows.push(curRow);
      curRow = [];
      i++;
      continue;
    }
    cur += text[i];
    i++;
  }

  // Flush trailing field / final row if any
  if (cur.length > 0 || curRow.length > 0) {
    curRow.push(cur);
    rows.push(curRow);
  }

  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0].trim() === ""));
}

function normalizeHeader(h: string): string {
  const clean = h.trim().toLowerCase().replace(/\s+/g, "_");
  return COLUMN_ALIASES[clean] ?? clean;
}

function rowsToObjects(rows: string[][]): { headers: string[]; records: ParsedRow[] } {
  if (rows.length === 0) return { headers: [], records: [] };
  const rawHeaders = rows[0];
  const normalized = rawHeaders.map(normalizeHeader);

  const records: ParsedRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const obj: Record<string, string> = {};
    for (let c = 0; c < normalized.length; c++) {
      const v = (row[c] ?? "").trim();
      if (v.length === 0) continue;
      // If multiple aliases map to same field, first non-empty wins.
      if (!(normalized[c] in obj)) obj[normalized[c]] = v;
    }
    records.push(obj as ParsedRow);
  }
  return { headers: normalized, records };
}

// ── Phone normalizer (Nigeria-focused) ─────────────────────────────────────
// 08030001234   → +2348030001234
// 2348030001234 → +2348030001234
// +2348030001234→ +2348030001234
// 8030001234    → +2348030001234  (assumed NG)
// Anything else non-digit-10+ left as-is with + prefix if digits-only.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("234")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "+234" + digits.slice(1);
  if (digits.length === 10) return "+234" + digits;
  return "+" + digits;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, adminUser } = auth;

    // ── 1. Extract CSV text from request ─────────────────────────────────
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    let csvText = "";
    let dryRun = false;
    let explicitElectionId: string | undefined;
    let filename: string | undefined;

    if (ct.includes("multipart/form-data")) {
      const fd = await request.formData();
      const file = fd.get("csv");
      dryRun = (fd.get("dry_run")?.toString() || "false").toLowerCase() === "true";
      explicitElectionId = fd.get("election_id")?.toString() || undefined;
      if (!file || !(file as File).text) {
        return NextResponse.json({ error: 'Multipart request missing "csv" file field' }, { status: 400 });
      }
      const f = file as File;
      filename = f.name;
      csvText = await f.text();
    } else {
      const body = (await request.json()) as {
        csv_text: string;
        dry_run?: boolean;
        election_id?: string;
      };
      csvText = body.csv_text || "";
      dryRun = !!body.dry_run;
      explicitElectionId = body.election_id;
    }

    if (!csvText || csvText.trim().length < 10) {
      return NextResponse.json({ error: "CSV body is empty" }, { status: 400 });
    }

    // ── 2. Parse CSV ─────────────────────────────────────────────────────
    const rows = parseCSV(csvText);
    if (rows.length < 2) {
      return NextResponse.json(
        { error: "CSV must contain a header row and at least one data row" },
        { status: 400 }
      );
    }
    const { records } = rowsToObjects(rows);

    // ── 3. Warm caches for fast lookups (bulk, single query each) ────────
    const [
      { data: states },
      { data: lgas },
      { data: wards },
      { data: pus },
      { data: electionsList },
    ] = await Promise.all([
      supabase.from("states").select("id, name, code"),
      supabase.from("lgas").select("id, state_id, name, code"),
      supabase.from("wards").select("id, lga_id, name, code"),
      supabase.from("polling_units").select("id, state_id, lga_id, ward_id, name, official_code"),
      supabase.from("elections").select("id, name, status, is_active"),
    ]);

    const lookupState = (r: ParsedRow): string | undefined => {
      if (r.state_id && isUUID(r.state_id) && states?.find((s: any) => s.id === r.state_id))
        return r.state_id;
      if (r.state_code && states) {
        const s = states.find(
          (x: any) => (x.code || "").toLowerCase() === r.state_code!.toLowerCase()
        );
        if (s) return (s as any).id;
      }
      if (r.state && states) {
        const exact = states.find(
          (x: any) => (x.name || "").toLowerCase() === r.state!.toLowerCase()
        );
        if (exact) return (exact as any).id;
        const loose = states.find((x: any) =>
          (x.name || "").toLowerCase().startsWith(r.state!.toLowerCase())
        );
        if (loose) return (loose as any).id;
      }
      return undefined;
    };

    const lookupLga = (r: ParsedRow, stateId: string | undefined): string | undefined => {
      if (r.lga_id && isUUID(r.lga_id)) {
        const ok = lgas?.find((l: any) => l.id === r.lga_id);
        if (ok) return r.lga_id;
      }
      const pool = (lgas || []) as any[];
      const filtered = stateId ? pool.filter((l) => l.state_id === stateId) : pool;
      if (r.lga_code) {
        const match = filtered.find(
          (l) => (l.code || "").toLowerCase() === r.lga_code!.toLowerCase()
        );
        if (match) return match.id;
      }
      if (r.lga) {
        const nameLower = r.lga.toLowerCase();
        const exact = filtered.find((l) => (l.name || "").toLowerCase() === nameLower);
        if (exact) return exact.id;
        const loose = filtered.find((l) =>
          (l.name || "").toLowerCase().startsWith(nameLower)
        );
        if (loose) return loose.id;
      }
      return undefined;
    };

    const lookupWard = (
      r: ParsedRow,
      _stateId: string | undefined,
      lgaId: string | undefined
    ): string | undefined => {
      if (r.ward_id && isUUID(r.ward_id)) {
        if (wards?.find((w: any) => w.id === r.ward_id)) return r.ward_id;
      }
      const pool = (wards || []) as any[];
      const filtered = lgaId ? pool.filter((w) => w.lga_id === lgaId) : pool;
      if (r.ward_code) {
        const match = filtered.find(
          (w) => (w.code || "").toLowerCase() === r.ward_code!.toLowerCase()
        );
        if (match) return match.id;
      }
      if (r.ward) {
        const nameLower = r.ward.toLowerCase();
        const exact = filtered.find((w) => (w.name || "").toLowerCase() === nameLower);
        if (exact) return exact.id;
      }
      return undefined;
    };

    const lookupPollingUnit = (
      r: ParsedRow,
      stateId: string | undefined,
      lgaId: string | undefined,
      wardId: string | undefined
    ): string | undefined => {
      if (r.polling_unit_id && isUUID(r.polling_unit_id)) {
        if (pus?.find((p: any) => p.id === r.polling_unit_id)) return r.polling_unit_id;
      }
      const pool = (pus || []) as any[];
      let filtered = pool;
      if (stateId) filtered = filtered.filter((p) => p.state_id === stateId);
      if (lgaId) filtered = filtered.filter((p) => p.lga_id === lgaId);
      if (wardId) filtered = filtered.filter((p) => p.ward_id === wardId);

      if (r.pu_code) {
        // official_code is globally unique (INEC dataset) — scope to full list.
        const match = (pool as any[]).find(
          (p) => (p.official_code || "").toLowerCase() === r.pu_code!.toLowerCase()
        );
        if (match) return match.id;
      }
      if (r.polling_unit) {
        const nameLower = r.polling_unit.toLowerCase();
        const exact = filtered.find(
          (p) => (p.name || "").toLowerCase() === nameLower
        );
        if (exact) return exact.id;
        const loose = filtered.find((p) =>
          (p.name || "").toLowerCase().startsWith(nameLower)
        );
        if (loose) return loose.id;
      }
      return undefined;
    };

    const resolveElection = (r: ParsedRow): string | undefined => {
      if (explicitElectionId && isUUID(explicitElectionId)) return explicitElectionId;
      if (r.election_id && isUUID(r.election_id)) {
        if (electionsList?.find((e: any) => e.id === r.election_id)) return r.election_id;
      }
      if (r.election && electionsList) {
        const nameLower = r.election.toLowerCase();
        const match = (electionsList as any[]).find(
          (e) => (e.name || "").toLowerCase() === nameLower
        );
        if (match) return match.id;
      }
      // fallback: first ACTIVE election
      const active = (electionsList || []).find((e: any) => e.is_active === true || e.status === "ACTIVE");
      return active ? (active as any).id : undefined;
    };

    // ── 4. Process every record, row-by-row ──────────────────────────────
    const summary: ImportSummary = {
      dry_run: dryRun,
      rows_parsed: records.length,
      volunteer_inserted: 0,
      volunteer_skipped: 0,
      volunteer_errors: 0,
      assignment_inserted: 0,
      assignment_skipped: 0,
      assignment_skipped_pu_full: 0,
      assignment_errors: 0,
      errors: [],
    };

    // Remember per-(pu,election) observer count in-memory to avoid N queries
    // AND so that consecutive rows importing 2 observers for the same PU
    // within this same batch don't both count 0 and race on observer_number.
    const puObserverCounts = new Map<string, number>();

    // In-memory set of volunteer+election pairs we've already assigned in
    // this batch (defense against duplicate rows in same CSV file).
    const assignedInBatch = new Set<string>();
    const phonesProcessedThisBatch = new Map<string, string>(); // normalized_phone → volunteer_id

    for (let idx = 0; idx < records.length; idx++) {
      const r = records[idx];
      const rowNum = idx + 2; // +1 for header, +1 for 1-indexed display

      // ── Phone normalization ──────────────────────────────────────────
      if (!r.phone) {
        summary.errors.push({ row: rowNum, error: "phone column missing or empty" });
        summary.volunteer_errors++;
        continue;
      }
      const normPhone = normalizePhone(r.phone);
      if (normPhone.length < 10) {
        summary.errors.push({
          row: rowNum,
          phone: r.phone,
          error: `phone invalid after normalization (got '${normPhone}')`,
        });
        summary.volunteer_errors++;
        continue;
      }

      // ── Resolve geography ────────────────────────────────────────────
      const stateId = lookupState(r);
      const lgaId = lookupLga(r, stateId);
      const wardId = lookupWard(r, stateId, lgaId);
      const puId = lookupPollingUnit(r, stateId, lgaId, wardId);
      const electionId = resolveElection(r);

      // ── Volunteer resolve / create ───────────────────────────────────
      let volunteerId: string | undefined;

      // First check: already processed in THIS batch (duplicate row)
      if (phonesProcessedThisBatch.has(normPhone)) {
        volunteerId = phonesProcessedThisBatch.get(normPhone)!;
        summary.volunteer_skipped++;
      } else {
        // DB lookup by phone
        const { data: existingVol } = await supabase
          .from("volunteers")
          .select("id, user_id")
          .eq("phone", normPhone)
          .limit(1)
          .maybeSingle();

        if (existingVol) {
          volunteerId = existingVol.id;
          summary.volunteer_skipped++;
          phonesProcessedThisBatch.set(normPhone, volunteerId);
        } else {
          // Need geography for a clean new volunteer record, but don't fail
          // outright — just log if missing state/lga and continue anyway
          // with nulls (columns are nullable FKs).
          try {
            if (!dryRun) {
              const newUserId = crypto.randomUUID();

              await supabase.from("user_accounts").insert({
                id: newUserId,
                email: r.email ? r.email.toLowerCase() : null,
                full_name: r.full_name || null,
                avatar_url: null,
                auth_provider: "csv_import",
              });

              const { data: newVol, error: volErr } = await supabase
                .from("volunteers")
                .insert({
                  user_id: newUserId,
                  phone: normPhone,
                  state_id: stateId || null,
                  lga_id: lgaId || null,
                  selected_polling_unit_id: puId || null,
                  status: "REGISTERED",
                  verification_status: "NOT_REQUESTED",
                  training_status: "NOT_STARTED",
                })
                .select("id")
                .single();

              if (volErr || !newVol) {
                summary.errors.push({
                  row: rowNum,
                  phone: normPhone,
                  error: `volunteer insert failed: ${volErr?.message || "unknown"}`,
                });
                summary.volunteer_errors++;
                continue;
              }
              volunteerId = newVol.id;
              phonesProcessedThisBatch.set(normPhone, volunteerId);
              summary.volunteer_inserted++;
            } else {
              // dry run — simulate
              summary.volunteer_inserted++;
              volunteerId = "dry-run-" + idx;
              phonesProcessedThisBatch.set(normPhone, volunteerId);
            }
          } catch (volEx: any) {
            summary.errors.push({
              row: rowNum,
              phone: normPhone,
              error: `volunteer insert exception: ${volEx?.message || String(volEx)}`,
            });
            summary.volunteer_errors++;
            continue;
          }
        }
      }

      // ── Assignment ───────────────────────────────────────────────────
      if (!(electionId && puId && volunteerId && !volunteerId.startsWith("dry-run-nope"))) {
        // Skipping assignment if election or PU couldn't be resolved.
        // (We still count volunteer step as success.)
        if (electionId && puId && volunteerId?.startsWith("dry-run-")) {
          // fall through for dry-run path below
        } else if (!(electionId && puId)) {
          // Not an error — user may upload a volunteer-only CSV half.
          continue;
        }
      }

      const batchKey = `${volunteerId}|${electionId}`;
      if (assignedInBatch.has(batchKey)) {
        summary.assignment_skipped++;
        continue;
      }

      // Check DB: existing assignment for (volunteer, election)
      if (!volunteerId.startsWith("dry-run-")) {
        const { data: existingAssign } = await supabase
          .from("agent_assignments")
          .select("id")
          .eq("volunteer_id", volunteerId)
          .eq("election_id", electionId)
          .maybeSingle();
        if (existingAssign) {
          summary.assignment_skipped++;
          assignedInBatch.add(batchKey);
          continue;
        }
      }

      // Observer count for (pu, election):
      //  1. cache count from DB on first lookup + add in-batch increments
      const puKey = `${puId}|${electionId}`;
      if (!puObserverCounts.has(puKey)) {
        if (volunteerId.startsWith("dry-run-")) {
          puObserverCounts.set(puKey, 0);
        } else {
          const { count } = await supabase
            .from("agent_assignments")
            .select("id", { count: "exact", head: true })
            .eq("polling_unit_id", puId)
            .eq("election_id", electionId)
            .in("status", ["ASSIGNED", "ACTIVATED", "CHECKED_IN", "CHECKED_OUT"]);
          puObserverCounts.set(puKey, count || 0);
        }
      }
      const curCount = puObserverCounts.get(puKey)!;
      if (curCount >= MAX_OBSERVERS_PER_PU) {
        summary.assignment_skipped_pu_full++;
        summary.errors.push({
          row: rowNum,
          phone: normPhone,
          error: `PU already has ${MAX_OBSERVERS_PER_PU} observers for this election (max)`,
        });
        continue;
      }

      const observerNumber = curCount + 1;

      try {
        if (!dryRun) {
          const { error: assignErr } = await supabase
            .from("agent_assignments")
            .insert({
              volunteer_id: volunteerId,
              polling_unit_id: puId,
              election_id: electionId,
              status: "ASSIGNED",
              observer_number: observerNumber,
            });

          if (assignErr) {
            summary.errors.push({
              row: rowNum,
              phone: normPhone,
              error: `assignment insert failed: ${assignErr.message}`,
            });
            summary.assignment_errors++;
            // don't bump counter since insert didn't happen
            continue;
          }

          // Mirror /api/admin/assign: bump volunteer status → ACTIVE
          await supabase
            .from("volunteers")
            .update({ status: "ACTIVE" })
            .eq("id", volunteerId);
        }
        puObserverCounts.set(puKey, observerNumber);
        assignedInBatch.add(batchKey);
        summary.assignment_inserted++;
      } catch (assignEx: any) {
        summary.errors.push({
          row: rowNum,
          phone: normPhone,
          error: `assignment insert exception: ${assignEx?.message || String(assignEx)}`,
        });
        summary.assignment_errors++;
      }
    }

    // ── 5. Audit log (skip on dry_run) ──────────────────────────────────
    if (!dryRun) {
      try {
        await supabase.from("audit_log").insert({
          actor_id: adminUser.id,
          actor_type: "ADMIN",
          action: "VOLUNTEER_BULK_IMPORT",
          resource_type: "volunteers",
          resource_id: null,
          metadata: JSON.stringify({
            summary: {
              rows_parsed: summary.rows_parsed,
              volunteer_inserted: summary.volunteer_inserted,
              volunteer_skipped: summary.volunteer_skipped,
              volunteer_errors: summary.volunteer_errors,
              assignment_inserted: summary.assignment_inserted,
              assignment_skipped: summary.assignment_skipped,
              assignment_skipped_pu_full: summary.assignment_skipped_pu_full,
              assignment_errors: summary.assignment_errors,
              error_count: summary.errors.length,
            },
            filename: filename || "json_body",
            explicit_election_id: explicitElectionId || null,
            admin_role: adminUser.role,
          }),
        });
      } catch (_auditErr) {
        // Audit write failure must never fail the response (append-only audit
        // log is mission critical, but if the row can't be written we still
        // return success to admin — they already saw the rows committed).
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      summary,
      assignment_count: summary.assignment_inserted,
      sample: {
        first_10_phones_inserted: Array.from(phonesProcessedThisBatch.keys()).slice(0, 10),
      },
    });
  } catch (e: any) {
    console.error("[admin/import-agents] top-level error:", e);
    return NextResponse.json(
      { error: `Import failed: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}
