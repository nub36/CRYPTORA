/**
 * CRYPTORA — READ-ONLY исследование конфликтов позиций (opposite / duplicate).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ КОНТРАКТ БЕЗОПАСНОСТИ                                                    ║
 * ║  • Скрипт НИЧЕГО не меняет: ни математики V3.0/V3.3/V3.4, ни констант,   ║
 * ║    ни БД, ни настроек, ни runtime. Он читает свечи с локального диска    ║
 * ║    и печатает отчёт (плюс опциональный --json).                          ║
 * ║  • Ни одна policy НЕ включается в продукте. Это счётная модель «что было ║
 * ║    бы», а не изменение поведения.                                        ║
 * ║  • Сделки берутся из штатных замороженных реплеев runV30LiveReplay /     ║
 * ║    runV33LiveReplay без hook'ов — то есть ровно из сегодняшней логики.   ║
 * ║  • Никакой сети и никакой БД.                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ПОЧЕМУ ЗДЕСЬ ЕСТЬ TRACER, ЕСЛИ «НЕ ПИСАТЬ ВТОРУЮ МАТЕМАТИКУ»
 * -----------------------------------------------------------
 * Политики C и D — контрфактические: они закрывают позицию в момент, которого
 * в замороженной `manageTrade` не существует. Получить такое от самой
 * `manageTrade` нельзя: она возвращает только финальный результат и не
 * сообщает, на каком баре был взят TP1.
 *
 * Поэтому здесь есть `traceTrade` — построчный обход тех же правил, который
 * дополнительно умеет закрывать позицию досрочно. Чтобы он не «уехал» от
 * стратегии, КАЖДАЯ сделка прогоняется через обе функции и результаты
 * сверяются (exit, grossR, netR, barsHeld, hitTp1, hitTp2). Любое расхождение
 * — аварийная остановка скрипта. Tracer не заменяет ядро, он доказуемо равен
 * ему на всём наборе данных и только расширяется досрочным закрытием.
 *
 * ГРАНИЦА МОДЕЛИ (важно для чтения цифр)
 * --------------------------------------
 * Политики применяются к УЖЕ СОСТОЯВШЕМУСЯ набору опубликованных сетапов:
 * они умеют убрать сделку и обрезать сделку, но НЕ умеют создать сетап,
 * которого замороженный реплей не породил. В реальности запрет публикации
 * освободил бы слот `pend` и мог бы породить другие сетапы — это потребовало
 * бы менять реплей, что прямо запрещено. Поэтому B/D/E показывают ВЕРХНЮЮ
 * границу «сколько мы теряем, отказываясь от сделок», а не полный контрфакт.
 *
 * Данные: закреплённый датасет исследования
 *   repo   https://github.com/nub36/svechnoy-suslik-binance-data
 *   commit c3c1dcecfe2784a147f591f2b5b4526cbf99df9f
 *
 * Запуск:
 *   node_modules/.bin/vite-node scripts/audit-signal-conflicts.mts -- --data /tmp/ds
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ArchiveCandle, ArchiveDirection } from '@/services/strategyArchive/types';
import { runV33LiveReplay } from '@/services/signals/live/replays/v33LiveReplay';
import { runV30LiveReplay } from '@/services/signals/live/replays/v30LiveReplay';
import {
  V33_ID, V30_ID, buildTrades, buildTradesFromDump, verifyTracer, stateAt, runPolicy, metricsOf,
  overlapsOf, maxConcurrent,
  type Trade, type PolicyId, type PolicyRun, type Metrics, type OverlapRec, type StateAt,
  type ProdDump,
} from './lib/conflictPolicies';

/* ─────────────────────────────────────────────────────────── аргументы ── */

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string | null = null): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
};
const DATA_DIR = arg('data', '/tmp/ds')!;
const JSON_OUT = arg('json');
const SYMBOLS = (arg('symbols', 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT')!).split(',');
const FOCUS = arg('focus', 'SOLUSDT')!;
/** Боевой режим: путь к READ-ONLY дампу продакшена вместо датасета. */
const PROD_DUMP = arg('prod');
const FOCUS_CASES = Number(arg('focusCases', '3'));

const LINES: string[] = [];
const out = (s = ''): void => { LINES.push(s); };
const hr = (t: string): void => { out(''); out('═'.repeat(100)); out(t); out('═'.repeat(100)); };
const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');
const f4 = (x: number | null): string => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(4));
const f2 = (x: number | null): string => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));

