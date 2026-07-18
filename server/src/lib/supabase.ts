/**
 * Supabase client initialization.
 * Uses the service role key for server-side operations (bypasses RLS).
 * Returns a no-op client if Supabase is not configured.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvConfig } from '../config/env.js';

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client configured with the service role key.
 * The service role key bypasses Row Level Security — use only server-side.
 *
 * If Supabase is not configured (placeholder values), returns a stub client
 * that will log errors on DB operations but won't crash the server.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const { supabaseUrl, supabaseServiceRoleKey, supabaseAvailable } = getEnvConfig();

  if (!supabaseAvailable) {
    console.warn('[Supabase] Not configured — DB operations will be skipped');
    // Create client with placeholder values; operations will fail gracefully
    // since the normalizer/streams already catch and log errors
    _client = createClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseServiceRoleKey || 'placeholder-key',
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );
    return _client;
  }

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
