/**
 * CRYPTORA — Static PostgreSQL compatibility checks for all migrations.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `npm run migrate` on a real PostgreSQL 16.15 failed at 002 with:
 *
 *     ERROR: data type json has no default operator class for access method "gin"
 *
 * The sandbox has no PostgreSQL, so the bug reached the VPS undetected. These
 * tests reproduce the *class* of failure statically: they parse the migration
 * SQL, resolve every indexed column to its declared type, and reject
 * index/type combinations PostgreSQL cannot build.
 *
 * This is a STATIC check — it is not a SQL engine and cannot replace a real
 * `npm run migrate`. It is a gate that fails on the mistakes that are
 * mechanically knowable from the DDL alone.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../server/db/migrations');

const FILES = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** Strip `--` line comments so commented-out DDL is never analysed. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

interface ColumnDef {
  table: string;
  name: string;
  type: string;
}

interface IndexDef {
  file: string;
  name: string;
  table: string;
  method: string; // btree | gin | gist | ...
  expression: string; // raw text between the parentheses
}

let columns: ColumnDef[] = [];
let indexes: IndexDef[] = [];

beforeAll(() => {
  for (const file of FILES) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));

    // ── CREATE TABLE ... ( ... ); ──────────────────────────────────────
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      const table = m[1];
      for (const rawLine of m[2].split(',\n')) {
        const line = rawLine.trim();
        // Skip table-level constraints and continuation lines.
        if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(line)) continue;
        const col = line.match(/^(\w+)\s+([A-Za-z]+(?:\s*\(\s*\d+\s*\))?)/);
        if (col) {
          columns.push({ table, name: col[1].toLowerCase(), type: col[2].toLowerCase().replace(/\s+/g, '') });
        }
      }
    }

    // ── ALTER TABLE ... ADD COLUMN ... ─────────────────────────────────
    for (const m of sql.matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)([\s\S]*?);/gi)) {
      const table = m[1];
      for (const add of m[2].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)\s+([A-Za-z]+(?:\s*\(\s*\d+\s*\))?)/gi)) {
        columns.push({ table, name: add[1].toLowerCase(), type: add[2].toLowerCase().replace(/\s+/g, '') });
      }
    }

    // ── CREATE [UNIQUE] INDEX ... ──────────────────────────────────────
    for (const m of sql.matchAll(
      /CREATE(?: UNIQUE)? INDEX(?: IF NOT EXISTS)?\s+(\w+)\s+ON\s+(\w+)\s*(?:USING\s+(\w+))?\s*\(([^)]*)\)/gi
    )) {
      indexes.push({
        file,
        name: m[1],
        table: m[2],
        method: (m[3] || 'btree').toLowerCase(),
        expression: m[4].trim(),
      });
    }
  }
});

function typeOf(table: string, column: string): string | undefined {
  return columns.find((c) => c.table.toLowerCase() === table.toLowerCase() && c.name === column.toLowerCase())?.type;
}

/**
 * Bare column name referenced by an index expression, if it is a simple one.
 * Tolerates a trailing sort direction so `(created_at DESC)` is still resolved
 * to a real column instead of being skipped as an opaque expression.
 */
function bareColumn(expression: string): string | null {
  const simple = expression.match(/^\s*(\w+)\s*(?:ASC|DESC)?\s*(?:NULLS\s+(?:FIRST|LAST))?\s*$/i);
  return simple ? simple[1] : null;
}

