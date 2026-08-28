import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export interface AuthContext {
  userId: string;
  accessToken: string;
}

export interface AdminAuthContext extends AuthContext {
  adminId: string;
  role: string;
}

/**
 * Extract and verify the Supabase session from a request.
 * Returns null if not authenticated.
 */
export async function getSession(request: NextRequest): Promise<AuthContext | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
      },
    }
  );

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;

  return {
    userId: session.user.id,
    accessToken: session.access_token,
  };
}

/**
 * Get the volunteer record for the authenticated user.
 * Returns null if the user is not a registered volunteer.
 */
export async function getVolunteer(auth: AuthContext): Promise<{ id: string } | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
      },
      global: {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      },
    }
  );

  const { data } = await supabase
    .from("volunteers")
    .select("id")
    .eq("user_id", auth.userId)
    .single();

  return data ? { id: data.id } : null;
}

/**
 * Verify the user is an active admin. Returns admin record or null.
 */
export async function getAdmin(auth: AuthContext): Promise<AdminAuthContext | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
      },
      global: {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      },
    }
  );

  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("user_id", auth.userId)
    .eq("is_active", true)
    .single();

  if (!admin) return null;

  return {
    ...auth,
    adminId: admin.id,
    role: admin.role,
  };
}

/**
 * Create a typed response helpers for consistent API error handling.
 */
export function unauthorized(message = "Authentication required") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Insufficient permissions") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(message = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function success<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
