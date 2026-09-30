/**
 * CRYPTORA — контракт безопасности read-only аудита на НАСТОЯЩЕМ PostgreSQL.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ
 * ---------------
 * `scripts/audit-production-lifecycle.mjs` предназначен для запуска ЧЕЛОВЕКОМ
 * на боевом сервере. Единственная гарантия, которую он обязан дать, —
 * «после запуска в базе ничего не изменилось». Обещание в комментарии такой
 * гарантией не является, поэтому здесь поднимается настоящий PostgreSQL,
 * применяются настоящие миграции, кладутся строки сигналов, скрипт
 * запускается ОТДЕЛЬНЫМ ПРОЦЕССОМ ровно так, как его запустят на VPS, и
 * состояние базы сверяется до и после побайтово (через дамп строк).
 *
 * Рыночные данные отключены флагом `--noMarket`: в тестовой среде нет выхода
 * к публичным klines, а проверяется здесь не стратегическая математика
 * (её проверяют юнит-тесты жизненного цикла), а именно read-only-контракт,
 * отказоустойчивость и отсутствие утечки секретов в вывод.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startPgHarness, type PgHarness } from '../helpers/embeddedPgHarness';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/audit-production-lifecycle.mjs');

let harness: PgHarness | null = null;
let skipReason = '';

const APT_ID = 'bff009bb-4c98-4beb-8e50-aaa0d3adcf1e';
const SOL_SHORT_ID = '1bb7a4ad-2edb-4513-a06f-2857b1b4ceeb';

beforeAll(async () => {
  const res = await startPgHarness({ prefix: 'cryptora-audit-', app: false });
  if (!res.ok) {
    skipReason = res.skipReason;
    return;
  }
  harness = res.harness;

  const ins = async (row: Record<string, unknown>) => {
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    await harness!.q(
      `INSERT INTO signals (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
      Object.values(row)
    );
  };

  // APT: помечен FILLED, но без fill_price — заведомо невозможное состояние.
  await ins({
    id: APT_ID,
    strategy_id: 'V3_0_HTF_LIQUIDATION_TRAP',
    symbol: 'APT/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signal_candle_ts: '2026-09-28T12:00:00Z',
    entry_min: 0.79479,
    entry_max: 0.79861,
    stop_loss: 0.78043,
    tp1: 0.83525,
    tp2: 0.875,
    status: 'FILLED',
    hash: 'sha256-apt',
    previous_hash: 'GENESIS',
  });

  // SOL LONG — тот, чей id скрипт обязан НАЙТИ сам, а не угадать.
  await ins({
    strategy_id: 'V3_3_HTF_ZONE_MITIGATION',
    symbol: 'SOL/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signal_candle_ts: '2026-09-29T04:00:00Z',
    entry_min: 117.01,
    entry_max: 117.27,
    stop_loss: 115.66,
    tp1: 119.1,
    tp2: 124.95,
    status: 'FILLED',
    fill_price: 117.27,
    filled_at: '2026-09-29T05:00:00Z',
    hash: 'sha256-sol-long',
    previous_hash: 'sha256-apt',
  });

  // Ловушка: второй SOL LONG рядом по времени, но с чужими уровнями.
  await ins({
    strategy_id: 'V3_3_HTF_ZONE_MITIGATION',
    symbol: 'SOL/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signal_candle_ts: '2026-09-29T02:00:00Z',
    entry_min: 99.5,
    entry_max: 99.9,
    stop_loss: 97.0,
    tp1: 103.0,
    tp2: 110.0,
    status: 'EXPIRED',
    hash: 'sha256-sol-long-decoy',
    previous_hash: 'sha256-sol-long',
  });

  // SOL SHORT — встречная позиция, пересекающаяся с LONG по времени.
  await ins({
    id: SOL_SHORT_ID,
    strategy_id: 'V3_3_HTF_ZONE_MITIGATION',
    symbol: 'SOL/USDT',
    timeframe: '1h',
    direction: 'SHORT',
    signal_candle_ts: '2026-09-29T16:00:00Z',
    entry_min: 120.9,
    entry_max: 121.14,
    stop_loss: 123.6,
    tp1: 120.68,
    tp2: 119.82,
    status: 'FILLED',
    fill_price: 120.9,
    filled_at: '2026-09-29T17:00:00Z',
    hash: 'sha256-sol-short',
    previous_hash: 'sha256-sol-long-decoy',
  });
}, 180_000);

afterAll(async () => {
  if (harness) await harness.close();
});

/** Снимок всех пользовательских таблиц, по которым скрипт ходит. */
async function snapshot(h: PgHarness): Promise<string> {
  const signals = await h.q('SELECT * FROM signals ORDER BY hash');
  const state = await h.q('SELECT * FROM signal_monitor_state ORDER BY id');
  const settings = await h.q('SELECT * FROM strategy_settings ORDER BY strategy_id');
  return JSON.stringify({ signals, state, settings });
}

