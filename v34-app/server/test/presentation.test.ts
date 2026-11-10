/**
 * Представление сигнала для приложения.
 *
 * Ключевые правила: отсутствующий уровень — null (никогда не подстановка),
 * исход — только по сохранённым данным, устаревание — с причиной.
 */
import { describe, it, expect } from 'vitest';
import { computeDataStatus, toSignalView } from '../src/presentation';
import type { SignalRow, EventRow } from '../src/repository';

const CTX = { stale: false, staleReason: null, now: '2024-06-01T12:00:00.000Z' };
const STRATEGY = { id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', version: '3.4', name: 'HTF Zone Mitigation + Target Quality' };

function row(over: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 'sig-1',
    strategy_id: STRATEGY.id,
    strategy_version: STRATEGY.version,
    symbol: 'ASSETA/USDT',
    exchange_symbol: 'ASSETAUSDT',
    timeframe: '1h',
    direction: 'LONG',
    setup_open_time: Date.UTC(2024, 5, 1, 10),
    entry_min: 100,
    entry_max: 100.5,
    stop_loss: 98,
    tp1: 101,
    tp2: 103,
    status: 'ACTIVE',
    created_at: '2024-06-01T11:00:00.000Z',
    updated_at: '2024-06-01T11:00:00.000Z',
    filled_at: null,
    fill_price: null,
    closed_at: null,
    close_price: null,
    close_reason: null,
    result_r: null,
    net_result_r: null,
    pnl_result_pct: null,
    bars_held: null,
    risk_reward_ratio: 1.5,
    data_source: JSON.stringify({ exchange: 'Binance', isFallback: false }),
    metadata: '{}',
    ...over,
  };
}

const event = (signal_id: string, event_type: EventRow['event_type'], occurred_at: string | null): EventRow => ({
  signal_id, event_type, occurred_at, created_at: occurred_at ?? '2024-06-01T11:00:00.000Z', detail: null,
});

describe('toSignalView', () => {
  it('активный сигнал: план без факта входа, стоп и цели из БД', () => {
    const view = toSignalView(row(), [event('sig-1', 'NEW_SIGNAL', '2024-06-01T11:00:00.000Z')], CTX, STRATEGY);
    expect(view.entryZone).toEqual({ low: 100, high: 100.5 });
    expect(view.entry).toBeNull();
    expect(view.initialStopLoss).toBe(98);
    expect(view.targets).toEqual([{ level: 1, price: 101 }, { level: 2, price: 103 }]);
    expect(view.outcome).toBeNull();
    expect(view.progress.currentStop).toBeNull();
    expect(view.statusAt).toBe('2024-06-01T11:00:00.000Z');
  });

  it('нет стопа в БД → null; цена входа не подставляется', () => {
    const view = toSignalView(row({ stop_loss: null }), [], CTX, STRATEGY);
    expect(view.initialStopLoss).toBeNull();
    expect(view.entry).toBeNull();
    expect(view.progress.currentStop).toBeNull();
  });

  it('одна цель в БД → одна цель в ответе', () => {
    const view = toSignalView(row({ tp2: null }), [], CTX, STRATEGY);
    expect(view.targets).toEqual([{ level: 1, price: 101 }]);
  });

  it('закрытая сделка отдаёт исход и время события', () => {
    const view = toSignalView(
      row({
        status: 'TARGET_REACHED', fill_price: 100.4, filled_at: '2024-06-01T12:00:00.000Z',
        closed_at: '2024-06-01T15:00:00.000Z', close_price: 103, close_reason: 'TP2',
        result_r: 1.6, net_result_r: 1.2, pnl_result_pct: 2.58, bars_held: 3,
      }),
      [event('sig-1', 'TP2', '2024-06-01T15:00:00.000Z')],
      CTX,
      STRATEGY,
    );
    expect(view.outcome).toEqual({
      status: 'TARGET_REACHED', exitReason: 'TP2', exitPrice: 103,
      resultR: 1.6, netResultR: 1.2, pnlResultPct: 2.58, barsHeld: 3,
    });
    expect(view.progress.tp1Hit).toBe(true);
    expect(view.progress.tp2Hit).toBe(true);
    expect(view.entry).toEqual({ price: 100.4, at: '2024-06-01T12:00:00.000Z' });
  });

  it('устаревание видно и в сигнале', () => {
    const view = toSignalView(row(), [], { stale: true, staleReason: 'последний успешный скан 12 мин назад', now: CTX.now }, STRATEGY);
    expect(view.stale).toBe(true);
    expect(view.staleReason).toContain('12 мин');
  });

  it('битые числа в БД не превращаются в NaN в JSON', () => {
    const view = toSignalView(row({ stop_loss: Number.NaN, tp2: Number.POSITIVE_INFINITY }), [], CTX, STRATEGY);
    expect(view.initialStopLoss).toBeNull();
    expect(view.targets).toEqual([{ level: 1, price: 101 }]);
    expect(JSON.parse(JSON.stringify(view))).toBeTruthy();
  });
});

describe('computeDataStatus', () => {
  const base = { scanStaleAfterMs: 180_000, nowMs: Date.UTC(2024, 5, 1, 12) };

  it('без сканов — unknown', () => {
    expect(computeDataStatus({ ...base, lastScan: null, lastSuccessfulScanAt: null, symbols: [] }).status).toBe('unknown');
  });

  it('свежий успешный скан — fresh', () => {
    const res = computeDataStatus({
      ...base,
      lastScan: { finished_at: new Date(base.nowMs - 10_000).toISOString(), started_at: '' },
      lastSuccessfulScanAt: new Date(base.nowMs - 10_000).toISOString(),
      symbols: [{ data_error: null }],
    });
    expect(res.status).toBe('fresh');
    expect(res.reason).toBeNull();
  });

  it('давно не было успеха — stale с причиной', () => {
    const res = computeDataStatus({
      ...base,
      lastScan: { finished_at: new Date(base.nowMs - 10_000).toISOString(), started_at: '' },
      lastSuccessfulScanAt: new Date(base.nowMs - 900_000).toISOString(),
      symbols: [{ data_error: null }],
    });
    expect(res.status).toBe('stale');
    expect(res.reason).toContain('мин назад');
  });

  it('все символы с ошибкой — error', () => {
    const res = computeDataStatus({
      ...base,
      lastScan: { finished_at: new Date(base.nowMs).toISOString(), started_at: '' },
      lastSuccessfulScanAt: new Date(base.nowMs - 900_000).toISOString(),
      symbols: [{ data_error: 'HTTP 451' }, { data_error: 'TIMEOUT' }],
    });
    expect(res.status).toBe('error');
  });
});