function die(msg: string): never {
  out('');
  out(`!!! АВАРИЙНАЯ ОСТАНОВКА: ${msg}`);
  process.stdout.write(LINES.join('\n') + '\n');
  process.exit(2);
}

/* ────────────────────────────────────────────────────── загрузка свечей ── */

function parseCsv(text: string, spanMs: number): ArchiveCandle[] {
  const res: ArchiveCandle[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split(',');
    if (f.length < 6) continue;
    let t = Number(f[0]);
    if (!Number.isFinite(t)) continue;
    if (t > 1e15) t = Math.floor(t / 1000);
    const open = Number(f[1]), high = Number(f[2]), low = Number(f[3]);
    const close = Number(f[4]), volume = Number(f[5]);
    if (![open, high, low, close, volume].every(Number.isFinite)) continue;
    res.push({ openTime: t, open, high, low, close, volume, closeTime: t + spanMs - 1, isClosed: true });
  }
  return res;
}

function loadSeries(symbol: string, tf: '1h' | '4h'): ArchiveCandle[] {
  const dir = path.join(DATA_DIR, symbol, tf);
  if (!fs.existsSync(dir)) throw new Error(`нет каталога данных: ${dir}`);
  const span = tf === '1h' ? 3_600_000 : 4 * 3_600_000;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  const seen = new Set<number>();
  const all: ArchiveCandle[] = [];
  for (const f of files) {
    const csv = execFileSync('unzip', ['-p', path.join(dir, f)], { maxBuffer: 1 << 28 }).toString('utf8');
    for (const c of parseCsv(csv, span)) {
      if (seen.has(c.openTime)) continue;
      seen.add(c.openTime);
      all.push(c);
    }
  }
  all.sort((a, b) => a.openTime - b.openTime);
  return all;
}

/* ══════════════════════════════════════════════════════════════ отчёт ══ */

hr('CRYPTORA — OPPOSITE SIGNAL / POSITION CONFLICT RESEARCH (READ-ONLY)');
out(`Запуск (UTC)        : ${new Date().toISOString()}`);
out(`Источник данных     : ${PROD_DUMP ? `боевой дамп ${PROD_DUMP}` : `${DATA_DIR} (закреплённый commit c3c1dce)`}`);
if (!PROD_DUMP) out(`Символы             : ${SYMBOLS.join(', ')}`);
out('Стратегии           : V3.3 HTF ZONE MITIGATION, V3.0 HTF LIQUIDATION TRAP');
out('Изменено в проде    : НИЧЕГО. Ни policy, ни математика, ни БД, ни настройки.');

const allTrades: Trade[] = [];
const perSymbolBars = new Map<string, ArchiveCandle[]>();

if (PROD_DUMP) {
  // Боевой режим: сделки берутся из READ-ONLY дампа, снятого
  // scripts/audit-production-lifecycle.mjs --dump. Датасет не читается.
  const dump = JSON.parse(fs.readFileSync(PROD_DUMP, 'utf8')) as ProdDump;
  const built = buildTradesFromDump(dump);
  allTrades.push(...built.trades);
  out('');
  out(`РЕЖИМ               : БОЕВОЙ ДАМП ${PROD_DUMP} (снят ${dump.generatedAt})`);
  out(`Строк в дампе       : ${dump.signals.length}`);
  out(`Сделок восстановлено: ${built.trades.length}`);
  out(`Пропущено           : ${built.skipped.length}`);
  for (const s of built.skipped.slice(0, 20)) out(`  • ${s}`);
  if (built.skipped.length > 20) out(`  … ещё ${built.skipped.length - 20}`);
}

