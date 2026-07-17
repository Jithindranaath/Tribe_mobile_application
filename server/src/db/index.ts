/**
 * Database module — migration runner and typed client export.
 *
 * Provides a helper to execute the migration SQL against Supabase Postgres
 * and re-exports the typed schema for use throughout the server.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSupabaseClient } from '../lib/supabase.js';

export * from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Reads and executes the initial migration SQL file against Supabase.
 * Uses the `rpc` method to run raw SQL via a Postgres function.
 *
 * NOTE: Requires a Supabase Postgres function `exec_sql(query text)` to be
 * created in the project, OR you can run this migration directly in the
 * Supabase SQL Editor / via the Supabase CLI (`supabase db push`).
 *
 * For development, you can also paste the SQL into the Supabase Dashboard
 * SQL Editor directly. This helper is provided for programmatic migration
 * execution in CI/CD or local setup scripts.
 */
export async function runMigrations(): Promise<void> {
  const migrationPath = resolve(__dirname, 'migrations', '001_initial_schema.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  const supabase = getSupabaseClient();

  // Attempt execution via Supabase rpc (requires a `exec_sql` function).
  // If the function doesn't exist yet, log instructions for manual execution.
  const { error } = await supabase.rpc('exec_sql', { query: sql });

  if (error) {
    if (error.message.includes('function') && error.message.includes('does not exist')) {
      console.warn(
        '[TRIBE] The exec_sql Postgres function is not available.\n' +
          '  To run migrations manually:\n' +
          '  1. Open the Supabase Dashboard → SQL Editor\n' +
          '  2. Paste the contents of server/src/db/migrations/001_initial_schema.sql\n' +
          '  3. Click "Run"\n' +
          '\n' +
          '  Alternatively, create the exec_sql helper:\n' +
          '    CREATE OR REPLACE FUNCTION exec_sql(query text)\n' +
          '    RETURNS void LANGUAGE plpgsql AS $$\n' +
          '    BEGIN EXECUTE query; END; $$;\n'
      );
      return;
    }

    throw new Error(`[TRIBE] Migration failed: ${error.message}`);
  }

  console.log('[TRIBE] Migration 001_initial_schema applied successfully.');
}

/**
 * Returns the raw SQL content of the initial migration.
 * Useful for manual execution or logging.
 */
export function getMigrationSQL(): string {
  const migrationPath = resolve(__dirname, 'migrations', '001_initial_schema.sql');
  return readFileSync(migrationPath, 'utf-8');
}