describe('migration inventory', () => {
  it('parses every migration and finds the expected tables', () => {
    const tables = new Set(columns.map((c) => c.table.toLowerCase()));
    // signal_monitor_state добавлена миграцией 010 (телеметрия монитора).
    expect([...tables].sort()).toEqual([
      'audit_log',
      'email_verification_tokens',
      'scan_universe',
      'sessions',
      'signal_monitor_state',
      'signals',
      'strategy_settings',
      'user_preferences',
      'users',
    ]);
  });

  it('found every index definition in the migrations', () => {
    // Guards the parser itself: this is the exact index inventory of
    // 001–010 (12 from 001–005 + 1 from 006 + 4 from 007 + 1 from 009 + 1 from
    // 010). If the count drops, a regex silently stopped matching and the
    // checks below are void.
    expect(indexes.map((i) => i.name).sort()).toEqual([
      'idx_audit_log_action',
      'idx_audit_log_actor',
      'idx_audit_log_created_at',
      'idx_audit_log_target',
      'idx_evt_expires_at',
      'idx_evt_token_hash',
      'idx_evt_user_id',
      'idx_sessions_expire',
      'idx_signals_created_at_desc',
      'idx_signals_open_group',
      'idx_signals_previous_hash',
      'idx_signals_strategy_status',
      'idx_signals_symbol',
      'idx_signals_symbol_status_created',
      'idx_strategy_settings_enabled',
      'idx_users_email_lower',
      'idx_users_email_unverified',
      'idx_users_is_active',
      'idx_users_role',
    ]);
  });
});

/**
 * THE REGRESSION: PostgreSQL has no default operator class for GIN on `json`.
 * Only `jsonb` ships one (jsonb_ops / jsonb_path_ops).
 */
describe('operator-class compatibility (the 002 failure)', () => {
  it('no GIN index is built on a json column', () => {
    const offenders = indexes.filter((idx) => {
      if (idx.method !== 'gin') return false;
      const col = bareColumn(idx.expression);
      if (!col) return false;
      const type = typeOf(idx.table, col);
      // `json` has no default GIN opclass; `jsonb` does.
      return type === 'json';
    });

    expect(
      offenders.map((o) => `${o.file}: ${o.name} ON ${o.table}(${o.expression})`),
      'A GIN index on a json column fails with: data type json has no default operator class for access method "gin"'
    ).toEqual([]);
  });

  it('no GiST index is built on a json or jsonb column (same class of error)', () => {
    const offenders = indexes.filter((idx) => {
      if (idx.method !== 'gist') return false;
      const col = bareColumn(idx.expression);
      if (!col) return false;
      const type = typeOf(idx.table, col);
      return type === 'json' || type === 'jsonb';
    });
    expect(offenders).toEqual([]);
  });

  it('every index references a column that actually exists', () => {
    const broken = indexes.filter((idx) => {
      const col = bareColumn(idx.expression);
      // Expression indexes (lower(email), …) are not simple columns.
      if (!col) return false;
      return typeOf(idx.table, col) === undefined;
    });
    expect(broken.map((b) => `${b.file}: ${b.name}`)).toEqual([]);
  });
});

/**
 * The second half of the trap: a GIN index that IS creatable still does not
 * accelerate `->>` extraction. Any `->>` filter must not rely on GIN alone.
 */
describe('GIN cannot serve ->> extraction', () => {
  it('no code filters on a GIN-indexed json/jsonb column with ->>', () => {
    // Every column that carries a GIN index, by column name. A `->>` filter on
    // any of them would sequential-scan regardless, so it must not exist.
    const ginColumns = new Set(
      indexes
        .filter((i) => i.method === 'gin')
        .map((i) => bareColumn(i.expression)?.toLowerCase())
        .filter((c): c is string => Boolean(c))
    );

    const serverDir = path.resolve(__dirname, '../../server');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const src = fs.readFileSync(full, 'utf8');
          for (const m of src.matchAll(/(\w+)\s*->>\s*'(\w+)'/g)) {
            if (ginColumns.has(m[1].toLowerCase())) {
              offenders.push(`${entry.name}: ${m[0]} relies on a GIN index that cannot serve ->>`);
            }
          }
        }
      }
    };
    walk(serverDir);

    expect(offenders).toEqual([]);
  });

  it('the one sess->> filter in admin.js is a documented sequential scan', () => {
    const admin = fs.readFileSync(path.resolve(__dirname, '../../server/routes/admin.js'), 'utf8');
    expect(admin).toMatch(/DELETE FROM sessions WHERE sess->>'userId' = \$1/);
    // And the session really does carry a top-level userId key.
    const auth = fs.readFileSync(path.resolve(__dirname, '../../server/routes/auth.js'), 'utf8');
    expect(auth).toMatch(/req\.session\.userId\s*=/);
    // …while the migration documents why no index is built for it.
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '002_create_sessions.sql'), 'utf8');
    expect(sql).toMatch(/WHY THERE IS NO GIN INDEX/i);
  });
});

