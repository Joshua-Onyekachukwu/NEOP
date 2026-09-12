import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase.rpc("process_dead_letter_retry", {
      batch_size: 50,
    });

    if (error) {
      return NextResponse.json(
        { error: error?.message || "RPC failed", processed: 0 },
        { status: 500 }
      );
    }

    const result: any = data || {};
    const processed = Number(result?.processed ?? result ?? 0);

    return NextResponse.json({
      processed,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal error", processed: 0 },
      { status: 500 }
    );
  }
}