for (const sym of PROD_DUMP ? [] : SYMBOLS) {
  let h1: ArchiveCandle[], h4: ArchiveCandle[];
  try {
    h1 = loadSeries(sym, '1h');
    h4 = loadSeries(sym, '4h');
  } catch (e) {
    out(`  ! ${sym}: ${(e as Error).message}`);
    continue;
  }
  perSymbolBars.set(sym, h1);
  const v33 = runV33LiveReplay({ symbol: sym, h1, h4 });
  const v30 = runV30LiveReplay({ symbol: sym, h1, h4 });
  allTrades.push(...buildTrades(sym, h1, v33.records, V33_ID));
  allTrades.push(...buildTrades(sym, h1, v30.records, V30_ID));
}
allTrades.sort((a, b) => a.publishedAt - b.publishedAt || a.fillTime - b.fillTime);

hr('1. ПРОВЕРКА TRACER ↔ ЗАМОРОЖЕННАЯ manageTrade');
const ver = verifyTracer(allTrades);
out(`Сделок проверено: ${ver.checked}`);
out(`Расхождений     : ${ver.mismatches.length}`);
if (ver.mismatches.length > 0) {
  for (const m of ver.mismatches.slice(0, 20)) out(`  ${m}`);
  die('tracer разошёлся с замороженной стратегией — цифры ниже недействительны');
}
out('Вывод: обход событий, на котором строятся контрфакты C и D, побитово');
out('воспроизводит исход замороженной стратегии на всех сделках выборки.');

/* ── 2. Конфликты в BASELINE ─────────────────────────────────────────── */

const baseline = runPolicy('A_BASELINE', allTrades);
const oppOverlaps = overlapsOf(baseline.applied, true);
const dupOverlaps = overlapsOf(baseline.applied, false);

hr('2. КОНФЛИКТЫ В ТЕКУЩЕМ ПОВЕДЕНИИ (BASELINE)');
out(`Всего сделок (исполнено и закрыто в окне данных): ${baseline.applied.length}`);
out(`LONG/SHORT overlaps (одна стратегия, один символ): ${oppOverlaps.length}`);
out(`SAME-DIRECTION duplicates                        : ${dupOverlaps.length}`);
out(`Максимум одновременно открытых позиций           : ${maxConcurrent(baseline.applied)}`);
out('');
const bySym = new Map<string, { opp: number; dup: number }>();
for (const o of oppOverlaps) {
  const k = `${o.strategyId} ${o.symbol}`;
  if (!bySym.has(k)) bySym.set(k, { opp: 0, dup: 0 });
  bySym.get(k)!.opp++;
}
for (const o of dupOverlaps) {
  const k = `${o.strategyId} ${o.symbol}`;
  if (!bySym.has(k)) bySym.set(k, { opp: 0, dup: 0 });
  bySym.get(k)!.dup++;
}
out('  стратегия / символ                          opposite   same-dir');
for (const [k, v] of [...bySym.entries()].sort((a, b) => b[1].opp - a[1].opp)) {
  out(`  ${k.padEnd(44)} ${String(v.opp).padStart(8)} ${String(v.dup).padStart(10)}`);
}

/* ── 3. Состояние первой сделки в момент появления второй ────────────── */

hr('3. СОСТОЯНИЕ ПЕРВОЙ СДЕЛКИ В МОМЕНТ ПОЯВЛЕНИЯ ВСТРЕЧНОЙ');
out('Момент отсчёта — ПУБЛИКАЦИЯ встречного сигнала (закрытие его бара сетапа).');
out('realized R и unrealized R считаются от исполнения первой сделки; unrealized');
out('берётся по close последнего закрытого бара до этого момента и взвешен');
out('оставшейся долей позиции.');
out('');
out('  # символ    стратегия  напр  состояние    размер           защита         real R   unreal R  след.цель');

