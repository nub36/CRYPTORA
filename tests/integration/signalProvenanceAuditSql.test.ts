/** @vitest-environment node */
/**
 * CRYPTORA — Аудит provenance: SQL для владельца обязан РАБОТАТЬ.
 *
 * `scripts/sql/signal-provenance-audit.sql` — это то, что владелец запустит на
 * production, чтобы посчитать cross-strategy collisions. Запрос, который никто
 * не исполнял, не имеет цены: опечатка в нём выглядит как «collisions: 0», и
 * инцидент считают несуществующим.
 *
 * Здесь аудит прогоняется на НАСТОЯЩЕМ PostgreSQL с настоящими миграциями
 * (001…010) на базе, засеянной формой инцидента 2026-09-24:
 *
 *   один payload (BTC/USDT, 2026-09-24 14:00 UTC) записан под ТРЕМЯ
 *   strategy_id, при этом `engine_setup_id` и `strategy_version` несут
 *   истинного автора (V3.3) — ровно так эти поля пишет `buildSignalRecord`.
 *
 * Проверяется, что аудит:
 *   • находит ровно одну collision group из трёх строк;
 *   • доказывает подмену для двух строк (V3.0 и V2.8) и не трогает V3.3;
 *   • не находит разрывов в append-only цепочке (инцидент orchestration,
 *     а не правка задним числом).
 *
 * Только SELECT/INSERT в тестовую БД. Production не затрагивается.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startPgHarness, type PgHarnessResult } from '../helpers/embeddedPgHarness';

const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V33 = 'V3_3_HTF_ZONE_MITIGATION';
const V28 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';
const BAR = '2026-09-24T14:00:00Z';

/** Payload инцидента:Levels такие, как в production-строках владельца. */
const PAYLOAD = {
  entryMin: 83612.89569417082,
  entryMax: 83734.64430582919,
  stopLoss: 83297.56854125623,
  tp1: 85389.275,
  tp2: 87278.54,
};

let result: PgHarnessResult | null = null;
let db: any = null;
let skipReason: string | null = null;

beforeAll(async () => {
  result = await startPgHarness({ app: false });
  if (!result.ok) {
    skipReason = result.skipReason;
    return;
  }
  db = result.harness;
  await seedIncident();
}, 180_000);

afterAll(async () => {
  if (result?.ok) await result.harness.close();
});

/**
 * Три строки с ОДНИМ payload и тремя разными strategy_id.
 * `engine_setup_id` / `strategy_version` / `exit_rule` — из сетапа, поэтому во
 * всех трёх строках они называют истинного автора (V3.3): именно так их и
 * пишет `buildSignalRecord`.
 */
async function seedIncident(): Promise<void> {
  const rules: Record<string, string> = {
    [V30]: 'Ловушка ликвидности: TP1 = равновесие 4H-диапазона (50 % позиции)',
    [V33]: '4H-зона: TP1 = середина displacement-ноги 4H (50 % позиции)',
    [V28]: 'Вход по OPEN бара N+1 (рыночный, без коридора)',
  };
  let prevHash = 'GENESIS';
  for (const strategyId of [V30, V33, V28]) {
    // Автор сетапа — V3.3 во всех трёх строках (как было на проде).
    const engineSetupId = `${V33}-BTCUSDT-1758712800000`;
    const hash = `sha256-test-${strategyId}`;
    await db.q(
      `INSERT INTO signals (
         strategy_id, strategy_version, engine_setup_id, symbol, timeframe, direction,
         signal_candle_ts, entry_type, valid_for_bars, exit_rule,
         entry_min, entry_max, stop_loss, tp1, tp2, targets,
         status, metadata, hash, previous_hash, chain_version
       ) VALUES (
         $1, $2, $3, 'BTC/USDT', '1h', 'LONG', $4,
         'LIMIT_CORRIDOR', 3, $5,
         $6, $7, $8, $9, $10, ARRAY[$9::numeric, $10::numeric],
         'ACTIVE', '{}'::jsonb, $11, $12, 2
       )`,
      [
        strategyId,
        '3.3',
        engineSetupId,
        BAR,
        rules[V33],
        PAYLOAD.entryMin,
        PAYLOAD.entryMax,
        PAYLOAD.stopLoss,
        PAYLOAD.tp1,
        PAYLOAD.tp2,
        hash,
        prevHash,
      ],
    );
    prevHash = hash;
  }
}

/** Исполняет все SELECT'ы аудита; psql-мета команды (`\echo`) отбрасываются. */
async function runAudit(): Promise<Record<string, any[]>> {
  const file = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/sql/signal-provenance-audit.sql'),
    'utf8',
  );
  const statements = file
    .split('\n')
    .filter((line) => !line.trim().startsWith('\\'))
    .join('\n')
    .split(';')
    .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim())
    .filter((s) => /^(SELECT|WITH)/im.test(s));

  const out: Record<string, any[]> = {};
  for (const [i, sql] of statements.entries()) {
    out[`stmt${i}`] = await db.q(sql);
  }
  return out;
}

const withPg = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!db) {
      ctx.skip();
      return;
    }
    await fn();
  });

describe('Аудит provenance: SQL исполняется и находит инцидент', () => {
  it('PostgreSQL поднят — иначе аудит непроверяем', () => {
    if (skipReason) throw new Error(skipReason);
    expect(db).toBeTruthy();
  });

  withPg('все запросы аудита синтаксически валидны и исполняются', async () => {
    const out = await runAudit();
    expect(Object.keys(out).length, 'аудит должен содержать несколько запросов').toBeGreaterThanOrEqual(5);
  });

  withPg('collision group из трёх strategy_id найден', async () => {
    const out = await runAudit();
    const flat = Object.values(out).flat();
    const totals = flat.find((r: any) => r && typeof r === 'object' && 'collision_groups' in r);
    expect(totals, 'аудит обязан вернуть итог по collision groups').toBeTruthy();
    expect(Number(totals.collision_groups)).toBe(1);
    expect(Number(totals.rows_in_collisions)).toBe(3);
    expect(Number(totals.strategy_slots_in_collisions)).toBe(3);
  });

  withPg('подмена авторства доказана для двух строк и не задевает истинного автора', async () => {
    const out = await runAudit();
    const flat = Object.values(out).flat();
    const pairs = flat.filter((r: any) => r && typeof r === 'object' && 'labeled_as' in r && 'generated_by' in r && 'misattributed_rows' in r);
    expect(pairs).toHaveLength(2);
    const byLabel = new Map(pairs.map((p: any) => [p.labeled_as, p]));
    expect(byLabel.get(V30)!.generated_by, 'V3.0-строка порождена V3.3').toBe(V33);
    expect(byLabel.get(V28)!.generated_by, 'V2.8-строка порождена V3.3').toBe(V33);
    expect(Number(byLabel.get(V30)!.misattributed_rows)).toBe(1);
    expect(Number(byLabel.get(V28)!.misattributed_rows)).toBe(1);
  });

  withPg('append-only цепочка не разорвана: инцидент orchestration, а не правка', async () => {
    const out = await runAudit();
    const flat = Object.values(out).flat();
    const chain = flat.find((r: any) => r && typeof r === 'object' && 'chain_breaks' in r);
    expect(chain).toBeTruthy();
    expect(Number(chain.chain_breaks), 'подмена авторства не рвала цепочку хэшей').toBe(0);
    expect(Number(chain.rows_checked)).toBe(3);
  });
});
