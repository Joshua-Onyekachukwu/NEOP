import { NextRequest, NextResponse } from "next/server";
import { requireAdminWithDetails, isAdminDetailsSuccess } from "@/lib/admin-auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminWithDetails(request);
    if (!isAdminDetailsSuccess(auth)) return auth.error;
    const { supabase } = auth;

    const { data, error } = await supabase.rpc("process_dead_letter_retry", {
      batch_size: 50,
    });

    if (error) {
      return NextResponse.json(
        { error: error?.message || "RPC failed" },
        { status: 500 }
      );
    }

    const result: any = data || {};
    const processed = Number(result?.processed ?? result ?? 0);
    const rows = Array.isArray(result?.rows) ? result.rows : [];

    return NextResponse.json({
      processed,
      rows,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