interface StateRow { o: OverlapRec; st: StateAt | null }
const stateRows: StateRow[] = oppOverlaps.map((o) => ({ o, st: stateAt(o.first.trade, o.second.trade.publishedAt) }));
let idxRow = 0;
for (const { o, st } of stateRows) {
  idxRow++;
  if (idxRow > 40) { out(`  … ещё ${stateRows.length - 40} строк (полный список в --json)`); break; }
  const s = o.symbol.padEnd(9);
  const strat = (o.strategyId === V33_ID ? 'V3.3' : 'V3.0').padEnd(10);
  const dir = o.first.trade.direction.padEnd(5);
  if (!st) {
    out(`  ${String(idxRow).padStart(2)} ${s} ${strat} ${dir} ПЕРВАЯ УЖЕ ЗАКРЫТА на момент публикации встречной (пересечение только по исполнению)`);
    continue;
  }
  out(`  ${String(idxRow).padStart(2)} ${s} ${strat} ${dir} ${st.state.padEnd(12)} ${st.size.padEnd(16)} ${st.protection.padEnd(14)} ${f4(st.realizedR).padStart(7)} ${f4(st.unrealizedR).padStart(10)} ${f2(st.nextTarget).padStart(10)}`);
}
out('');
const cntBefore = stateRows.filter((r) => r.st?.state === 'BEFORE_TP1').length;
const cntAfter = stateRows.filter((r) => r.st?.state === 'AFTER_TP1').length;
const cntBe = stateRows.filter((r) => r.st?.protection === 'PROTECTED_BE').length;
const cntClosed = stateRows.filter((r) => r.st === null).length;
out(`ИТОГО по состояниям: BEFORE_TP1 ${cntBefore} · AFTER_TP1 ${cntAfter} · из них PROTECTED_BE ${cntBe} · первая уже закрыта ${cntClosed}`);
out(`OPEN_FULL ${stateRows.filter((r) => r.st?.size === 'OPEN_FULL').length} · OPEN_REMAINDER ${stateRows.filter((r) => r.st?.size === 'OPEN_REMAINDER').length}`);
const sumReal = stateRows.reduce((s, r) => s + (r.st?.realizedR ?? 0), 0);
const sumUnreal = stateRows.reduce((s, r) => s + (r.st?.unrealizedR ?? 0), 0);
out(`Σ REALIZED_R на момент встречных сигналов: ${f4(sumReal)} · Σ UNREALIZED_R: ${f4(sumUnreal)}`);

/* ── 4. Сравнение политик ────────────────────────────────────────────── */

hr('4. СРАВНЕНИЕ ПОЛИТИК');
out('A_BASELINE                 — сегодняшнее поведение: позиции независимы.');
out('B_BLOCK_OPPOSITE           — пока первая открыта, встречная не публикуется.');
out('C_EXIT_ON_OPPOSITE         — встречная подтверждена (исполнилась) ⇒ закрыть первую по её цене входа, затем открыть встречную.');
out('D_EXIT_REMAINDER_AFTER_TP1 — если первая уже взяла TP1, закрыть ОСТАТОК по цене встречной и разрешить разворот;');
out('                             если TP1 не взят — встречная не применяется (отдельная статистика ниже).');
out('E_SAME_DIRECTION_DEDUP     — при открытой позиции strategy+symbol+direction новая не создаётся.');
out('BE_COMBINED                — B и E вместе (справочно, отдельно не запрашивалась).');
out('');

const POLICIES: PolicyId[] = ['A_BASELINE', 'B_BLOCK_OPPOSITE', 'C_EXIT_ON_OPPOSITE', 'D_EXIT_REMAINDER_AFTER_TP1', 'E_SAME_DIRECTION_DEDUP', 'BE_COMBINED'];
const runs = new Map<PolicyId, PolicyRun>();
const mets = new Map<PolicyId, Metrics>();
for (const p of POLICIES) {
  const r = p === 'A_BASELINE' ? baseline : runPolicy(p, allTrades);
  runs.set(p, r);
  mets.set(p, metricsOf(r));
}

