import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function roleToPermissions(role: string): string[] {
  const r = (role || "").toUpperCase();
  const base = ["admin:read", "admin:profile:read"];
  if (r === "SUPER_ADMIN") {
    return [
      ...base,
      "admin:write",
      "admin:users:manage",
      "admin:config:write",
      "admin:simulation:run",
      "admin:verification:resolve",
      "admin:incidents:review",
      "admin:import",
      "admin:observability:view",
      "admin:assign:manage",
      "admin:global",
    ];
  }
  if (r === "STATE_ADMIN") {
    return [
      ...base,
      "admin:write",
      "admin:config:write",
      "admin:simulation:run",
      "admin:verification:resolve",
      "admin:incidents:review",
      "admin:observability:view",
      "admin:assign:manage",
      "admin:state",
    ];
  }
  if (r === "VIEWER" || r === "OBSERVER") {
    return base;
  }
  return base;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase, admin_user, state_id, global } = auth;

    const { data: fullRow } = await supabase
      .from("admin_users")
      .select("id, role, state_id, created_at, updated_at, last_login_at")
      .eq("id", admin_user.id)
      .single();

    const row: any = fullRow || {};

    return NextResponse.json(
      {
        admin_user,
        state_id,
        global,
        created_at: row.created_at ?? null,
        last_login_at: row.last_login_at ?? row.updated_at ?? null,
        permissions: roleToPermissions(admin_user.role),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