describe('sessions table matches the connect-pg-simple contract', () => {
  const canonicalPath = path.resolve(__dirname, '../../node_modules/connect-pg-simple/table.sql');
  const hasLibrary = fs.existsSync(canonicalPath);

  it('library table.sql is available to compare against', () => {
    expect(hasLibrary, 'connect-pg-simple must be installed for this contract check').toBe(true);
  });

  it('canonical library schema uses `json` for sess and indexes expire', () => {
    if (!hasLibrary) return;
    const canonical = fs.readFileSync(canonicalPath, 'utf8');
    expect(canonical).toMatch(/"sess"\s+json\s+NOT NULL/i);
    expect(canonical).toMatch(/CREATE INDEX .*expire/i);
    // The library itself creates NO GIN index.
    expect(canonical).not.toMatch(/USING\s+gin/i);
  });

  it('our sessions table declares sid PK, sess json NOT NULL, expire NOT NULL', () => {
    expect(typeOf('sessions', 'sid')).toMatch(/^varchar/);
    expect(typeOf('sessions', 'sess')).toBe('json');
    expect(typeOf('sessions', 'expire')).toMatch(/^timestamptz|^timestamp/);

    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS_DIR, '002_create_sessions.sql'), 'utf8'));
    expect(sql).toMatch(/sid\s+VARCHAR\(128\)\s+NOT NULL\s+PRIMARY KEY/i);
    expect(sql).toMatch(/sess\s+JSON\s+NOT NULL/i);
    expect(sql).toMatch(/expire\s+TIMESTAMPTZ\s+NOT NULL/i);
  });

  it('has the expire index connect-pg-simple needs for pruning', () => {
    const idx = indexes.find((i) => i.table === 'sessions' && bareColumn(i.expression) === 'expire');
    expect(idx, 'connect-pg-simple prunes with DELETE ... WHERE expire < to_timestamp($1)').toBeTruthy();
    expect(idx!.method).toBe('btree');
  });

  it('creates no GIN index on sessions', () => {
    expect(indexes.filter((i) => i.table === 'sessions' && i.method === 'gin')).toEqual([]);
  });

  it('app config points at this table and never lets the store create it', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../server/app.js'), 'utf8');
    expect(app).toMatch(/tableName:\s*'sessions'/);
    expect(app).toMatch(/createTableIfMissing:\s*false/);
  });
});