function runAudit(url: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--noMarket'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url },
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('scripts/audit-production-lifecycle.mjs — read-only контракт', () => {
  it('не изменяет базу и подтверждает read-only транзакцию', async () => {
    if (!harness) {
      console.warn(`SKIP: ${skipReason}`);
      return;
    }
    const before = await snapshot(harness);
    const { code, out } = runAudit(harness.url);

    expect(code, out.slice(-4000)).toBe(0);
    expect(out).toContain('transaction_read_only = on');
    expect(out).toContain('ROLLBACK');
    expect(out).toContain('PRODUCTION DB WRITES: 0');
    expect(out).toContain('PRODUCTION SIGNALS MODIFIED: NO');
    expect(out).toContain('SERVICE RESTARTED: NO');
    expect(out).toContain('DEPLOYED: NO');

    const after = await snapshot(harness);
    expect(after).toBe(before);
  }, 180_000);

  it('читает схему из information_schema, а не из предположений', async () => {
    if (!harness) return;
    const { out } = runAudit(harness.url);
    // Реальное имя колонки — close_reason; exit_reason в схеме нет.
    expect(out).toMatch(/signals: \d+ колонок/);
    expect(out).toContain('close_reason');
    expect(out).toMatch(/Отсутствуют[^\n]*exit_reason/);
    expect(out).toContain('signals_status_check');
  }, 180_000);

  it('находит SOL LONG по SELECT, а не по угаданному id', async () => {
    if (!harness) return;
    const { out } = runAudit(harness.url);
    const expected = (await harness.q(
      `SELECT id FROM signals WHERE symbol = 'SOL/USDT' AND direction = 'LONG' AND entry_min = 117.01`
    ))[0].id as string;
    expect(out).toContain(`ВЫБРАН по близости уровней: ${expected}`);
    // Ловушка с чужими уровнями не должна быть выбрана.
    expect(out).toMatch(/кандидатов: 2/);
  }, 180_000);

  it('сообщает о пересечении LONG/SHORT и об отсутствии политики встречных сигналов', async () => {
    if (!harness) return;
    const { out } = runAudit(harness.url);
    expect(out).toContain('SOL OVERLAP: YES');
    expect(out).toMatch(/LONG_SHORT_OVERLAP: [1-9]/);
    // Политика встречных сигналов ищется по ИСПОЛНЯЕМОМУ коду: описания
    // стратегий («TP2 = противоположный свинг») и SQL ON CONFLICT в шаблонных
    // строках не должны считаться политикой.
    expect(out).toContain('Исполняемых совпадений: 0');
    expect(out).toContain('OPPOSITE SIGNAL POLICY: НЕ РЕАЛИЗОВАНА');
  }, 180_000);

  it('ловит невозможный статус FILLED без fill_price', async () => {
    if (!harness) return;
    const { out } = runAudit(harness.url);
    expect(out).toContain('FILLED без fill_price');
    expect(out).toContain(APT_ID);
    // Ярлык UI берётся из настоящего src/utils/serverSignalText.ts установки:
    // «В позиции» — это подпись статуса FILLED, а не отдельное состояние.
    expect(out).toContain('бейдж «В ПОЗИЦИИ», подпись «В позиции»');
  }, 180_000);

  it('не печатает пароль подключения', async () => {
    if (!harness) return;
    const { out } = runAudit(harness.url);
    expect(out).not.toContain('cryptora:cryptora@');
    expect(out).toContain('***@127.0.0.1');
  }, 180_000);

  it('аварийно останавливается, если каталог не является установкой CRYPTORA', () => {
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [SCRIPT, '--root', '/tmp'], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/none' },
        timeout: 60_000,
      });
    } catch (e: any) {
      code = e.status ?? -1;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(code).not.toBe(0);
    expect(out).toContain('АВАРИЙНАЯ ОСТАНОВКА');
    expect(out).not.toContain('x:y@');
  }, 90_000);
});
