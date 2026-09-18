#!/usr/bin/env node
/**
 * CRYPTORA — Create First Admin (CLI)
 *
 * Usage:
 *   npm run create-admin
 *
 * Interactive: prompts for email, display name, password.
 * Hashes password with Argon2id, inserts directly into PostgreSQL.
 *
 * NEVER exposed as an HTTP endpoint. NEVER hardcodes credentials.
 *
 * ── WHY THE BOOTSTRAP ADMIN IS CREATED ALREADY VERIFIED ────────────────────
 * Public registration (POST /api/auth/register) creates accounts with
 * email_verified = false: the mailbox must be proven via a link. This CLI is
 * not a public surface — it runs interactively on the trusted VPS by someone
 * who already holds the database credentials. Requiring that person to
 * confirm an address they demonstrably control would add no assurance, and
 * without it the only admin could never log in, because login refuses
 * unverified accounts. So the row is written with
 *     email_verified = true, email_verified_at = now()
 * and no verification token is created.
 *
 * This does not weaken the public flow: /api/auth/register is untouched and
 * still creates unverified users.
 *
 * The password is never printed and never leaves this process in plaintext.
 */

import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import argon2 from 'argon2';
import { config } from '../server/config.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    let password = '';

    const onData = (chunk) => {
      const c = chunk.toString('utf8');
      // Handle backspace
      if (c === '\u007F') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      // Handle enter
      if (c === '\r' || c === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
        return;
      }
      // Handle Ctrl+C
      if (c === '\u0003') {
        stdin.setRawMode(false);
        process.exit();
      }
      password += c;
      process.stdout.write('*');
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}

/**
 * Create the bootstrap admin row.
 *
 * Exported so the test suite exercises the REAL insert logic instead of a
 * reimplementation. `db` is anything exposing `query(text, params)` — a real
 * pg.Client in production, a query-level stub in tests.
 *
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {{ email: string, displayName: string, password: string }} input
 * @returns {Promise<{ alreadyExists: boolean, existing?: object, admin?: object }>}
 */
export async function createBootstrapAdmin(db, { email, displayName, password }) {
  // Check if the address is already taken.
  const existing = await db.query(
    'SELECT id, email FROM users WHERE lower(email) = lower($1)',
    [email]
  );

  if (existing.rows.length > 0) {
    return { alreadyExists: true, existing: existing.rows[0] };
  }

  // Hash password — same Argon2id parameters the server uses, from config,
  // so the CLI and the HTTP flow can never drift apart.
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.ARGON2_MEMORY_COST,
    timeCost: config.ARGON2_TIME_COST,
    parallelism: config.ARGON2_PARALLELISM,
  });

  // Insert admin. email_verified/email_verified_at are set explicitly: see the
  // rationale in the file header. Migration 005 defaults them to FALSE/NULL,
  // which would lock the first admin out of /api/auth/login.
  const result = await db.query(
    `INSERT INTO users
         (email, display_name, password_hash, role, is_active, email_verified, email_verified_at)
     VALUES
         ($1, $2, $3, 'admin', true, true, now())
     RETURNING id, email, display_name, role, is_active, email_verified, email_verified_at, created_at`,
    [email, displayName, passwordHash]
  );

  // Only non-secret fields leave this function; `password` is never returned.
  return { alreadyExists: false, admin: result.rows[0] };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  CRYPTORA — Create First Admin');
  console.log('═══════════════════════════════════════════\n');

  const email = (await prompt('Email: ')).trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('✗ Некорректный email');
    rl.close();
    process.exit(1);
  }

  const displayName = (await prompt('Display name: ')).trim();
  if (displayName.length < 2 || displayName.length > 50) {
    console.error('✗ Имя должно быть 2–50 символов');
    rl.close();
    process.exit(1);
  }

  const password = await promptPassword('Password (min 8 chars): ');
  if (password.length < 8) {
    console.error('✗ Пароль слишком короткий (минимум 8 символов)');
    rl.close();
    process.exit(1);
  }

  const confirmPassword = await promptPassword('Confirm password: ');
  if (password !== confirmPassword) {
    console.error('✗ Пароли не совпадают');
    rl.close();
    process.exit(1);
  }

  rl.close();

  console.log('\nСоздание администратора...\n');

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    const outcome = await createBootstrapAdmin(client, { email, displayName, password });

    if (outcome.alreadyExists) {
      console.error(
        `✗ Пользователь с email ${email} уже существует (id: ${outcome.existing.id})`
      );
      process.exit(1);
    }

    const admin = outcome.admin;

    console.log('═══════════════════════════════════════════');
    console.log('  ✓ Администратор создан успешно');
    console.log('═══════════════════════════════════════════');
    console.log(`  ID:       ${admin.id}`);
    console.log(`  Email:    ${admin.email}`);
    console.log(`  Name:     ${admin.display_name}`);
    console.log(`  Role:     ${admin.role}`);
    console.log(`  Active:   ${admin.is_active}`);
    console.log(`  Verified: ${admin.email_verified} (trusted local bootstrap)`);
    console.log('═══════════════════════════════════════════\n');
    console.log('Теперь можно войти через /api/auth/login.\n');
  } catch (err) {
    // err.message from pg never contains the password; still, never log the
    // input object itself.
    console.error('✗ Ошибка:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run the interactive flow when executed directly, so the test suite can
// import createBootstrapAdmin without triggering the readline prompt.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main();
}
