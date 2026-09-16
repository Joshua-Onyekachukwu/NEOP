import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const MAX_OBSERVERS_PER_PU = 2;

interface BulkRow {
  email?: string;
  name?: string;
  phone?: string;
  state_id?: string;
  lga_id?: string;
  ward?: string;
  polling_unit_code?: string;
  volunteer_id?: string;
}

interface RowError {
  row: number;
  email?: string;
  error: string;
}

interface BulkResponse {
  dry_run: boolean;
  created_volunteers: number;
  skipped_volunteers: number;
  created_assignments: number;
  errors: RowError[];
}

const REQUIRED_FIELDS: (keyof BulkRow)[] = [
  "email",
  "name",
  "phone",
  "state_id",
  "lga_id",
  "ward",
  "polling_unit_code",
];

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("234")) return "+" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "+234" + digits.slice(1);
  if (digits.length === 10) return "+234" + digits;
  return "+" + digits;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, admin_user } = auth;
    const adminUser = admin_user;

    const body = (await request.json()) as {
      rows: BulkRow[];
      dry_run?: boolean;
      election_id?: string;
    };

    const dryRun = !!body.dry_run;
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "rows array is empty" },
        { status: 400 }
      );
    }

    const [{ data: pus }, { data: electionsList }, { data: existingActive }] =
      await Promise.all([
        supabase
          .from("polling_units")
          .select("id, state_id, lga_id, ward_id, official_code"),
        supabase.from("elections").select("id, name, is_active, status"),
        body.election_id
          ? { data: null }
          : supabase
              .from("elections")
              .select("id")
              .or("is_active.eq.true,status.eq.ACTIVE")
              .limit(1)
              .maybeSingle(),
      ]);

    let electionId: string | undefined = body.election_id;
    if (!electionId && existingActive?.id) electionId = existingActive.id;
    if (!electionId && electionsList && electionsList.length > 0) {
      const firstActive = electionsList.find(
        (e: any) => e.is_active === true || e.status === "ACTIVE"
      );
      electionId = firstActive ? firstActive.id : (electionsList[0] as any).id;
    }

    const puByCode = new Map<string, string>();
    (pus || []).forEach((p: any) => {
      if (p.official_code) puByCode.set(p.official_code.toLowerCase(), p.id);
    });

    const response: BulkResponse = {
      dry_run: dryRun,
      created_volunteers: 0,
      skipped_volunteers: 0,
      created_assignments: 0,
      errors: [],
    };

    const puObserverCounts = new Map<string, number>();
    const assignedInBatch = new Set<string>();

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const rowNum = idx + 1;

      for (const f of REQUIRED_FIELDS) {
        if (!r[f] || String(r[f]).trim().length === 0) {
          response.errors.push({
            row: rowNum,
            email: r.email,
            error: `missing required field: ${f}`,
          });
          continue;
        }
      }
      if (response.errors.some((e) => e.row === rowNum)) continue;

      const email = String(r.email!).trim().toLowerCase();
      const name = String(r.name!).trim();
      const phone = normalizePhone(String(r.phone!).trim());
      const stateId = String(r.state_id!).trim();
      const lgaId = String(r.lga_id!).trim();
      const wardRaw = String(r.ward!).trim();
      const puCode = String(r.polling_unit_code!).trim().toLowerCase();

      if (phone.length < 10) {
        response.errors.push({
          row: rowNum,
          email,
          error: `phone invalid after normalization (got '${phone}')`,
        });
        continue;
      }

      const puId = puByCode.get(puCode);
      if (!puId) {
        response.errors.push({
          row: rowNum,
          email,
          error: `polling_unit_code '${puCode}' not found`,
        });
        continue;
      }

      let volunteerId: string | undefined = r.volunteer_id?.trim();
      let createdNow = false;

      if (volunteerId) {
        const { data: v } = await supabase
          .from("volunteers")
          .select("id")
          .eq("id", volunteerId)
          .limit(1)
          .maybeSingle();
        if (!v) {
          response.errors.push({
            row: rowNum,
            email,
            error: `volunteer_id '${volunteerId}' not found`,
          });
          continue;
        }
        response.skipped_volunteers++;
      } else {
        const { data: existingUser } = await supabase
          .from("user_accounts")
          .select("id")
          .eq("email", email)
          .limit(1)
          .maybeSingle();

        if (existingUser) {
          const { data: existingVol } = await supabase
            .from("volunteers")
            .select("id")
            .eq("user_id", existingUser.id)
            .limit(1)
            .maybeSingle();
          if (existingVol) {
            volunteerId = existingVol.id;
            response.skipped_volunteers++;
          } else {
            if (!dryRun) {
              const { data: newVol, error: volErr } = await supabase
                .from("volunteers")
                .insert({
                  user_id: existingUser.id,
                  phone,
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
                response.errors.push({
                  row: rowNum,
                  email,
                  error: `volunteer insert failed: ${volErr?.message || "unknown"}`,
                });
                continue;
              }
              volunteerId = newVol.id;
              response.created_volunteers++;
              createdNow = true;
            } else {
              volunteerId = `dry-run-${idx}`;
              response.created_volunteers++;
              createdNow = true;
            }
          }
        } else {
          if (!dryRun) {
            const newUserId = crypto.randomUUID();
            await supabase.from("user_accounts").insert({
              id: newUserId,
              email,
              full_name: name,
              avatar_url: null,
              auth_provider: "bulk_import",
            });
            const { data: newVol, error: volErr } = await supabase
              .from("volunteers")
              .insert({
                user_id: newUserId,
                phone,
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
              response.errors.push({
                row: rowNum,
                email,
                error: `volunteer insert failed: ${volErr?.message || "unknown"}`,
              });
              continue;
            }
            volunteerId = newVol.id;
            response.created_volunteers++;
            createdNow = true;
          } else {
            volunteerId = `dry-run-${idx}`;
            response.created_volunteers++;
            createdNow = true;
          }
        }
      }

      if (!electionId) {
        response.errors.push({
          row: rowNum,
          email,
          error: "no active election found",
        });
        continue;
      }

      const batchKey = `${volunteerId}|${electionId}`;
      if (assignedInBatch.has(batchKey)) {
        continue;
      }

      if (!volunteerId || !volunteerId.startsWith("dry-run-")) {
        if (!volunteerId) {
          response.errors.push({ row: rowNum, email, error: "volunteer could not be resolved" });
          continue;
        }
        const { data: existingAssign } = await supabase
          .from("agent_assignments")
          .select("id")
          .eq("volunteer_id", volunteerId)
          .eq("election_id", electionId)
          .maybeSingle();
        if (existingAssign) {
          assignedInBatch.add(batchKey);
          continue;
        }
      }

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
            .in("status", [
              "ASSIGNED",
              "ACTIVATED",
              "CHECKED_IN",
              "CHECKED_OUT",
            ]);
          puObserverCounts.set(puKey, count || 0);
        }
      }
      const curCount = puObserverCounts.get(puKey)!;
      if (curCount >= MAX_OBSERVERS_PER_PU) {
        response.errors.push({
          row: rowNum,
          email,
          error: `PU already has ${MAX_OBSERVERS_PER_PU} observers for this election (max)`,
        });
        continue;
      }

      const observerNumber = curCount + 1;

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
          response.errors.push({
            row: rowNum,
            email,
            error: `assignment insert failed: ${assignErr.message}`,
          });
          continue;
        }
        if (!createdNow) {
          await supabase
            .from("volunteers")
            .update({ status: "ACTIVE" })
            .eq("id", volunteerId);
        }
      }

      puObserverCounts.set(puKey, observerNumber);
      assignedInBatch.add(batchKey);
      response.created_assignments++;
    }

    if (!dryRun) {
      try {
        await supabase.from("audit_log").insert({
          actor_id: adminUser.id,
          actor_type: "ADMIN",
          action: "VOLUNTEER_BULK_IMPORT_BULK",
          resource_type: "volunteers",
          resource_id: null,
          metadata: JSON.stringify({
            created_volunteers: response.created_volunteers,
            skipped_volunteers: response.skipped_volunteers,
            created_assignments: response.created_assignments,
            error_count: response.errors.length,
            rows_received: rows.length,
            admin_role: adminUser.role,
          }),
        });
      } catch (_auditErr) {}
    }

    return NextResponse.json(response);
  } catch (e: any) {
    console.error("[admin/import-agents/bulk] top-level error:", e);
    return NextResponse.json(
      { error: `Bulk import failed: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }
}
