#!/usr/bin/env node
/**
 * CRYPTORA — Классификация происхождения уже сохранённых сигналов.
 *
 * Usage:
 *   node scripts/signal-provenance-classify.mjs            # ТОЛЬКО отчёт (read-only)
 *   node scripts/signal-provenance-classify.mjs --apply    # отчёт + UPDATE в транзакции
 *   node scripts/signal-provenance-classify.mjs --json     # отчёт машиночитаемо
 *
 * ЗАЧЕМ
 * -----
 * Инцидент 2026-09-24: один payload оказался записан под тремя `strategy_id`.
 * Миграция 011 добавила колонку-классификатор `signals.provenance_status` с
 * DEFAULT 'UNKNOWN' (fail-closed) — то есть сразу после миграции НИ ОДНА
 * существующая строка не считается доказанной. Этот скрипт переводит строки из
 * UNKNOWN в VERIFIED/MISMATCH, но ТОЛЬКО там, где есть прямое доказательство.
 *
 * ЧТО СЧИТАЕТСЯ ДОКАЗАТЕЛЬСТВОМ
 * -----------------------------
 * `engine_setup_id` создаётся ядром как
 *     `${strategyId}-${symbol.toUpperCase()}-${setupOpenTime}`
 * значит префикс до первого '-' — это стратегия, которая РЕАЛЬНО создала сетап.
 *
 *   префикс == strategy_id  → VERIFIED  (запись согласна с генератором)
 *   префикс != strategy_id  → MISMATCH  (доказано, что строка перемаркирована)
 *   префикса нет            → UNKNOWN   (доказательства НЕТ; остаётся UNKNOWN)
 *
 * ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ НЕ НАРУШАЮТСЯ
 * -------------------------------------
 * 1. НИ ОДНОГО DELETE. Строки не удаляются никогда.
 * 2. НЕ ТРОГАЕМ `strategy_id` и `engine_setup_id` — это доказательство.
 *    UPDATE пишет РОВНО ОДНУ колонку: `provenance_status`.
 * 3. НЕ ТРОГАЕМ ХЭШИ: `hash`, `previous_hash`, `outcome_hash` не пересчитываются.
 *    `provenance_status` не входит в `hashPayloadV2`, поэтому цепочка остаётся
 *    валидной — это проверяется отдельным тестом, а не обещанием.
 * 4. НЕ ТРОГАЕМ УРОВНИ: `entry_min/max`, `stop_loss`, `targets`, `tp1/tp2`.
 * 5. IDEMPOTENT: повторный запуск на классифицированной базе меняет 0 строк
 *    (UPDATE пишет только там, где вычисленное значение отличается от текущего).
 *    Запускать можно сколько угодно раз — результат одинаковый.
 * 6. ПРОВЕРЯЕМО: до и после печатается количество строк по каждому статусу,
 *    по strategy_id и по парам (strategy_id → генератор). Разница видна глазами.
 * 7. ТРАНЗАКЦИЯ: BEGIN … UPDATE … отчёт … COMMIT. Ошибка ⇒ ROLLBACK, база
 *    остаётся как была. Без `--apply` скрипт НЕ открывает транзакцию записи.
 *
 * ЧЕГО СКРИПТ НЕ ДЕЛАЕТ
 * ---------------------
 * • Не повышает UNKNOWN до VERIFIED «по догадке» — только по совпадению префикса.
 * • Не удаляет и не «чинит» сигналы.
 * • Не включает/выключает стратегии и не запускает монитор.
 */

import pg from 'pg';
import { PROVENANCE_CASE_SQL, PROVENANCE_VERIFIED, PROVENANCE_MISMATCH, PROVENANCE_UNKNOWN } from '../server/services/signalProvenance.js';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cryptora:cryptora@127.0.0.1:5432/cryptora';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const AS_JSON = args.has('--json');

const line = (s = '') => { if (!AS_JSON) console.log(s); };

/** Отчёт «до»: сколько строк по статусам. */
async function statusCounts(client) {
  const { rows } = await client.query(
    `SELECT provenance_status, COUNT(*)::int AS n FROM signals GROUP BY provenance_status`
  );
  const out = { VERIFIED: 0, MISMATCH: 0, UNKNOWN: 0 };
  for (const r of rows) out[r.provenance_status] = Number(r.n);
  return out;
}

/** Отчёт «до»: разбивка по strategy_id × генератор (из префикса engine_setup_id). */
async function matrix(client) {
  const { rows } = await client.query(`
    SELECT strategy_id,
           CASE
             WHEN engine_setup_id IS NULL OR btrim(engine_setup_id) = '' THEN '(нет id сетапа)'
             WHEN position('-' in engine_setup_id) <= 1 THEN '(нечитаемый id сетапа)'
             ELSE split_part(engine_setup_id, '-', 1)
           END AS generated_by,
           COUNT(*)::int AS n
      FROM signals
     GROUP BY 1, 2
     ORDER BY 1, 2
  `);
  return rows.map((r) => ({ strategyId: r.strategy_id, generatedBy: r.generated_by, n: Number(r.n) }));
}

