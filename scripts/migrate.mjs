#!/usr/bin/env node
/**
 * CRYPTORA — Database Migration Runner
 *
 * Usage:
 *   npm run migrate          # Run all pending migrations
 *   npm run migrate:status   # Show migration status
 *
 * Migrations are SQL files in server/db/migrations/, executed in filename order.
 * A `schema_migrations` table tracks which have been applied.
 */

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../server/db/migrations');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora';

async function migrate() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get applied migrations
    const applied = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedSet = new Set(applied.rows.map((r) => r.version));

    // Read migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (appliedSet.has(version)) {
        console.log(`  ✓ ${version} (already applied)`);
        continue;
      }

      console.log(`  → Applying ${version}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${version}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${version} FAILED:`, err.message);
        throw err;
      }
    }

    console.log(`\nDone. ${count} migration(s) applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function status() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    // Check if migrations table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
      )
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('No migrations applied yet.');
      return;
    }

    const applied = await client.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    console.log('Migration status:\n');
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const row = applied.rows.find((r) => r.version === version);
      if (row) {
        console.log(`  ✓ ${version} — applied ${row.applied_at.toISOString()}`);
      } else {
        console.log(`  ○ ${version} — pending`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const command = process.argv[2];

if (command === 'status') {
  status().catch((err) => {
    console.error('Migration status failed:', err.message);
    process.exit(1);
  });
} else {
  migrate().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}