import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Server-side Supabase client with service role for operations that bypass RLS.
 * Only use in API routes, never in client components.
 */
export function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

/**
 * Log an audit entry. Called from API routes after successful operations.
 */
export async function audit(params: {
  actor_id: string;
  actor_type: "VOLUNTEER" | "ADMIN" | "SYSTEM";
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}) {
  const supabase = getServiceClient();
  const { error } = await supabase.from("audit_log").insert({
    actor_id: params.actor_id,
    actor_type: params.actor_type,
    action: params.action,
    resource_type: params.resource_type,
    resource_id: params.resource_id,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    ip_address: params.ip_address || null,
    user_agent: params.user_agent || null,
  });

  if (error) {
    console.error("[audit] Failed to log:", error);
  }
}

/**
 * Parse idempotency key from request headers or body.
 * Prevents duplicate submissions during network retries.
 */
export function getIdempotencyKey(headers: Headers, body?: any): string | null {
  return (
    headers.get("idempotency-key") ||
    headers.get("x-idempotency-key") ||
    body?.idempotency_key ||
    null
  );
}

/**
 * Generate a content hash for evidence integrity verification.
 */
export async function sha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
