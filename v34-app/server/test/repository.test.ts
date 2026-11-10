/**
 * База нового продукта: дедупликация сигналов и событий, фильтры, пагинация,
 * устройства, статусы сканов и символов. Данные переживают переоткрытие файла.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db';
import { SignalRepository, type NewSignalInput } from '../src/repository';
import { tempDb, type TempDb } from './helpers';

let created: TempDb[] = [];
afterEach(() => {
  for (const db of created) db.cleanup();
  created = [];
});

function input(over: Partial<NewSignalInput> = {}): NewSignalInput {
  return {
    id: 'sig-1',
    strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
    strategyVersion: '3.4',
    symbol: 'ASSETA/USDT',
    exchangeSymbol: 'ASSETAUSDT',
    timeframe: '1h',
    direction: 'LONG',
    setupOpenTime: Date.UTC(2024, 5, 1, 10),
    entryMin: 100,
    entryMax: 100.5,
    stopLoss: 98,
    tp1: 101,
    tp2: 103,
    riskRewardRatio: 1.5,
    dataSource: { exchange: 'Binance', isFallback: false },
    metadata: { confirmingFactors: [] },
    createdAt: '2024-06-01T11:00:00.000Z',
    ...over,
  };
}

describe('SignalRepository', () => {
  it('дедуплицирует сигнал по (стратегия, символ, ТФ, бар)', () => {
    const t = tempDb(); created.push(t);
    expect(t.repo.insertSignal(input())).toBe(true);
    // Другой id, тот же бар — БД не даёт создать дубль.
    expect(t.repo.insertSignal(input({ id: 'sig-2' }))).toBe(false);
    expect(t.repo.countSignals({})).toBe(1);
    expect(t.repo.getById('sig-1')?.status).toBe('ACTIVE');
  });

  it('событие пишется ровно один раз (PK signal_id + event_type)', () => {
    const t = tempDb(); created.push(t);
    t.repo.insertSignal(input());
    expect(t.repo.recordEvent('sig-1', 'NEW_SIGNAL', '2024-06-01T11:00:00.000Z')).toBe(true);
    expect(t.repo.recordEvent('sig-1', 'NEW_SIGNAL', '2024-06-01T11:00:00.000Z')).toBe(false);
    expect(t.repo.eventsOf('sig-1')).toHaveLength(1);
  });

  it('обновление жизненного цикла сохраняет уровни и исход', () => {
    const t = tempDb(); created.push(t);
    t.repo.insertSignal(input());
    t.repo.updateLifecycle('sig-1', {
      status: 'TARGET_REACHED', filledAt: '2024-06-01T12:00:00.000Z', fillPrice: 100.4,
      closedAt: '2024-06-01T15:00:00.000Z', closePrice: 103, closeReason: 'TP2',
      resultR: 1.6, netResultR: 1.2, pnlResultPct: 2.58, barsHeld: 3,
    }, '2024-06-01T15:00:01.000Z');
    const row = t.repo.getById('sig-1')!;
    expect(row.status).toBe('TARGET_REACHED');
    expect(row.fill_price).toBeCloseTo(100.4);
    expect(row.close_reason).toBe('TP2');
    expect(row.stop_loss).toBe(98); // уровни публикации не перезаписываются
    expect(row.result_r).toBeCloseTo(1.6);
  });

  it('фильтры, курсор и лимиты работают детерминированно', () => {
    const t = tempDb(); created.push(t);
    for (let i = 0; i < 5; i++) {
      t.repo.insertSignal(input({
        id: `sig-${i}`, setupOpenTime: Date.UTC(2024, 5, 1, i),
        createdAt: `2024-06-01T0${i}:00:00.000Z`,
        direction: i % 2 === 0 ? 'LONG' : 'SHORT',
        status: undefined,
      } as Partial<NewSignalInput>));
    }
    expect(t.repo.listSignals({ limit: 2 })).toHaveLength(2);
    const all = t.repo.listSignals({ limit: 10 });
    expect(all.map((r) => r.id)).toEqual(['sig-4', 'sig-3', 'sig-2', 'sig-1', 'sig-0']);
    expect(t.repo.listSignals({ direction: 'LONG' })).toHaveLength(3);
    expect(t.repo.listSignals({ symbol: 'ASSETAUSDT' })).toHaveLength(5);
    expect(t.repo.listSignals({ status: ['FILLED'] })).toHaveLength(0);

    const firstPage = t.repo.listSignals({ limit: 2 });
    const secondPage = t.repo.listSignals({
      limit: 2,
      cursor: { createdAt: firstPage[1]!.created_at, id: firstPage[1]!.id },
    });
    expect(secondPage.map((r) => r.id)).toEqual(['sig-2', 'sig-1']);
  });

  it('открытые сигналы символа — только ACTIVE/FILLED', () => {
    const t = tempDb(); created.push(t);
    t.repo.insertSignal(input({ id: 'a' }));
    t.repo.insertSignal(input({ id: 'b', setupOpenTime: Date.UTC(2024, 5, 1, 12) }));
    t.repo.insertSignal(input({ id: 'c', setupOpenTime: Date.UTC(2024, 5, 1, 13) }));
    t.repo.updateLifecycle('c', { status: 'INVALIDATED', closeReason: 'SL' }, '2024-06-01T14:00:00.000Z');
    expect(t.repo.openSignalsForSymbol('ASSETAUSDT').map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('устройства: регистрация, отключение, счётчики', () => {
    const t = tempDb(); created.push(t);
    t.repo.upsertDevice('test-token-aaaaaaaaaaaaaaaaaaaa', 'android', '2024-06-01T00:00:00.000Z');
    t.repo.upsertDevice('test-token-bbbbbbbbbbbbbbbbbbbb', 'android', '2024-06-01T00:00:00.000Z');
    expect(t.repo.countDevices()).toEqual({ enabled: 2, total: 2 });
    t.repo.disableDevice('test-token-bbbbbbbbbbbbbbbbbbbb');
    expect(t.repo.enabledDevices().map((d) => d.token)).toEqual(['test-token-aaaaaaaaaaaaaaaaaaaa']);
    // Повторная регистрация снова включает устройство.
    t.repo.upsertDevice('test-token-bbbbbbbbbbbbbbbbbbbb', 'android', '2024-06-02T00:00:00.000Z');
    expect(t.repo.countDevices()).toEqual({ enabled: 2, total: 2 });
  });

  it('устройства: устаревшие регистрации вычищаются, свежие остаются', () => {
    const t = tempDb(); created.push(t);
    t.repo.upsertDevice('test-token-old-aaaaaaaaaaaaaaaaa', 'android', '2024-01-01T00:00:00.000Z');
    t.repo.upsertDevice('test-token-new-bbbbbbbbbbbbbbbbbb', 'android', '2024-06-10T00:00:00.000Z');
    expect(t.repo.hasDevice('test-token-old-aaaaaaaaaaaaaaaaa')).toBe(true);

    const removed = t.repo.pruneDevices('2024-06-01T00:00:00.000Z');
    expect(removed).toBe(1);
    expect(t.repo.hasDevice('test-token-old-aaaaaaaaaaaaaaaaa')).toBe(false);
    expect(t.repo.hasDevice('test-token-new-bbbbbbbbbbbbbbbbbb')).toBe(true);
    expect(t.repo.countDevices()).toEqual({ enabled: 1, total: 1 });
  });

  it('скан-раны: последний успешный и статус', () => {
    const t = tempDb(); created.push(t);
    const id1 = t.repo.startScan('2024-06-01T00:00:00.000Z', 2);
    t.repo.finishScan(id1, { finishedAt: '2024-06-01T00:00:05.000Z', status: 'OK', symbolsOk: 2, signalsNew: 1, error: null });
    const id2 = t.repo.startScan('2024-06-01T00:01:00.000Z', 2);
    t.repo.finishScan(id2, { finishedAt: '2024-06-01T00:01:05.000Z', status: 'FAILED', symbolsOk: 0, signalsNew: 0, error: 'HTTP 451' });
    expect(t.repo.lastScan()?.status).toBe('FAILED');
    expect(t.repo.lastSuccessfulScanAt()).toBe('2024-06-01T00:00:05.000Z');
  });

  it('данные переживают переоткрытие файла БД', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-persist-'));
    const file = path.join(dir, 'db.sqlite');
    const db1 = openDatabase(file);
    const repo1 = new SignalRepository(db1);
    repo1.insertSignal(input());
    repo1.recordEvent('sig-1', 'NEW_SIGNAL', '2024-06-01T11:00:00.000Z');
    db1.close();

    const db2 = openDatabase(file);
    const repo2 = new SignalRepository(db2);
    expect(repo2.countSignals({})).toBe(1);
    expect(repo2.eventsOf('sig-1')).toHaveLength(1);
    // Повторная вставка после рестарта по-прежнему дедуплицируется.
    expect(repo2.insertSignal(input({ id: 'sig-9' }))).toBe(false);
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
