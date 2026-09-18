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
 */

import readline from 'node:readline';
import pg from 'pg';
import argon2 from 'argon2';

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
    // Check if admin already exists
    const existing = await client.query(
      "SELECT id, email FROM users WHERE lower(email) = lower($1)",
      [email]
    );

    if (existing.rows.length > 0) {
      console.error(`✗ Пользователь с email ${email} уже существует (id: ${existing.rows[0].id})`);
      process.exit(1);
    }

    // Hash password
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });

    // Insert admin
    const result = await client.query(
      `INSERT INTO users (email, display_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'admin', true)
       RETURNING id, email, display_name, role, created_at`,
      [email, displayName, passwordHash]
    );

    const admin = result.rows[0];

    console.log('═══════════════════════════════════════════');
    console.log('  ✓ Администратор создан успешно');
    console.log('═══════════════════════════════════════════');
    console.log(`  ID:    ${admin.id}`);
    console.log(`  Email: ${admin.email}`);
    console.log(`  Name:  ${admin.display_name}`);
    console.log(`  Role:  ${admin.role}`);
    console.log('═══════════════════════════════════════════\n');
  } catch (err) {
    console.error('✗ Ошибка:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();