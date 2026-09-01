/**
 * Supabase server client for Next.js App Router
 * Uses cookies for session management
 */

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Create a server-side Supabase client with cookie-based auth
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      storage: {
        getItem: (key) => {
          const cookie = cookieStore.get(key);
          return cookie?.value ?? null;
        },
        setItem: (key, value) => {
          try {
            cookieStore.set(key, value, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
              maxAge: 60 * 60 * 24 * 7, // 1 week
            });
          } catch (error) {
            // Server component, can't set cookies
          }
        },
        removeItem: (key) => {
          try {
            cookieStore.delete(key);
          } catch (error) {
            // Server component, can't delete cookies
          }
        },
      },
    },
  });
}

/**
 * Get the current session from server
 */
export async function getServerSession() {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Get the current user from server
 */
export async function getServerUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
