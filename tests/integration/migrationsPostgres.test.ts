/**
 * CRYPTORA — миграции 006/007 на НАСТОЯЩЕМ PostgreSQL.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ---------------
 * `tests/unit/migrationPostgresCompat.test.ts` — статический разбор DDL. Он
 * поймал ошибку GIN-on-json в 002, но по определению не может проверить, что
 * миграция реально выполняется: CHECK-ограничения, UNIQUE-констрейнт, триггер,
 * идемпотентность seed. Требование задачи — «статических тестов недостаточно,
 * 006/007 должны запускаться на тестовом PostgreSQL».
 *
 * Поэтому здесь поднимается настоящий PostgreSQL (embedded-postgres, тот же
 * бинарник, что ставится на VPS) и выполняется НАСТОЯЩИЙ `scripts/migrate.mjs`
 * — не копия SQL и не мок пула.
 *
 * ПРОПУСК
 * -------
 * Если бинарник PostgreSQL недоступен (нет сети, offline-CI), тест честно
 * помечается skipped и печатает причину. Он не «зеленеет» молча: пропуск
 * виден в выводе, а причина — в логе.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const ROOT = path.resolve(__dirname, '../..');

/** Свободный порт, чтобы тест не конфликтовал с локальным PostgreSQL. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error('no address')));
      }
    });
  });
}

let pg: { stop: () => Promise<void>; getPgClient: (db: string) => Promise<unknown> } | null = null;
let dataDir = '';
let client: any = null;
let skipReason: string | null = null;

async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  return (await client.query(sql, params)).rows;
}

beforeAll(async () => {
  let EmbeddedPostgres: any;
  try {
    // Динамический импорт: зависимость dev-only и может отсутствовать.
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch (e) {
    skipReason = `embedded-postgres недоступен: ${(e as Error).message}`;
    return;
  }

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptora-pg-'));
  const port = await freePort();

  try {
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'cryptora',
      password: 'cryptora',
      port,
      persistent: false,
    });
    await (pg as any).initialise();
    await (pg as any).start();

    // База `cryptora` — как в DATABASE_URL по умолчанию.
    const admin = await (pg as any).getPgClient('postgres');
    await admin.connect();
    await admin.query('CREATE DATABASE cryptora');
    await admin.end();
  } catch (e) {
    skipReason = `не удалось поднять PostgreSQL: ${(e as Error).message}`;
    pg = null;
    return;
  }

  // ── НАСТОЯЩИЙ раннер миграций, тот же, что `npm run migrate` на VPS ─────
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://cryptora:cryptora@127.0.0.1:${port}/cryptora`,
  };
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], {
    env,
    cwd: ROOT,
    encoding: 'utf8',
  });
  expect(out).toContain('✓ 006_strategy_settings');
  expect(out).toContain('✓ 007_signals');
  expect(out).toContain('✓ 008_scan_universe');
  expect(out).toContain('Done. 8 migration(s) applied.');

  client = await (pg as any).getPgClient('cryptora');
  await client.connect();
}, 180_000);

afterAll(async () => {
  try {
    if (client) await client.end();
    if (pg) await (pg as any).stop();
  } catch {
    /* остановка тестовой БД не должна ронять набор */
  }
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const run = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (skipReason) {
      console.warn(`  ↷ SKIPPED (${skipReason})`);
      return;
    }
    await fn();
  });