const cols: [string, (m: Metrics) => string][] = [
  ['trades', (m) => String(m.trades)],
  ['net R', (m) => f2(m.netR)],
  ['avg R', (m) => f4(m.avgR)],
  ['expectancy', (m) => f4(m.expectancy)],
  ['win %', (m) => (m.winRate * 100).toFixed(1)],
  ['TP1', (m) => String(m.tp1)],
  ['TP2', (m) => String(m.tp2)],
  ['SL', (m) => String(m.sl)],
  ['TP1→SL', (m) => String(m.tp1ThenSl)],
  ['TP1→BE', (m) => String(m.tp1ThenBe)],
  ['timeout', (m) => String(m.timeout)],
  ['обрезано', (m) => String(m.truncated)],
  ['maxConc', (m) => String(m.maxConcurrent)],
  ['opp ovl', (m) => String(m.oppositeOverlaps)],
  ['same dup', (m) => String(m.sameDirDuplicates)],
  ['отклонено', (m) => String(m.rejected)],
];

out(`  ${'policy'.padEnd(28)}${cols.map(([h]) => h.padStart(11)).join('')}`);
for (const p of POLICIES) {
  const m = mets.get(p)!;
  out(`  ${p.padEnd(28)}${cols.map(([, f]) => f(m).padStart(11)).join('')}`);
}
out('');
const base = mets.get('A_BASELINE')!;
out('Дельта к BASELINE (net R):');
for (const p of POLICIES) {
  if (p === 'A_BASELINE') continue;
  const m = mets.get(p)!;
  out(`  ${p.padEnd(28)} ${(m.netR - base.netR >= 0 ? '+' : '')}${f2(m.netR - base.netR)} R   (сделок ${m.trades - base.trades >= 0 ? '+' : ''}${m.trades - base.trades})`);
}

/* ── 4a. Отдельная статистика по D ───────────────────────────────────── */

const dRun = runs.get('D_EXIT_REMAINDER_AFTER_TP1')!;
out('');
out('D — отдельная статистика по случаю «TP1 ещё НЕ достигнут» (встречная не применялась автоматически):');
out(`  таких встречных сигналов: ${dRun.deferred.length}`);
if (dRun.deferred.length > 0) {
  const ur = dRun.deferred.map((d) => d.unrealizedR);
  const avg = ur.reduce((s, x) => s + x, 0) / ur.length;
  const neg = ur.filter((x) => x < 0).length;
  out(`  unrealized R первой сделки в этот момент: среднее ${f4(avg)}, минимум ${f4(Math.min(...ur))}, максимум ${f4(Math.max(...ur))}`);
  out(`  из них первая была в минусе: ${neg} (${((neg / ur.length) * 100).toFixed(1)} %)`);
  out('  Это ровно та группа, где «разворот» выглядит соблазнительно, но правило D его запрещает.');
  const upto = dRun.deferred.slice(0, 12);
  for (const d of upto) out(`    ${d.id}  заблокирована сделкой ${d.by}  unrealized ${f4(d.unrealizedR)} R`);
  if (dRun.deferred.length > upto.length) out(`    … ещё ${dRun.deferred.length - upto.length}`);
}

/* ── 5. Candle-by-candle доказательство ──────────────────────────────── */

hr(`5. CANDLE-BY-CANDLE ДОКАЗАТЕЛЬСТВО — ${FOCUS}`);
const focusSym = FOCUS;
const focusOverlaps = oppOverlaps.filter((o) => o.symbol.startsWith(focusSym.replace('USDT', '')) || o.symbol === focusSym);
out(`Найдено встречных пересечений по ${focusSym}: ${focusOverlaps.length}`);
if (focusOverlaps.length === 0) out('  нет случаев для разбора');

