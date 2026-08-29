/**
 * Shared auth helper for client-side pages.
 * Handles session persistence with retries for localStorage hydration delays.
 */

import { supabase } from "@/lib/supabase-browser";
import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Wait for a valid session with retries for localStorage hydration.
 * Returns the session or null after all retries exhausted.
 */
export async function waitForSession(maxRetries = 5, delayMs = 600): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

/**
 * Check auth and redirect if no session found.
 * Uses retries to handle localStorage hydration delays.
 */
export async function requireAuth(
  router: AppRouterInstance,
  redirectPath: string
): Promise<false | { user: any }> {
  const session = await waitForSession();
  if (!session) {
    router.push(redirectPath);
    return false;
  }
  return { user: session.user };
}

/**
 * Subscribe to auth state changes.
 * Only redirects on explicit SIGNED_OUT, not on initial null session.
 */
export function onAuthChanged(
  onSession: () => void,
  onSignedOut: () => void
) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (event === "SIGNED_OUT") {
        onSignedOut();
        return;
      }
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        onSession();
      }
    }
  );
  return subscription;
}