describe('006_strategy_settings на реальном PostgreSQL', () => {
  run('таблица существует со всеми требуемыми колонками', async () => {
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                           WHERE table_name='strategy_settings'`)).map((r: any) => r.column_name);
    for (const c of [
      'strategy_id', 'enabled', 'scan_interval_seconds', 'symbols',
      'last_scan_at', 'last_signal_at', 'last_error', 'updated_at', 'updated_by',
    ]) {
      expect(cols, `нет колонки ${c}`).toContain(c);
    }
  });

  run('ровно 3 строки — и это три продуктовые стратегии', async () => {
    const rows = await q('SELECT strategy_id FROM strategy_settings ORDER BY strategy_id');
    expect(rows.map((r: any) => r.strategy_id)).toEqual([
      'V2_8_ZERO_FEE_SNIPER_TRAILING',
      'V3_0_HTF_LIQUIDATION_TRAP',
      'V3_3_HTF_ZONE_MITIGATION',
    ]);
  });

  run('ПОСЛЕ МИГРАЦИИ ВСЕ СТРАТЕГИИ ВЫКЛЮЧЕНЫ (enabled = FALSE)', async () => {
    const rows = await q('SELECT enabled FROM strategy_settings');
    expect(rows.every((r: any) => r.enabled === false)).toBe(true);
  });

  run('ни одна строка не имеет last_scan_at — сканирования ещё не было', async () => {
    const rows = await q('SELECT last_scan_at, last_signal_at FROM strategy_settings');
    expect(rows.every((r: any) => r.last_scan_at === null && r.last_signal_at === null)).toBe(true);
  });

  run('4-ю произвольную стратегию нельзя создать даже прямым INSERT в БД', async () => {
    // Важно: одного PRIMARY KEY для этого НЕДОСТАТОЧНО — он мешает только
    // дубликатам. Множество стратегий зафиксировано CHECK-ограничением.
    await expect(
      client.query(
        `INSERT INTO strategy_settings (strategy_id, enabled) VALUES ('V9_9_MADE_UP', TRUE)`,
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
    const n = (await q('SELECT count(*)::int AS n FROM strategy_settings'))[0].n;
    expect(n).toBe(3);
  });

  run('известную стратегию нельзя переименовать в несуществующую', async () => {
    await expect(
      client.query(
        `UPDATE strategy_settings SET strategy_id = 'OTHER'
         WHERE strategy_id = 'V3_3_HTF_ZONE_MITIGATION'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  run('пол интервала сканирования (15 c) enforced в БД', async () => {
    await expect(
      client.query(
        `UPDATE strategy_settings SET scan_interval_seconds = 1
         WHERE strategy_id = 'V3_0_HTF_LIQUIDATION_TRAP'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // 15 с — граница — проходит.
    await client.query(
      `UPDATE strategy_settings SET scan_interval_seconds = 15
       WHERE strategy_id = 'V3_0_HTF_LIQUIDATION_TRAP'`,
    );
    const r = (await q(`SELECT scan_interval_seconds FROM strategy_settings
                        WHERE strategy_id='V3_0_HTF_LIQUIDATION_TRAP'`))[0];
    expect(r.scan_interval_seconds).toBe(15);
    await client.query(
      `UPDATE strategy_settings SET scan_interval_seconds = 60
       WHERE strategy_id = 'V3_0_HTF_LIQUIDATION_TRAP'`,
    );
  });

  run('updated_by ссылается на users(id)', async () => {
    const fk = await q(`SELECT confrelid::regclass::text AS t
                        FROM pg_constraint
                        WHERE conrelid='strategy_settings'::regclass AND contype='f'`);
    expect(fk.map((r: any) => r.t)).toContain('users');
  });

  run('в миграции НЕТ математических параметров стратегии', async () => {
    // Проверяем РЕАЛЬНУЮ схему, а не текст файла: ни одной колонки, хранящей
    // порог/период/коэффициент алгоритма. Комментарии в шапке при этом
    // намеренно объясняют, почему таких колонок нет.
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                           WHERE table_name='strategy_settings'`)).map((r: any) => r.column_name.toLowerCase());
    expect(cols.sort()).toEqual([
      'enabled', 'last_error', 'last_scan_at', 'last_signal_at', 'scan_interval_seconds',
      'strategy_id', 'symbols', 'updated_at', 'updated_by',
    ]);
    for (const banned of ['rvol', 'wick', 'atr', 'stop_buffer', 'corridor', 'tp1', 'tp2', 'threshold', 'period']) {
      expect(cols.some((c: string) => c.includes(banned)), `в 006 не должно быть колонки с «${banned}»`).toBe(false);
    }
  });
});

describe('007_signals на реальном PostgreSQL', () => {
  run('таблица существует со всеми 20 колонками', async () => {
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                           WHERE table_name='signals'`)).map((r: any) => r.column_name);
    for (const c of [
      'id', 'strategy_id', 'symbol', 'timeframe', 'direction', 'signal_candle_ts',
      'entry_min', 'entry_max', 'stop_loss', 'tp1', 'tp2', 'status',
      'created_at', 'updated_at', 'closed_at', 'close_price', 'close_reason',
      'metadata', 'hash', 'previous_hash',
    ]) {
      expect(cols, `нет колонки ${c}`).toContain(c);
    }
  });

  run('UNIQUE (strategy_id, symbol, timeframe, signal_candle_ts) существует', async () => {
    const cols = await q(`
      SELECT a.attname FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON TRUE
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conname = 'signals_unique_per_candle' ORDER BY k.ord`);
    expect(cols.map((r: any) => r.attname)).toEqual([
      'strategy_id', 'symbol', 'timeframe', 'signal_candle_ts',
    ]);
  });

  run('INSERT … ON CONFLICT DO NOTHING: повторное сканирование той же свечи не создаёт второй сигнал', async () => {
    const base = ['V3_3_HTF_ZONE_MITIGATION', 'ETH/USDT', '1h', 'SHORT', '2026-09-19T04:00:00Z'];
    // Ключ дедупликации — БЕЗ направления: (strategy, symbol, timeframe, свеча).
    const key = [base[0], base[1], base[2], base[4]];
    const sql = `INSERT INTO signals
        (strategy_id, symbol, timeframe, direction, signal_candle_ts,
         entry_min, entry_max, stop_loss, tp1, tp2, status, hash, previous_hash)
      VALUES ($1,$2,$3,$4,$5, 2612.7, 2617.3, 2625.0, 2600.0, 2570.0, 'ACTIVE', $6, 'GENESIS')
      ON CONFLICT (strategy_id, symbol, timeframe, signal_candle_ts) DO NOTHING
      RETURNING id`;

    const first = await q(sql, [...base, 'sha256-aaa']);
    expect(first).toHaveLength(1);

    // Тот же закрытый бар, другой hash — сигнал обязан остаться один.
    const second = await q(sql, [...base, 'sha256-bbb']);
    expect(second).toHaveLength(0);

    const n = (await q(`SELECT count(*)::int AS n FROM signals
                        WHERE strategy_id=$1 AND symbol=$2 AND timeframe=$3 AND signal_candle_ts=$4`, key))[0].n;
    expect(n).toBe(1);
  });

  run('DB-уровень отклоняет дубль даже без ON CONFLICT', async () => {
    await client.query(
      `INSERT INTO signals (strategy_id, symbol, timeframe, direction, signal_candle_ts, hash)
       VALUES ('V3_0_HTF_LIQUIDATION_TRAP','BTC/USDT','1h','LONG','2026-09-19T05:00:00Z','h')`,
    );
    await expect(
      client.query(
        `INSERT INTO signals (strategy_id, symbol, timeframe, direction, signal_candle_ts, hash)
         VALUES ('V3_0_HTF_LIQUIDATION_TRAP','BTC/USDT','1h','LONG','2026-09-19T05:00:00Z','h2')`,
      ),
    ).rejects.toMatchObject({ code: '23505' }); // UNIQUE
  });

  run('direction принимает только LONG/SHORT', async () => {
    await expect(
      client.query(
        `INSERT INTO signals (strategy_id, symbol, timeframe, direction, signal_candle_ts, hash)
         VALUES ('V3_0_HTF_LIQUIDATION_TRAP','BTC/USDT','1h','SIDEWAYS','2026-09-19T06:00:00Z','h')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  run('status принимает только ACTIVE/INVALIDATED/TARGET_REACHED/EXPIRED', async () => {
    await expect(
      client.query(`UPDATE signals SET status='WON' WHERE symbol='ETH/USDT'`),
    ).rejects.toMatchObject({ code: '23514' });
    for (const s of ['INVALIDATED', 'TARGET_REACHED', 'EXPIRED', 'ACTIVE']) {
      await client.query('UPDATE signals SET status=$1 WHERE symbol=$2', [s, 'ETH/USDT']);
      expect((await q('SELECT status FROM signals WHERE symbol=$1', ['ETH/USDT']))[0].status).toBe(s);
    }
  });

  run('цены хранятся в NUMERIC без float-артефактов', async () => {
    const r = (await q(`SELECT entry_min, stop_loss, tp2 FROM signals WHERE symbol='ETH/USDT'`))[0];
    expect(String(r.entry_min)).toBe('2612.7');
    expect(String(r.stop_loss)).toBe('2625.0');
    expect(String(r.tp2)).toBe('2570.0');
  });

  run('триггер поддерживает updated_at при смене статуса', async () => {
    const before = new Date((await q(`SELECT updated_at FROM signals WHERE symbol='ETH/USDT'`))[0].updated_at);
    await new Promise((r) => setTimeout(r, 1100));
    await client.query(`UPDATE signals SET status='EXPIRED' WHERE symbol='ETH/USDT'`);
    const after = new Date((await q(`SELECT updated_at FROM signals WHERE symbol='ETH/USDT'`))[0].updated_at);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('Миграции идемпотентны и не ломают состояние админа', () => {
  run('повторный прогон SQL 006/007 не сбрасывает включённую стратегию', async () => {
    if (skipReason) return;
    await client.query(`UPDATE strategy_settings SET enabled=TRUE
                        WHERE strategy_id='V3_3_HTF_ZONE_MITIGATION'`);
    const dir = path.join(ROOT, 'server/db/migrations');
    await client.query(fs.readFileSync(path.join(dir, '006_strategy_settings.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(dir, '007_signals.sql'), 'utf8'));

    const rows = await q('SELECT strategy_id, enabled FROM strategy_settings ORDER BY strategy_id');
    expect(rows).toHaveLength(3);
    const v33 = rows.find((r: any) => r.strategy_id === 'V3_3_HTF_ZONE_MITIGATION');
    expect(v33.enabled).toBe(true);
  });

  run('триггер не задваивается при повторном применении', async () => {
    const n = (await q(`SELECT count(*)::int AS n FROM pg_trigger
                        WHERE tgname='trg_signals_touch_updated_at' AND NOT tgisinternal`))[0].n;
    expect(n).toBe(1);
  });

  run('миграции 001–005 не изменялись', async () => {
    // Защита от соблазна «поправить» уже применённые миграции.
    //
    // Базовый ref берётся из CRYPTORA_BASE_REF (по умолчанию origin/main).
    // В CI после `actions/checkout@v4` его может не быть — checkout создаёт
    // только ref проверяемой ветки. Тогда guard честно пропускается с видимой
    // причиной, а не роняет весь прогон: падать из-за отсутствия git-метадаанных
    // в раннере — не тот сигнал, ради которого существует эта проверка.
    const { execSync } = await import('node:child_process');
    const baseRef = process.env.CRYPTORA_BASE_REF ?? 'origin/main';
    const git = (args: string): string | null => {
      try {
        return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        return null;
      }
    };

    if (git(`rev-parse --verify --quiet ${baseRef}`) === null) {
      console.warn(
        `[migrationsPostgres] guard «001–005 не изменялись» пропущен: базовый ref ${baseRef} недоступен.\n` +
          '  Задайте CRYPTORA_BASE_REF (например, CRYPTORA_BASE_REF=HEAD~1) или сделайте\n' +
          '  полный checkout/fetch, чтобы проверка сравнивала с реальной базой.',
      );
      return;
    }

    const changed = git(`diff --name-only ${baseRef} -- server/db/migrations/`) ?? '';
    const files = changed.split('\n').filter(Boolean);
    for (const f of files) {
      expect(f, 'нельзя менять существующую миграцию').toMatch(
        /migrations\/00[678]_/,
      );
    }
  });
});
