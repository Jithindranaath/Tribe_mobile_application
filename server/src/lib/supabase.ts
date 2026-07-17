/**
 * Supabase client initialization.
 * Uses the service role key for server-side operations (bypasses RLS).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvConfig } from '../config/env.js';

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client configured with the service role key.
 * The service role key bypasses Row Level Security — use only server-side.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const { supabaseUrl, supabaseServiceRoleKey } = getEnvConfig();

  _client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _client;
}

/**
 * Resets the Supabase client singleton. Useful for testing.
 */
export function resetSupabaseClient(): void {
  _client = null;
}