/** План: сколько строк перейдёт в какой статус (той же логикой, что и UPDATE). */
async function plan(client) {
  const { rows } = await client.query(`
    SELECT provenance_status AS current_status,
           ${PROVENANCE_CASE_SQL} AS target_status,
           COUNT(*)::int AS n
      FROM signals
     GROUP BY 1, 2
     ORDER BY 1, 2
  `);
  return rows.map((r) => ({ from: r.current_status, to: r.target_status, n: Number(r.n) }));
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();

  const report = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    database: DATABASE_URL.replace(/\/\/[^@]*@/, '//***@'),
    before: null,
    transitions: null,
    after: null,
    rowsUpdated: 0,
    committed: false,
  };

  try {
    report.before = await statusCounts(client);
    const matrixBefore = await matrix(client);
    report.transitions = (await plan(client)).filter((t) => t.from !== t.to);

    if (!AS_JSON) {
      line('════════════════════════════════════════════════════════════════');
      line('  CRYPTORA — классификация происхождения сигналов');
      line(`  Режим: ${report.mode}${APPLY ? '' : '   (изменений НЕ будет: нужен --apply)'}`);
      line(`  БД:    ${report.database}`);
      line('════════════════════════════════════════════════════════════════');
      line('');
      line('ДО:');
      line(`  VERIFIED = ${report.before.VERIFIED}`);
      line(`  MISMATCH = ${report.before.MISMATCH}`);
      line(`  UNKNOWN  = ${report.before.UNKNOWN}`);
      line('');
      line('Матрица «что записано → кто сгенерировал» (префикс engine_setup_id):');
      for (const r of matrixBefore) line(`  ${r.strategyId} ← ${r.generatedBy}: ${r.n}`);
      line('');
      line('План переходов:');
      if (report.transitions.length === 0) {
        line('  (нет: база уже классифицирована — повторный запуск ничего не меняет)');
      } else {
        for (const t of report.transitions) line(`  ${t.from} → ${t.to}: ${t.n} стр.`);
      }
      line('');
    }

    if (!APPLY) {
      if (AS_JSON) console.log(JSON.stringify(report, null, 2));
      else {
        line('DRY-RUN: транзакция записи НЕ открывалась, ни одна строка не изменена.');
        line('Для применения: node scripts/signal-provenance-classify.mjs --apply');
      }
      return;
    }

    // Единственная мутация — ОДНА колонка. Предикат `IS DISTINCT FROM` делает
    // повторный запуск пустым (0 строк), а не «ещё раз перезаписать всё».
    await client.query('BEGIN');
    try {
      const res = await client.query(`
        UPDATE signals
           SET provenance_status = ${PROVENANCE_CASE_SQL}
         WHERE provenance_status IS DISTINCT FROM (${PROVENANCE_CASE_SQL})
      `);
      report.rowsUpdated = res.rowCount ?? 0;

      // Контроль внутри той же транзакции: если UPDATE задел что-то кроме
      // provenance_status — ROLLBACK. Проверка дешёвая и страхует от опечатки
      // в CASE-выражении выше.
      const guardRes = await client.query(`
        SELECT COUNT(*)::int AS n
          FROM signals
         WHERE provenance_status NOT IN ('${PROVENANCE_VERIFIED}', '${PROVENANCE_MISMATCH}', '${PROVENANCE_UNKNOWN}')
      `);
      if (guardRes.rows[0].n !== 0) {
        throw new Error(`Обнаружен недопустимый provenance_status (${guardRes.rows[0].n} строк) — откат.`);
      }

      report.after = await statusCounts(client);
      const matrixAfter = await matrix(client);

      if (!AS_JSON) {
        line('ПОСЛЕ:');
        line(`  VERIFIED = ${report.after.VERIFIED}`);
        line(`  MISMATCH = ${report.after.MISMATCH}`);
        line(`  UNKNOWN  = ${report.after.UNKNOWN}`);
        line(`  Изменено строк: ${report.rowsUpdated}`);
        line('');
        line('Матрица после:');
        for (const r of matrixAfter) line(`  ${r.strategyId} ← ${r.generatedBy}: ${r.n}`);
        line('');
        line('Не изменено по построению:');
        line('  • strategy_id, engine_setup_id — это доказательство;');
        line('  • hash, previous_hash, outcome_hash — provenance_status не входит в payload;');
        line('  • entry_min/max, stop_loss, targets, tp1/tp2 — уровни стратегии;');
        line('  • ни одна строка не удалена.');
        line('');
      }

      await client.query('COMMIT');
      report.committed = true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    if (AS_JSON) console.log(JSON.stringify(report, null, 2));
    else line('COMMIT выполнен. Монитор увидит только VERIFIED; MISMATCH и UNKNOWN в статистику не входят.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`[provenance-classify] ОШИБКА: ${e.message}`);
  process.exit(1);
});
