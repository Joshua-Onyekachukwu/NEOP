import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_MODES = ["AWAITING_DATA", "SIMULATED", "LIVE_ELECTION"];
const ELECTION_TYPES = ["PRESIDENTIAL", "GOVERNORSHIP"];
const SYSTEM_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, state_id, global } = auth;

    const body = await request.json();
    const { election_type, data_mode, active_election_id } = body;

    const updated: string[] = [];

    if (election_type !== undefined) {
      if (!ELECTION_TYPES.includes(election_type)) {
        return NextResponse.json(
          { error: `election_type must be one of: ${ELECTION_TYPES.join(", ")}` },
          { status: 400 }
        );
      }
    }
    if (data_mode !== undefined) {
      if (!DATA_MODES.includes(data_mode)) {
        return NextResponse.json(
          { error: `data_mode must be one of: ${DATA_MODES.join(", ")}` },
          { status: 400 }
        );
      }
    }
    if (active_election_id !== undefined) {
      if (active_election_id !== null && !UUID_RE.test(String(active_election_id))) {
        return NextResponse.json(
          { error: "active_election_id must be a valid UUID v4" },
          { status: 400 }
        );
      }
    }

    if (!global && state_id != null && (data_mode !== undefined || active_election_id !== undefined)) {
      return NextResponse.json(
        { error: "Forbidden: state-scoped admin cannot modify global system_config (data_mode / active_election_id)" },
        { status: 403 }
      );
    }

    if (data_mode !== undefined || active_election_id !== undefined) {
      const { data: existing } = await supabase
        .from("system_config")
        .select("*")
        .eq("id", SYSTEM_CONFIG_ID)
        .maybeSingle();

      const patch: any = {
        last_updated_at: new Date().toISOString(),
      };

      if (data_mode !== undefined) {
        const curr = (existing as any)?.data_mode;
        if (curr !== data_mode) {
          patch.data_mode = data_mode;
          updated.push("data_mode");
        }
      }
      if (active_election_id !== undefined) {
        const curr = (existing as any)?.active_election_id;
        if (curr !== active_election_id) {
          patch.active_election_id = active_election_id;
          updated.push("active_election_id");
        }
      }

      if (Object.keys(patch).length > 1 || updated.length > 0) {
        if (existing) {
          await supabase.from("system_config").update(patch).eq("id", SYSTEM_CONFIG_ID);
        } else {
          await supabase.from("system_config").insert({
            id: SYSTEM_CONFIG_ID,
            data_mode: patch.data_mode || "AWAITING_DATA",
            active_election_id: patch.active_election_id || null,
            last_updated_at: patch.last_updated_at,
          });
          if (data_mode !== undefined) updated.push("data_mode");
          if (active_election_id !== undefined) updated.push("active_election_id");
        }
      }
    }

    if (election_type !== undefined) {
      const { data: simExisting } = await supabase
        .from("simulation_config")
        .select("id")
        .eq("id", SYSTEM_CONFIG_ID)
        .maybeSingle();

      if (simExisting) {
        await supabase
          .from("simulation_config")
          .update({ election_type, updated_at: new Date().toISOString() })
          .eq("id", SYSTEM_CONFIG_ID);
      } else {
        await supabase.from("simulation_config").insert({
          id: SYSTEM_CONFIG_ID,
          election_type,
          status: "IDLE",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      updated.push("election_type");
    }

    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