for (const o of focusOverlaps.slice(0, FOCUS_CASES)) {
  const A1 = o.first, B1 = o.second;
  const t = A1.trade, u = B1.trade;
  out('');
  out('─'.repeat(100));
  out(`СЛУЧАЙ: ${o.strategyId} ${o.symbol} — ${t.direction} → встречный ${u.direction}`);
  out('─'.repeat(100));
  out(`Первая  : сетап ${iso(t.setupOpenTime)}  публикация ${iso(t.publishedAt)}`);
  out(`          вход ${f2(t.fillPrice)} @ ${iso(t.fillTime)}  стоп ${f2(t.stop)}  TP1 ${f2(t.tp1)}  TP2 ${f2(t.tp2)}`);
  out(`          BASELINE исход: ${t.base.exit} @ ${iso(t.bars[t.base.exitBar]!.openTime)} по ${f2(t.base.exitPrice)}  gross ${f4(t.base.grossR)}  net ${f4(t.base.netR)}`);
  out(`Встречная: сетап ${iso(u.setupOpenTime)}  публикация ${iso(u.publishedAt)}`);
  out(`          вход ${f2(u.fillPrice)} @ ${iso(u.fillTime)}  стоп ${f2(u.stop)}  TP1 ${f2(u.tp1)}  TP2 ${f2(u.tp2)}`);
  out(`          BASELINE исход: ${u.base.exit} @ ${iso(u.bars[u.base.exitBar]!.openTime)} по ${f2(u.base.exitPrice)}  gross ${f4(u.base.grossR)}  net ${f4(u.base.netR)}`);
  out(`Пересечение позиций: ${iso(o.from)} … ${iso(o.to)}  (${o.hours.toFixed(2)} ч)`);

  const st = stateAt(t, u.publishedAt);
  out('');
  out('Состояние первой на момент публикации встречной:');
  if (!st) out('  первая уже закрыта');
  else {
    out(`  ${st.state} · ${st.size} · ${st.protection}`);
    out(`  realized R ${f4(st.realizedR)} · unrealized R ${f4(st.unrealizedR)} · следующая цель ${f2(st.nextTarget)}`);
  }

  out('');
  out('Свечи первой сделки от входа до выхода (1H, закрытые):');
  out('   #  openTime(UTC)          open      high      low       close     событие');
  const last = Math.min(t.base.exitBar, t.bars.length - 1);
  for (let i = 0; i <= last; i++) {
    const c = t.bars[i]!;
    const marks: string[] = [];
    if (i === 0) marks.push(`ВХОД ${f2(t.fillPrice)}`);
    if (i === t.base.tp1Bar) marks.push(`TP1 ${f2(t.tp1)} — закрыто 50 %`);
    if (t.base.tp1Bar >= 0 && i === t.base.tp1Bar + 1) marks.push('стоп переведён в безубыток');
    const uFillBar = u.fillTime === c.openTime;
    if (c.openTime === u.publishedAt - (c.closeTime - c.openTime)) marks.push('ПУБЛИКАЦИЯ встречного сигнала');
    if (uFillBar) marks.push(`ИСПОЛНЕНИЕ встречной по ${f2(u.fillPrice)}`);
    if (i === t.base.exitBar) marks.push(`ВЫХОД ${t.base.exit} по ${f2(t.base.exitPrice)}`);
    out(`  ${String(i).padStart(3)}  ${iso(c.openTime).padEnd(21)} ${f2(c.open).padStart(9)} ${f2(c.high).padStart(9)} ${f2(c.low).padStart(9)} ${f2(c.close).padStart(9)}  ${marks.join(' · ')}`);
  }

  out('');
  out('Что делает каждая политика с этой парой:');
  for (const p of POLICIES) {
    const r = runs.get(p)!;
    const aFirst = r.applied.find((x) => x.trade.id === t.id);
    const aSecond = r.applied.find((x) => x.trade.id === u.id);
    const rejSecond = r.rejected.find((x) => x.id === u.id);
    const parts: string[] = [];
    if (aFirst) {
      parts.push(`первая: ${aFirst.result.exit} net ${f4(aFirst.result.netR)}${aFirst.truncatedBy ? ' (обрезана встречной)' : ''}`);
    } else parts.push('первая: не открыта');
    if (aSecond) parts.push(`встречная: ${aSecond.result.exit} net ${f4(aSecond.result.netR)}`);
    else if (rejSecond) parts.push(`встречная: ОТКЛОНЕНА (${rejSecond.reason})`);
    else parts.push('встречная: не открыта');
    const sum = (aFirst?.result.netR ?? 0) + (aSecond?.result.netR ?? 0);
    out(`  ${p.padEnd(28)} ${parts.join(' · ')} → сумма ${f4(sum)} R`);
  }
}

