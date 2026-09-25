/** @vitest-environment node */
/**
 * CRYPTORA — Карантин provenance на НАСТОЯЩЕМ PostgreSQL.
 *
 * Здесь проверяется не «мы так думаем», а исполняемый результат на базе с
 * НАСТОЯЩИМИ миграциями (001…011) и населением, повторяющим production-картину
 * инцидента 2026-09-24, которую владелец снял read-only запросами:
 *
 *   • всего сигналов: 45;
 *   • статусы: ACTIVE 36 / FILLED 6 / CANCELLED 3;
 *   • 15 collision-групп × 3 strategy_id = 45 строк инцидентной популяции;
 *   • 30 доказанных расхождений provenance;
 *   • открытых с совпадением: MATCH ACTIVE 6 + MATCH FILLED 6 = 12;
 *   • MISMATCH ACTIVE = 30 (все расхождения открыты).
 *
 * Матрица (что записано → кто сгенерировал), воспроизводимая здесь построчно:
 *
 *   V2.8 ← V3.0 : 6      V3.0 ← V3.0 : 6      V3.3 ← V3.0 : 6
 *   V2.8 ← V3.3 : 9      V3.0 ← V3.3 : 9      V3.3 ← V3.3 : 9
 *
 * Следствия, которые обязаны выполняться: V2.8 не автор ни одной строки;
 * MATCH = 15 (6 + 9); MISMATCH = 30; из 15 MATCH три отменены, остальные 12
 * открыты и это ЕДИНСТВЕННЫЕ строки, которым вообще можно доверять.
 *
 * Проверяется:
 *   1. миграция 011 аддитивна и не ломает существующие строки;
 *   2. унаследованные строки по умолчанию UNKNOWN (fail-closed), а не VERIFIED;
 *   3. JS-классификатор и SQL-CASE дают ОДИН результат на всех формах
 *      `engine_setup_id` (иначе процедура и код разъедутся);
 *   4. процедура классификации: dry-run ничего не меняет; --apply меняет
 *      только `provenance_status`; повторный --apply меняет 0 строк;
 *   5. монитор видит 12 открытых VERIFIED и никогда — 30 MISMATCH;
 *   6. UNKNOWN не мониторится (fail-closed);
 *   7. статистика считает только VERIFIED, а карантин виден отдельными
 *      audit-счётчиками;
 *   8. хэш-цепочка остаётся валидной ДО и ПОСЛЕ карантина, а сами `hash`
 *      и `outcome_hash` не переписываются;
 *   9. `strategy_id`, `engine_setup_id` и уровни сигнала не тронуты.
 *
 * Production не затрагивается: поднимается временная БД, в конце — close().
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startPgHarness, type PgHarnessResult } from '../helpers/embeddedPgHarness';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/signal-provenance-classify.mjs');

const V30 = 'V3_0_HTF_LIQUIDATION_TRAP';
const V33 = 'V3_3_HTF_ZONE_MITIGATION';
const V28 = 'V2_8_ZERO_FEE_SNIPER_TRAILING';

/** Порядок strategy_id внутри collision-группы — как в production-выборке. */
const PERSISTED_ORDER = [V28, V30, V33] as const;

/** 15 групп: первые 6 сгенерированы V3.0, остальные 9 — V3.3 (см. матрицу). */
const GROUPS_V30 = 6;
const GROUPS_TOTAL = 15;

/** Расписание статусов для строк с совпадением (MATCH): 6 ACTIVE, 6 FILLED, 3 CANCELLED. */
const MATCH_STATUSES: Array<'ACTIVE' | 'FILLED' | 'CANCELLED'> = [
  ...Array.from({ length: 6 }, () => 'ACTIVE' as const),
  ...Array.from({ length: 6 }, () => 'FILLED' as const),
  ...Array.from({ length: 3 }, () => 'CANCELLED' as const),
];

let result: PgHarnessResult | null = null;
let h: any = null;
let skipReason: string | null = null;
let repo: any = null;
let stats: any = null;
let provenance: any = null;

/** Снимок «до» классификации — по нему проверяется, что ничего не переписано. */
let snapshotBefore: any[] = [];
let chainBefore: { rows: number; breaks: number } = { rows: 0, breaks: 0 };