describe('general PostgreSQL 16 compatibility sweep (001–005)', () => {
  it('gen_random_uuid() needs no extension on PG13+ (core function)', () => {
    const users = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_create_users.sql'), 'utf8');
    expect(users).toMatch(/gen_random_uuid\(\)/);
    // No migration should try to install pgcrypto just for it.
    for (const file of FILES) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      expect(sql, `${file} must not require an extension`).not.toMatch(/CREATE EXTENSION/i);
    }
  });

  it('no migration uses syntax removed or unavailable in PG16', () => {
    for (const file of FILES) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // OIDS were removed in PG12; `WITH OIDS` no longer parses.
      expect(sql, `${file}: WITH OIDS was removed in PG12`).not.toMatch(/WITH\s*\(\s*OIDS\s*=\s*TRUE/i);
      // timestamp without time zone as a *string* cast is fine, but avoid MySQL-isms.
      expect(sql, `${file}: AUTO_INCREMENT is not PostgreSQL`).not.toMatch(/AUTO_INCREMENT/i);
      expect(sql, `${file}: UNSIGNED is not PostgreSQL`).not.toMatch(/\bUNSIGNED\b/i);
      expect(sql, `${file}: ENGINE= is not PostgreSQL`).not.toMatch(/ENGINE\s*=/i);
    }
  });

  it('every CREATE INDEX name is unique across all migrations', () => {
    const names = indexes.map((i) => i.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('every table has a primary key or is documented as append-only', () => {
    const sql = FILES.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
    for (const table of ['users', 'sessions', 'user_preferences', 'email_verification_tokens', 'audit_log']) {
      expect(sql, `${table} must declare a PRIMARY KEY`).toMatch(
        new RegExp(`CREATE TABLE[^;]*${table}[\\s\\S]*?PRIMARY KEY`, 'i')
      );
    }
  });

  it('foreign keys reference users(id) with an explicit ON DELETE policy', () => {
    const sql = FILES.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
    const fks = [...sql.matchAll(/REFERENCES\s+users\s*\(id\)\s*(ON DELETE\s+\w+)?/gi)];
    expect(fks.length).toBeGreaterThanOrEqual(3);
    for (const fk of fks) {
      expect(fk[1], `FK to users(id) must declare ON DELETE: ${fk[0]}`).toBeTruthy();
    }
  });
});

describe('migrations are safe to replay', () => {
  it('all DDL is idempotent (IF NOT EXISTS)', () => {
    for (const file of FILES) {
      const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      for (const m of sql.matchAll(/CREATE (TABLE|INDEX|UNIQUE INDEX)\s+(IF NOT EXISTS)?/gi)) {
        expect(m[2], `${file}: "${m[0]}" must be IF NOT EXISTS`).toBeTruthy();
      }
    }
  });
});

/**
 * 009_signal_levels_and_lifecycle: статические гарантии additive-миграции.
 *
 * Настоящее применение на PostgreSQL проверяется в
 * tests/integration/migrationsPostgres.test.ts; здесь — то, что видно из текста
 * и что легко сломать по неосторожности (удаление колонки, переписывание 007,
 * CONCURRENTLY внутри транзакции раннера).
 */
describe('009_signal_levels_and_lifecycle — только добавление', () => {
  const file = '009_signal_levels_and_lifecycle.sql';
  const sql = () => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const code = () => stripComments(sql());

  it('файл существует и следует конвенции именования', () => {
    expect(FILES).toContain(file);
    // 009 больше НЕ последний: после него идёт аддитивная 010. Проверяется
    // позиция, а не «последний файл», иначе добавление 010 ломало бы гарантию
    // того, что 009 вообще существует и идёт до неё.
    expect(FILES.indexOf(file)).toBeGreaterThanOrEqual(0);
    expect(FILES.indexOf(file)).toBeLessThan(FILES.indexOf('010_signal_monitor_bookkeeping.sql'));
  });

  it('ничего не удаляет и не переписывает данные', () => {
    const body = code();
    for (const forbidden of [
      /DROP\s+TABLE/i,
      /DROP\s+COLUMN/i,
      /TRUNCATE/i,
      /\bDELETE\s+FROM\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /RENAME\s+(TABLE|COLUMN|TO)\b/i,
      /ALTER\s+COLUMN[\s\S]{0,80}\bTYPE\b/i,
      /DROP\s+DATABASE/i,
    ]) {
      expect(body, `${file}: запрещённая операция ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('каждое добавление колонки идемпотентно (IF NOT EXISTS)', () => {
    const adds = [...code().matchAll(/ADD\s+COLUMN(\s+IF\s+NOT\s+EXISTS)?/gi)];
    expect(adds.length, 'в 009 должны быть новые колонки').toBeGreaterThanOrEqual(16);
    for (const a of adds) {
      expect(a[1], `${file}: "ADD COLUMN" без IF NOT EXISTS`).toBeTruthy();
    }
  });

  it('расширение CHECK двухшаговое: NOT VALID + VALIDATE (без долгого ACCESS EXCLUSIVE)', () => {
    const body = code();
    expect(body).toMatch(/ADD CONSTRAINT signals_status_check CHECK[\s\S]*?\)\s*NOT VALID/i);
    expect(body).toMatch(/VALIDATE CONSTRAINT signals_status_check/i);
    expect(body).toMatch(/ADD CONSTRAINT signals_entry_type_check CHECK[\s\S]*?\)\s*NOT VALID/i);
    expect(body).toMatch(/VALIDATE CONSTRAINT signals_entry_type_check/i);
    // Новый домен — надмножество старого: строки 007 проходят валидацию.
    const statuses = [...body.matchAll(/'(ACTIVE|FILLED|TARGET_REACHED|INVALIDATED|CLOSED|EXPIRED|CANCELLED|UNRESOLVED)'/g)]
      .map((m) => m[1]);
    for (const legacy of ['ACTIVE', 'INVALIDATED', 'TARGET_REACHED', 'EXPIRED']) {
      expect(statuses, `домен 007 потерял ${legacy}`).toContain(legacy);
    }
    expect(new Set(statuses).size).toBe(8);
  });

  it('нет CREATE INDEX CONCURRENTLY: раннер выполняет файл внутри транзакции', () => {
    for (const f of FILES) {
      const body = stripComments(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      expect(body, `${f}: CONCURRENTLY невозможен внутри BEGIN/COMMIT раннера`).not.toMatch(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i
      );
    }
    // Причина отсутствия зафиксирована в самом файле, а не только в тесте.
    expect(sql()).toMatch(/CONCURRENTLY/);
  });

  it('новые колонки signals разобраны парсером с ожидаемыми типами', () => {
    expect(typeOf('signals', 'targets')).toBe('numeric'); // NUMERIC[] — массивность проверяется на реальной БД
    expect(typeOf('signals', 'fill_targets')).toBe('numeric');
    expect(typeOf('signals', 'chain_version')).toBe('smallint');
    expect(typeOf('signals', 'valid_for_bars')).toBe('integer');
    expect(typeOf('signals', 'bars_held')).toBe('integer');
    expect(typeOf('signals', 'fill_price')).toBe('numeric');
    expect(typeOf('signals', 'fill_stop')).toBe('numeric');
    expect(typeOf('signals', 'result_r')).toBe('numeric');
    expect(typeOf('signals', 'net_result_r')).toBe('numeric');
    expect(typeOf('signals', 'pnl_result_pct')).toBe('numeric');
    expect(typeOf('signals', 'outcome_hash')).toBe('text');
    expect(typeOf('signals', 'strategy_version')).toBe('text');
    expect(typeOf('signals', 'engine_setup_id')).toBe('text');
    expect(typeOf('signals', 'entry_type')).toBe('text');
    expect(typeOf('signals', 'exit_rule')).toBe('text');
    expect(typeOf('signals', 'filled_at')).toBe('timestamptz');
  });

  it('миграция 007 не переписана: её колонки и индексы на месте', () => {
    for (const column of ['tp1', 'tp2', 'entry_min', 'entry_max', 'stop_loss', 'hash', 'previous_hash', 'status', 'close_price', 'close_reason', 'closed_at']) {
      expect(typeOf('signals', column), `signals.${column} из 007 исчез из инвентаря`).toBeTruthy();
    }
    for (const index of ['idx_signals_symbol', 'idx_signals_created_at_desc', 'idx_signals_strategy_status', 'idx_signals_previous_hash']) {
      expect(indexes.map((i) => i.name)).toContain(index);
    }
    // Новый индекс не дублирует существующие по набору колонок.
    const shape = (name: string) =>
      indexes.find((i) => i.name === name)?.expression.toLowerCase().replace(/\s+/g, ' ');
    expect(shape('idx_signals_symbol_status_created')).toBe('symbol, status, created_at desc');
    expect(shape('idx_signals_symbol')).toBe('symbol, created_at desc');
    const shapes = indexes.filter((i) => i.table === 'signals').map((i) => i.expression.toLowerCase());
    expect(new Set(shapes).size, 'два индекса signals с одинаковым набором колонок').toBe(shapes.length);
  });

  it('цепочка хэшей разделена по версиям: chain_version и outcome_hash', () => {
    const body = sql();
    expect(body).toMatch(/chain_version/);
    expect(body).toMatch(/ALTER TABLE signals ALTER COLUMN chain_version SET DEFAULT 2/i);
    expect(body).toMatch(/outcome_hash\s+TEXT NULL/i);
  });
});

/**
 * 010_signal_monitor_bookkeeping: статические гарантии additive-миграции.
 *
 * Настоящее применение на PostgreSQL (включая сохранность строк и целостность
 * хэш-цепочки 009) — tests/integration/signalMonitorPostgres.test.ts. Здесь —
 * то, что видно из текста: миграция добавляет, но ничего не переписывает, и не
 * трогает payload'ы хэшей.
 */
describe('010_signal_monitor_bookkeeping — только добавление', () => {
  const file = '010_signal_monitor_bookkeeping.sql';
  const sql = () => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const code = () => stripComments(sql());

  it('файл существует и идёт сразу после 009', () => {
    expect(FILES).toContain(file);
    expect(FILES[FILES.indexOf(file) - 1]).toBe('009_signal_levels_and_lifecycle.sql');
    expect(FILES[FILES.length - 1]).toBe(file);
  });

  it('ничего не удаляет и не переписывает данные', () => {
    const body = code();
    for (const forbidden of [
      /DROP\s+TABLE/i,
      /DROP\s+COLUMN/i,
      /TRUNCATE/i,
      /\bDELETE\s+FROM\b/i,
      /\bUPDATE\s+\w+\s+SET\b/i,
      /RENAME\s+(TABLE|COLUMN|TO)\b/i,
      /ALTER\s+COLUMN[\s\S]{0,80}\bTYPE\b/i,
      /DROP\s+DATABASE/i,
    ]) {
      expect(body, `${file}: запрещённая операция ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('каждое добавление колонки идемпотентно (IF NOT EXISTS)', () => {
    const adds = [...code().matchAll(/ADD\s+COLUMN(\s+IF\s+NOT\s+EXISTS)?/gi)];
    expect(adds.length, 'в 010 должны быть новые колонки signals').toBeGreaterThanOrEqual(4);
    for (const a of adds) {
      expect(a[1], `${file}: "ADD COLUMN" без IF NOT EXISTS`).toBeTruthy();
    }
  });

  it('новые колонки signals разобраны парсером с ожидаемыми типами', () => {
    expect(typeOf('signals', 'monitor_check_count')).toBe('integer');
    expect(typeOf('signals', 'monitor_last_check_at')).toBe('timestamptz');
    expect(typeOf('signals', 'monitor_last_result')).toBe('text');
    expect(typeOf('signals', 'monitor_last_error')).toBe('text');
  });

  it('таблица телеметрии — синглтон с ожидаемыми колонками', () => {
    for (const column of ['running', 'last_tick_started_at', 'last_tick_finished_at', 'last_tick_duration_ms', 'last_error', 'last_open_signals', 'last_groups', 'last_candle_requests', 'last_result', 'updated_at']) {
      expect(typeOf('signal_monitor_state', column), `signal_monitor_state.${column} не объявлена`).toBeTruthy();
    }
    expect(typeOf('signal_monitor_state', 'id')).toBe('smallint');
    expect(typeOf('signal_monitor_state', 'running')).toBe('boolean');
  });

  it('CHECK-домен результата наблюдения совпадает с кодом (MONITOR_RESULTS)', () => {
    const body = code();
    const m = body.match(/monitor_last_result\s+IN\s*\(([^)]*)\)/i);
    expect(m, 'CHECK на monitor_last_result не найден').toBeTruthy();
    const fromSql = [...(m?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    // Тот же список, что у signalRepository.MONITOR_RESULTS.
    expect(fromSql).toEqual(['ERROR', 'FILLED', 'OUT_OF_WINDOW', 'RESOLVED', 'SKIP', 'UNCHANGED']);
  });

  it('частичный индекс покрывает только открытые сигналы', () => {
    const idx = indexes.find((i) => i.name === 'idx_signals_open_group');
    expect(idx, 'idx_signals_open_group не найден').toBeTruthy();
    expect(idx?.table).toBe('signals');
    expect(idx?.method).toBe('btree');
    expect(idx?.expression.toLowerCase().replace(/\s+/g, ' ')).toBe('symbol, timeframe');
    // WHERE-предикат обязателен: без него индекс бы дублировал существующие.
    const body = code();
    const create = body.match(/CREATE INDEX IF NOT EXISTS idx_signals_open_group[\s\S]*?;/i);
    expect(create?.[0]).toMatch(/WHERE\s+status\s+IN\s*\(/i);
  });

  it('нет CREATE INDEX CONCURRENTLY: раннер выполняет файл внутри транзакции', () => {
    expect(code()).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);
  });

  it('новый индекс не дублирует существующие по набору колонок', () => {
    const shapes = indexes.filter((i) => i.table === 'signals').map((i) => i.expression.toLowerCase());
    expect(new Set(shapes).size, 'два индекса signals с одинаковым набором колонок').toBe(shapes.length);
  });
});
