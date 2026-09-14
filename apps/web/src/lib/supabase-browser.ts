import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Build the client eagerly when env vars are present (normal runtime).
// When they are missing (e.g. a prerender/build context without env vars),
// export a proxy that throws only if code actually touches the client —
// importing this module can never crash a build, only real usage can.
const client =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export const supabase: SupabaseClient = new Proxy(
  (client ?? {}) as SupabaseClient,
  {
    get(_target, prop) {
      if (!client) throw new Error('Missing Supabase environment variables');
      return (client as any)[prop];
    },
  }
);