const withPg = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!h) {
      ctx.skip();
      return;
    }
    await fn();
  });

/**
 * Население инцидента. `engine_setup_id` называет ИСТИННОГО автора (как его и
 * пишет ядро: `${strategyId}-${SYMBOL}-${openTime}`), а `strategy_id` — ту
 * стратегию, под которой строка была сохранена. Расхождение это и есть
 * доказательство подмены авторства.
 */
async function seedIncidentPopulation(): Promise<void> {
  let matchSeen = 0;
  const toCancel: Array<{ id: string; symbol: string }> = [];

  for (let g = 0; g < GROUPS_TOTAL; g += 1) {
    const generatedBy = g < GROUPS_V30 ? V30 : V33;
    const symbol = `S${String(g).padStart(2, '0')}/USDT`;
    const signalCandleTs = new Date(Date.parse('2026-09-24T14:00:00Z') + g * 3_600_000);
    const engineSetupId = `${generatedBy}-${symbol.replace('/', '')}-${signalCandleTs.getTime()}`;

    for (const strategyId of PERSISTED_ORDER) {
      const isMatch = strategyId === generatedBy;
      // Расхождение всегда остаётся открытым (ровно как на проде: MISMATCH
      // ACTIVE = 30), совпадения получают статус по расписанию.
      const status = isMatch ? MATCH_STATUSES[matchSeen++] : 'ACTIVE';

      const res = await repo.insertSignal({
        strategyId,
        strategyVersion: generatedBy === V30 ? '3.0' : '3.3',
        engineSetupId,
        symbol,
        timeframe: '1h',
        direction: 'LONG',
        signalCandleTs,
        entryType: 'LIMIT_CORRIDOR',
        validForBars: 3,
        exitRule: generatedBy === V30
          ? 'Ловушка ликвидности: TP1 = равновесие 4H-диапазона (50 % позиции)'
          : '4H-зона: TP1 = середина displacement-ноги 4H (50 % позиции)',
        entryMin: 100 + g,
        entryMax: 101 + g,
        stopLoss: 95 + g,
        targets: [110 + g, 120 + g],
        status: 'ACTIVE',
        // УНАСЛЕДОВАННАЯ строка: provenance здесь НЕ передан, потому что
        // записана она была ДО исправления. Репозиторий обязан оставить её
        // UNKNOWN (fail-closed), а не выдать авансом VERIFIED.
      });
      expect(res.inserted, `вставка ${strategyId}/${symbol}`).toBe(true);

      if (status === 'CANCELLED') {
        toCancel.push({ id: res.signal.id, symbol });
      } else if (status === 'FILLED') {
        await h.q(`UPDATE signals SET status = 'FILLED' WHERE id = $1`, [res.signal.id]);
      }
    }
  }

  // Отменённые строки закрываются НАСТОЯЩИМ путём жизненного цикла: у закрытой
  // строки обязан быть `outcome_hash`, иначе `verifyChain()` справедливо
  // сообщит о разрыве и проверка хэш-цепочки станет фикцией.
  for (const { id } of toCancel) {
    await repo.closeSignal(id, 'CANCELLED', { closeReason: 'INSUFFICIENT_VOLUME' });
  }
}

beforeAll(async () => {
  result = await startPgHarness({ app: false, prefix: 'cryptora-pg-provenance-' });
  if (!result.ok) {
    skipReason = result.skipReason;
    return;
  }
  h = result.harness;

  repo = await import('../../server/services/signalRepository.js');
  stats = await import('../../server/services/signalStatistics.js');
  provenance = await import('../../server/services/signalProvenance.js');

  await seedIncidentPopulation();

  snapshotBefore = await h.q('SELECT * FROM signals ORDER BY id ASC');
  chainBefore = await repo.verifyChain();
}, 180_000);

afterAll(async () => {
  if (result?.ok) await result.harness.close();
});