/* ── 6. Итог ─────────────────────────────────────────────────────────── */

hr('6. ИТОГ');
out('Победитель НЕ выбран — это сравнительный отчёт, решение за человеком.');
out('');
out('Что зафиксировано фактами:');
out(`  • tracer, на котором построены контрфакты, сверен с замороженной manageTrade на ${ver.checked} сделках: расхождений 0;`);
out(`  • в сегодняшнем поведении на этом датасете ${oppOverlaps.length} встречных пересечений и ${dupOverlaps.length} однонаправленных дублей;`);
out(`  • состояние первой сделки в момент встречного сигнала: BEFORE_TP1 ${cntBefore}, AFTER_TP1 ${cntAfter} (из них под безубытком ${cntBe});`);
out('  • ни одна policy не включена в runtime; математика стратегий не тронута.');
out('');
out('Ограничение модели, которое нельзя игнорировать при чтении таблицы:');
out('  политики умеют убрать и обрезать сделку, но не умеют породить сетап, которого');
out('  замороженный реплей не создавал. Реальный запрет публикации освободил бы слот');
out('  ожидания и мог бы дать другие сетапы. Поэтому B/D/E — это оценка стоимости');
out('  отказа от сделок, а не полный контрфакт.');
out('');
out('PRODUCTION CHANGED: NO');
out('RUNTIME POLICY APPLIED: NO');
out('STRATEGY MATH CHANGED: NO');
out('DB WRITES: 0');

/* ── вывод ───────────────────────────────────────────────────────────── */

process.stdout.write(LINES.join('\n') + '\n');

if (JSON_OUT) {
  const payload = {
    generatedAt: new Date().toISOString(),
    dataset: DATA_DIR,
    symbols: SYMBOLS,
    tracerVerification: { checked: ver.checked, mismatches: ver.mismatches.length },
    baseline: {
      trades: baseline.applied.length,
      oppositeOverlaps: oppOverlaps.length,
      sameDirectionDuplicates: dupOverlaps.length,
    },
    overlapStates: stateRows.map(({ o, st }) => ({
      strategyId: o.strategyId, symbol: o.symbol,
      firstId: o.first.trade.id, secondId: o.second.trade.id,
      firstDirection: o.first.trade.direction,
      overlapFrom: iso(o.from), overlapTo: iso(o.to), overlapHours: Math.round(o.hours * 100) / 100,
      secondPublishedAt: iso(o.second.trade.publishedAt),
      state: st?.state ?? 'FIRST_ALREADY_CLOSED',
      size: st?.size ?? null,
      protection: st?.protection ?? null,
      realizedR: st ? Math.round(st.realizedR * 1e4) / 1e4 : null,
      unrealizedR: st ? Math.round(st.unrealizedR * 1e4) / 1e4 : null,
      nextTarget: st?.nextTarget ?? null,
    })),
    policies: POLICIES.map((p) => ({ policy: p, ...mets.get(p)! })),
    deferredUnderD: dRun.deferred,
  };
  // Компактный JSON: это сырьё исследования на 2000+ пересечений, отступы
  // раздували бы файл вдвое без пользы для чтения.
  fs.writeFileSync(JSON_OUT, JSON.stringify(payload));
  process.stdout.write(`\nJSON: ${JSON_OUT}\n`);
}
