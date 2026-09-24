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
  expect(out).toContain('✓ 009_signal_levels_and_lifecycle');
  // Число миграций выводится из самого каталога: жёстко зашитая цифра роняла
  // прогон при каждом добавлении файла, ничего не проверяя по существу.
  const migrationFiles = fs
    .readdirSync(path.join(ROOT, 'server/db/migrations'))
    .filter((f) => f.endsWith('.sql'));
  expect(out).toContain(`Done. ${migrationFiles.length} migration(s) applied.`);

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

/**
 * `ctx.skip()` вместо «проглотить и вернуть»: пропущенный тест должен быть
 * ВИДЕН в отчёте как skipped. Прежняя форма печатала предупреждение в stderr,
 * но vitest засчитывал тест как passed — так выглядит ложно-зелёный набор.
 */
const run = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (skipReason) {
      ctx.skip();
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
  run('таблица существует со всеми колонками миграции 007', async () => {
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

describe('009_signal_levels_and_lifecycle на реальном PostgreSQL', () => {
  run('миграция аддитивна: все колонки 007 на месте + добавлены новые', async () => {
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                           WHERE table_name='signals'`)).map((r: any) => r.column_name);
    // 007 не переписана: уровни и цепочка прежние.
    for (const c of ['entry_min', 'entry_max', 'stop_loss', 'tp1', 'tp2', 'hash', 'previous_hash']) {
      expect(cols, `007 потеряла колонку ${c}`).toContain(c);
    }
    // 009: полная лестница целей, контекст публикации, исполнение и исход.
    for (const c of [
      'targets', 'chain_version', 'strategy_version', 'engine_setup_id', 'entry_type',
      'valid_for_bars', 'exit_rule', 'fill_price', 'filled_at', 'fill_stop', 'fill_targets',
      'result_r', 'net_result_r', 'pnl_result_pct', 'bars_held', 'outcome_hash',
    ]) {
      expect(cols, `009 не добавила колонку ${c}`).toContain(c);
    }
  });

  run('лестница целей хранится как NUMERIC[] (цена — не приближение float)', async () => {
    const types = await q(`SELECT column_name, data_type, udt_name FROM information_schema.columns
                           WHERE table_name='signals' AND column_name IN ('targets','fill_targets')`);
    expect(types).toHaveLength(2);
    for (const t of types as any[]) {
      expect(t.data_type, `${t.column_name} должен быть массивом`).toBe('ARRAY');
      expect(t.udt_name, `${t.column_name} должен хранить NUMERIC`).toBe('_numeric');
    }
  });

  run('status принимает все 8 состояний жизненного цикла ядра', async () => {
    const statuses = [
      'ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED',
    ];
    // Приёмка проверяется в транзакции с откатом: таблица не засоряется.
    await client.query('BEGIN');
    try {
      for (const [i, st] of statuses.entries()) {
        await client.query(
          `INSERT INTO signals
             (strategy_id, symbol, timeframe, direction, signal_candle_ts, status, hash, previous_hash)
           VALUES ('V3_0_HTF_LIQUIDATION_TRAP', $1, '1h', 'LONG', $2, $3, 'h', 'GENESIS')`,
          [`ZZ0${i}/USDT`, new Date(Date.UTC(2026, 8, 19, i)).toISOString(), st],
        );
      }
    } finally {
      await client.query('ROLLBACK');
    }
    const left = (await q(`SELECT count(*)::int AS n FROM signals WHERE symbol LIKE 'ZZ0%/USDT'`))[0].n;
    expect(left, 'откат транзакции не сработал').toBe(0);
  });

  run('выдуманное состояние статуса отклоняется CHECK-ограничением', async () => {
    await expect(
      client.query(
        `INSERT INTO signals
           (strategy_id, symbol, timeframe, direction, signal_candle_ts, status, hash, previous_hash)
         VALUES ('V3_0_HTF_LIQUIDATION_TRAP','ZZ9/USDT','1h','LONG','2026-09-19T09:00:00Z','WON','h','GENESIS')`,
      ),
    ).rejects.toMatchObject({ code: '23514' }); // check_violation
  });

  run('entry_type допускает только домен ядра (и NULL для строк до 009)', async () => {
    await expect(
      client.query(
        `INSERT INTO signals
           (strategy_id, symbol, timeframe, direction, signal_candle_ts, entry_type, hash, previous_hash)
         VALUES ('V3_0_HTF_LIQUIDATION_TRAP','ZZ8/USDT','1h','LONG','2026-09-19T10:00:00Z','MARKET','h','GENESIS')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await client.query('BEGIN');
    try {
      for (const [i, et] of ['LIMIT_CORRIDOR', 'MARKET_NEXT_OPEN', null].entries()) {
        await client.query(
          `INSERT INTO signals
             (strategy_id, symbol, timeframe, direction, signal_candle_ts, entry_type, hash, previous_hash)
           VALUES ('V2_8_ZERO_FEE_SNIPER_TRAILING', $1, '1h', 'LONG', $2, $3, 'h', 'GENESIS')`,
          [`ZZ7${i}/USDT`, new Date(Date.UTC(2026, 8, 19, 11, i)).toISOString(), et],
        );
      }
    } finally {
      await client.query('ROLLBACK');
    }
  });

  run('chain_version: новые строки = 2, строки формы 007 остаются валидными', async () => {
    const def = await q(`SELECT column_default FROM information_schema.columns
                         WHERE table_name='signals' AND column_name='chain_version'`);
    expect(String(def[0].column_default)).toBe('2');

    // Обратная совместимость: вставка «как до 009» (явный chain_version = 1,
    // без лестницы целей и без новых колонок) обязана проходить.
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO signals
           (strategy_id, symbol, timeframe, direction, signal_candle_ts,
            entry_min, entry_max, stop_loss, tp1, tp2, status, hash, previous_hash, chain_version)
         VALUES ('V3_3_HTF_ZONE_MITIGATION','ZZ6/USDT','1h','SHORT','2026-09-19T12:00:00Z',
                 2612.7, 2617.3, 2625.0, 2600.0, 2570.0, 'ACTIVE','sha256-legacy','GENESIS', 1)`,
      );
      const rows = await q(`SELECT chain_version, targets FROM signals WHERE symbol='ZZ6/USDT'`);
      expect(rows[0].chain_version).toBe(1);
      expect(rows[0].targets).toBeNull();
    } finally {
      await client.query('ROLLBACK');
    }
  });

  run('индекс ленты «символ + состояние + новые сверху» создан', async () => {
    const idx = await q(`SELECT indexdef FROM pg_indexes
                         WHERE tablename='signals' AND indexname='idx_signals_symbol_status_created'`);
    expect(idx).toHaveLength(1);
    expect(String(idx[0].indexdef)).toMatch(/symbol, status, created_at DESC/);
  });

  run('миграция идемпотентна: повторное применение 009 не ломает схему', async () => {
    const sql = fs.readFileSync(
      path.join(ROOT, 'server/db/migrations/009_signal_levels_and_lifecycle.sql'),
      'utf8',
    );
    await client.query(sql); // второй прогон того же файла
    const cols = (await q(`SELECT column_name FROM information_schema.columns
                           WHERE table_name='signals' AND column_name='targets'`));
    expect(cols).toHaveLength(1);
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

  run('существующие миграции не изменялись (развитие схемы — новым файлом)', async () => {
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

    /**
     * `--diff-filter=M` — только ИЗМЕНЁННЫЕ файлы. Прежняя форма проверяла
     * обратное («изменённый файл обязан быть 006/007/008»), поэтому (а) правка
     * уже применённых 006–008 проходила молча и (б) ЛЮБАЯ новая миграция
     * роняла прогон. Схема развивается добавлением файла, а не правкой того,
     * что уже применено на проде.
     */
    const modified = (git(`diff --name-only --diff-filter=M ${baseRef} -- server/db/migrations/`) ?? '')
      .split('\n')
      .filter(Boolean);
    expect(modified, 'нельзя менять уже применённые миграции').toEqual([]);

    // Новые файлы допустимы, но обязаны следовать конвенции именования
    // (NNN_snake_case.sql): раннер применяет их в лексикографическом порядке.
    const added = (git(`diff --name-only --diff-filter=A ${baseRef} -- server/db/migrations/`) ?? '')
      .split('\n')
      .filter(Boolean);
    for (const f of added) {
      expect(f, 'имя новой миграции').toMatch(/migrations\/\d{3}_[a-z0-9_]+\.sql$/);
    }
  });
});