describe('Миграция 011 — карантин provenance', () => {
  it('PostgreSQL с миграциями поднят', () => {
    if (skipReason) throw new Error(skipReason);
    expect(h).toBeTruthy();
  });

  withPg('колонка и CHECK-домен созданы, индекс на месте', async () => {
    const col = await h.q(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_name = 'signals' AND column_name = 'provenance_status'`,
    );
    expect(col).toHaveLength(1);
    // DEFAULT 'UNKNOWN' — fail-closed: отсутствие доказательства не согласие.
    expect(String(col[0].column_default)).toContain('UNKNOWN');
    expect(col[0].is_nullable).toBe('NO');

    const idx = await h.q(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'signals' AND indexname = 'idx_signals_provenance_open'`,
    );
    expect(idx).toHaveLength(1);
  });

  withPg('CHECK отвергает недопустимый provenance_status', async () => {
    // Значение вне домена CHECK обязан отвергнуть — иначе «карантин» был бы
    // просто строкой без гарантий.
    await expect(
      h.q(`UPDATE signals SET provenance_status = 'TRUST_ME' WHERE id = $1`, [snapshotBefore[0].id]),
    ).rejects.toThrow(/provenance_status_check/i);

    // И ни одна строка не осталась с недопустимым статусом.
    const bad = await h.q(
      `SELECT COUNT(*)::int AS n FROM signals
        WHERE provenance_status NOT IN ('VERIFIED','MISMATCH','UNKNOWN')`,
    );
    expect(bad[0].n, 'внедоменных значений в таблице быть не может').toBe(0);
  });

  withPg('население воспроизводит production: 45 строк, 15 групп, 36/6/3', async () => {
    const total = (await h.q('SELECT COUNT(*)::int AS n FROM signals'))[0].n;
    expect(total).toBe(45);

    const byStatus = await h.q('SELECT status, COUNT(*)::int AS n FROM signals GROUP BY status');
    const map = Object.fromEntries(byStatus.map((r: any) => [r.status, Number(r.n)]));
    expect(map).toMatchObject({ ACTIVE: 36, FILLED: 6, CANCELLED: 3 });

    const groups = await h.q(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT signal_candle_ts FROM signals GROUP BY signal_candle_ts HAVING COUNT(DISTINCT strategy_id) = 3
       ) g`,
    );
    expect(groups[0].n, '15 collision-групп по 3 strategy_id').toBe(15);
  });

  withPg('матрица «что записано → кто сгенерировал» совпадает с production', async () => {
    const rows = await h.q(`
      SELECT strategy_id, split_part(engine_setup_id, '-', 1) AS generated_by, COUNT(*)::int AS n
        FROM signals GROUP BY 1, 2 ORDER BY 1, 2
    `);
    const m = new Map(rows.map((r: any) => [`${r.strategy_id}|${r.generated_by}`, Number(r.n)]));
    expect(m.get(`${V28}|${V30}`)).toBe(6);
    expect(m.get(`${V28}|${V33}`)).toBe(9);
    expect(m.get(`${V30}|${V30}`)).toBe(6);
    expect(m.get(`${V30}|${V33}`)).toBe(9);
    expect(m.get(`${V33}|${V30}`)).toBe(6);
    expect(m.get(`${V33}|${V33}`)).toBe(9);
    // V2.8 НЕ автор ни одной строки — прямое следствие матрицы.
    const byV28 = rows.filter((r: any) => r.generated_by === V28);
    expect(byV28).toHaveLength(0);
  });

  withPg('унаследованные строки приходят UNKNOWN, а не VERIFIED (fail-closed)', async () => {
    const counts = await h.q('SELECT provenance_status, COUNT(*)::int AS n FROM signals GROUP BY 1');
    const map = Object.fromEntries(counts.map((r: any) => [r.provenance_status, Number(r.n)]));
    expect(map).toEqual({ UNKNOWN: 45 });
    // И ни одной строки, которую монитор имел бы право вести.
    expect(await repo.listOpenSignals(null, 500)).toHaveLength(0);
  });

  withPg('JS-классификатор и SQL-CASE дают одинаковый ответ на всех формах id', async () => {
    const cases = [
      { strategyId: V30, engineSetupId: `${V30}-BTCUSDT-1`, expected: 'VERIFIED' },
      { strategyId: V30, engineSetupId: `${V33}-BTCUSDT-1`, expected: 'MISMATCH' },
      { strategyId: V30, engineSetupId: null, expected: 'UNKNOWN' },
      { strategyId: V30, engineSetupId: '', expected: 'UNKNOWN' },
      { strategyId: V30, engineSetupId: '   ', expected: 'UNKNOWN' },
      { strategyId: V30, engineSetupId: 'БЕЗ-РАЗДЕЛИТЕЛЯ-НО-НЕ-STRATEGY', expected: 'MISMATCH' },
      { strategyId: V30, engineSetupId: 'НЕЧИТАЕМОЕ', expected: 'UNKNOWN' },
      { strategyId: V30, engineSetupId: '-BTCUSDT-1', expected: 'UNKNOWN' },
      { strategyId: '', engineSetupId: `${V30}-BTCUSDT-1`, expected: 'UNKNOWN' },
    ];

    for (const c of cases) {
      const js = provenance.classifyProvenance(c);
      const rows = await h.q(
        `SELECT ${provenance.PROVENANCE_CASE_SQL} AS st
           FROM (SELECT $1::text AS strategy_id, $2::text AS engine_setup_id) s`,
        [c.strategyId, c.engineSetupId],
      );
      expect(js, `JS: ${JSON.stringify(c)}`).toBe(c.expected);
      expect(rows[0].st, `SQL: ${JSON.stringify(c)}`).toBe(c.expected);
      expect(js).toBe(rows[0].st);
    }
  });

  withPg('UNKNOWN никогда не становится VERIFIED: префикса нет ⇒ не доказано', async () => {
    await h.q(
      `INSERT INTO signals (strategy_id, symbol, timeframe, direction, signal_candle_ts,
                            status, hash, previous_hash, chain_version, engine_setup_id)
       VALUES ('MYSTERY', 'ZZZ/USDT', '1h', 'LONG', '2026-01-01T00:00:00Z',
               'ACTIVE', 'sha256-unknown-row', 'GENESIS', 2, NULL)`,
    );
    const row = (await h.q(`SELECT strategy_id, engine_setup_id, provenance_status FROM signals WHERE strategy_id = 'MYSTERY'`))[0];
    expect(provenance.classifyProvenance(row)).toBe('UNKNOWN');
    expect(provenance.isMonitorEligible({ ...row, status: 'ACTIVE' })).toBe(false);
    expect(provenance.isStatisticsEligible(row)).toBe(false);
    await h.q(`DELETE FROM signals WHERE strategy_id = 'MYSTERY'`);
  });

  withPg('dry-run: отчёт есть, изменений нет', async () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--json'], {
      env: { ...process.env, DATABASE_URL: h.url },
      cwd: ROOT,
      encoding: 'utf8',
    });
    const report = JSON.parse(out);
    expect(report.mode).toBe('DRY-RUN');
    expect(report.committed).toBe(false);
    expect(report.before).toEqual({ VERIFIED: 0, MISMATCH: 0, UNKNOWN: 45 });
    expect(report.transitions).toEqual(
      expect.arrayContaining([
        { from: 'UNKNOWN', to: 'MISMATCH', n: 30 },
        { from: 'UNKNOWN', to: 'VERIFIED', n: 15 },
      ]),
    );

    // Главное: без --apply база не тронута.
    const after = await h.q('SELECT provenance_status, COUNT(*)::int AS n FROM signals GROUP BY 1');
    expect(Object.fromEntries(after.map((r: any) => [r.provenance_status, Number(r.n)]))).toEqual({ UNKNOWN: 45 });
  });

  withPg('--apply: 15 VERIFIED, 30 MISMATCH, 0 UNKNOWN', async () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--apply', '--json'], {
      env: { ...process.env, DATABASE_URL: h.url },
      cwd: ROOT,
      encoding: 'utf8',
    });
    const report = JSON.parse(out);
    expect(report.committed).toBe(true);
    expect(report.rowsUpdated).toBe(45);
    expect(report.after).toEqual({ VERIFIED: 15, MISMATCH: 30, UNKNOWN: 0 });

    const counts = await h.q('SELECT provenance_status, COUNT(*)::int AS n FROM signals GROUP BY 1');
    // GROUP BY не вернёт ключ с нулём — ровно поэтому «UNKNOWN: 0» здесь и нет.
    expect(Object.fromEntries(counts.map((r: any) => [r.provenance_status, Number(r.n)]))).toEqual({
      VERIFIED: 15,
      MISMATCH: 30,
    });

    // Из 15 VERIFIED ровно 12 открыты и 3 отменены — как на проде.
    const open = await h.q(
      `SELECT COUNT(*)::int AS n FROM signals WHERE provenance_status = 'VERIFIED' AND status IN ('ACTIVE','FILLED')`,
    );
    expect(open[0].n).toBe(12);
    const mismOpen = await h.q(
      `SELECT COUNT(*)::int AS n FROM signals WHERE provenance_status = 'MISMATCH' AND status = 'ACTIVE'`,
    );
    expect(mismOpen[0].n, 'все 30 расхождений открыты — именно их монитор не должен видеть').toBe(30);
  });

  withPg('повторный --apply меняет 0 строк (идемпотентность)', async () => {
    const out = execFileSync(process.execPath, [SCRIPT, '--apply', '--json'], {
      env: { ...process.env, DATABASE_URL: h.url },
      cwd: ROOT,
      encoding: 'utf8',
    });
    const report = JSON.parse(out);
    expect(report.rowsUpdated, 'процедуру можно запускать сколько угодно раз').toBe(0);
    expect(report.transitions, 'переходов больше нет').toEqual([]);
    expect(report.after).toEqual({ VERIFIED: 15, MISMATCH: 30, UNKNOWN: 0 });
  });

  withPg('карантин НЕ переписал доказательства, уровни и хэши', async () => {
    const after = await h.q('SELECT * FROM signals ORDER BY id ASC');
    expect(after).toHaveLength(snapshotBefore.length);

    const FIELDS = [
      'strategy_id', 'engine_setup_id', 'entry_min', 'entry_max', 'stop_loss',
      'tp1', 'tp2', 'targets', 'hash', 'previous_hash', 'outcome_hash',
      'status', 'signal_candle_ts', 'symbol', 'direction', 'exit_rule',
    ] as const;

    const changed: string[] = [];
    for (let i = 0; i < after.length; i += 1) {
      for (const f of FIELDS) {
        const a = snapshotBefore[i][f];
        const b = after[i][f];
        const an = a instanceof Date ? a.toISOString() : a;
        const bn = b instanceof Date ? b.toISOString() : b;
        if (JSON.stringify(an) !== JSON.stringify(bn)) changed.push(`${after[i].id}.${f}`);
      }
    }
    expect(changed, 'изменилось только provenance_status').toEqual([]);
  });

  withPg('хэш-цепочка валидна ДО и ПОСЛЕ карантина', async () => {
    expect(chainBefore, 'цепочка была целой до классификации').toEqual({ rows: 45, breaks: 0 });
    expect(await repo.verifyChain(), 'карантин не порвал цепочку').toEqual({ rows: 45, breaks: 0 });
  });

  withPg('монитор видит 12 открытых VERIFIED и никогда — 30 MISMATCH', async () => {
    const workset = await repo.listOpenSignals(null, 500);
    expect(workset).toHaveLength(12);
    expect(new Set(workset.map((r: any) => r.provenanceStatus))).toEqual(new Set(['VERIFIED']));

    // Все открытые строки (включая карантин) — 42 = 12 VERIFIED + 30 MISMATCH.
    const all = await repo.listOpenSignals(null, 500, { includeQuarantined: true });
    expect(all).toHaveLength(42);
    const quarantinedOpen = all.filter((r: any) => r.provenanceStatus !== 'VERIFIED');
    expect(quarantinedOpen).toHaveLength(30);
  });

  withPg('countActiveSignals считает только доказанные', async () => {
    expect(await repo.countActiveSignals()).toBe(12);
    expect(await repo.countActiveSignals(null, { includeQuarantined: true })).toBe(42);
  });

  withPg('UNKNOWN fail-closed: открытая непроверенная строка не мониторится', async () => {
    await h.q(
      `INSERT INTO signals (strategy_id, symbol, timeframe, direction, signal_candle_ts,
                            status, hash, previous_hash, chain_version, provenance_status)
       VALUES ('V9_9_UNKNOWN', 'UNK/USDT', '1h', 'LONG', '2026-02-02T00:00:00Z',
               'ACTIVE', 'sha256-fail-closed', 'GENESIS', 2, 'UNKNOWN')`,
    );
    const workset = await repo.listOpenSignals(null, 500);
    expect(workset.some((r: any) => r.symbol === 'UNK/USDT'), 'UNKNOWN в рабочий набор не попадает').toBe(false);
    await h.q(`DELETE FROM signals WHERE symbol = 'UNK/USDT'`);
  });

  withPg('статистика считает только VERIFIED и показывает карантин отдельно', async () => {
    const s = await stats.getSignalStatistics({ period: 'all' });
    // 15 доказанных строк — и ни одна строка карантина в показателях.
    expect(s.totals.published).toBe(15);
    expect(s.provenance).toEqual({ verified: 15, mismatch: 30, unknown: 0, total: 45 });

    // Сумма по стратегиям сходится с итогом — иначе разрез считался по другим
    // правилам, чем «всего».
    const sum = s.byStrategy.reduce((a: number, r: any) => a + r.published, 0);
    expect(sum).toBe(15);

    // Карантин физически в таблице, но в показателях его нет.
    const quarantinedRows = await h.q(
      `SELECT COUNT(*)::int AS n FROM signals WHERE provenance_status = 'MISMATCH' AND result_r IS NOT NULL`,
    );
    expect(quarantinedRows[0].n).toBe(0);
  });

  withPg('чужой результат не становится своим: R из карантина в win rate не идёт', async () => {
    // Искусственный, но показательный случай: строке в карантине дописан
    // result_r. Показатели обязаны его проигнорировать.
    const id = (await h.q(`SELECT id FROM signals WHERE provenance_status = 'MISMATCH' LIMIT 1`))[0].id;
    await h.q(`UPDATE signals SET status = 'TARGET_REACHED', result_r = 42, outcome_hash = NULL WHERE id = $1`, [id]);

    const s = await stats.getSignalStatistics({ period: 'all' });
    expect(s.totals.wins, 'R из карантина не должен стать победой').toBe(0);
    expect(s.totals.ratedCompleted).toBe(0);
    expect(s.totals.avgGrossR).toBeNull();

    // Возвращаем как было: состояние shared для следующих проверок.
    await h.q(`UPDATE signals SET status = 'ACTIVE', result_r = NULL WHERE id = $1`, [id]);
  });

  withPg('монитор на настоящем рабочем наборе не трогает карантин', async () => {
    const monitorMod: any = await import('../../server/services/signalMonitor/signalMonitor.js');
    const before = await h.q(
      `SELECT id, monitor_check_count FROM signals WHERE provenance_status = 'MISMATCH' ORDER BY id`,
    );

    const monitor = new monitorMod.SignalMonitor({
      now: () => Date.parse('2026-09-24T20:00:00Z'),
      // Рабочий набор — НАСТОЯЩИЙ listOpenSignals (уже с фильтром provenance),
      // а не подмена: именно он и должен отсечь карантин.
      listOpen: (limit: number) => repo.listOpenSignals(null, limit),
      sync: (patch: unknown) => repo.syncSignalLifecycle(patch as never),
      // Свечей нет — тик не должен ничего довести до исхода. Проверяется не
      // результат наблюдения, а СОСТАВ рабочего набора.
      getCandles: async () => [],
      recordMonitor: (id: string, patch: unknown) => repo.recordSignalMonitorCheck(id, patch as never),
      loadCore: async () => {
        const core = await import('../../server/services/strategyEngine/strategyCoreBundle.js');
        return core.loadStrategyCore();
      },
      sleep: async () => {},
      requestTimeoutMs: 5000,
    });

    const summary = await monitor.tick();

    expect(summary.openSignals, 'в рабочем наборе 12 доказанных и ни одного MISMATCH').toBe(12);
    expect(summary.errors).toBe(0);

    const after = await h.q(
      `SELECT id, monitor_check_count FROM signals WHERE provenance_status = 'MISMATCH' ORDER BY id`,
    );
    expect(after, 'монитор не дотронулся ни до одной строки карантина').toEqual(before);
  });
});
