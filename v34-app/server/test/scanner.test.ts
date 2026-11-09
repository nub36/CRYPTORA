/**
 * Сканер: публикация по правилу CRYPTORA, ведение сигналов, дедупликация
 * событий, честные ошибки данных и корректная работа после перезапуска.
 *
 * Все данные — обезличенная синтетика (ASSETAUSDT). Никаких реальных цен.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db';
import { SignalRepository } from '../src/repository';
import { Scanner } from '../src/scanner';
import { StaticProvider, tempDb } from './helpers';
import { makeFixtures } from './fixtures';
import type { PushMessage, PushSender, PushState } from '../src/push/fcm';
import { runV34Scan, runV34LiveReplay, toClosedArchive, type OHLCV, type ReplayRecord } from '@v34/core';
import { toSignalView } from '../src/presentation';

const HOUR = 3_600_000;

class FakePush implements PushSender {
  readonly state: PushState = { enabled: true, configured: true, missing: [], reason: null, projectId: 'test' };
  sent: { token: string; message: PushMessage }[] = [];
  async send(token: string, message: PushMessage) {
    this.sent.push({ token, message });
    return { ok: true as const };
  }
}

function rowsToOhlcv(rows: readonly unknown[][]): OHLCV[] {
  return rows.map((r) => {
    const a = r as [number, string, string, string, string, string];
    return {
      time: Math.floor(Number(a[0]) / 1000),
      open: Number(a[1]), high: Number(a[2]), low: Number(a[3]), close: Number(a[4]), volume: Number(a[5]),
      provenance: { exchange: 'Binance', isFallback: false },
    };
  });
}

function clockOf(fx: ReturnType<typeof makeFixtures>) {
  return { now: fx.rows1h[0]![0] as number };
}

function harness(fx: ReturnType<typeof makeFixtures>, opts: { repo?: SignalRepository; push?: PushSender | null } = {}) {
  const clock = clockOf(fx);
  const provider = new StaticProvider({
    '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock.now,
  });
  const repo = opts.repo ?? tempDb().repo;
  const scanner = new Scanner({ provider, repo, symbols: [fx.symbol], push: opts.push ?? null, now: () => clock.now });
  return { clock, provider, repo, scanner };
}

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

describe('Scanner: публикация и ведение', () => {
  it('публикует ровно те сетапы, которые ядро разрешило на последнем закрытом баре', async () => {
    const fx = makeFixtures({ bars1h: 300, seed: 10 });
    const t = tempDb(); cleanups.push(t.cleanup);
    const { clock, repo, scanner } = harness(fx, { repo: t.repo });

    let publishedTotal = 0;
    let barsChecked = 0;
    for (let i = 100; i < fx.rows1h.length; i++) {
      const openTime = fx.rows1h[i]![0] as number;
      clock.now = openTime + HOUR;

      const before = repo.countSignals({});
      const summary = await scanner.scanAll();
      publishedTotal += summary.signalsPublished;
      barsChecked++;

      // Ожидаемое множество — из того же ядра, но собранное независимо.
      const closedRows = fx.rows1h.slice(0, i + 1);
      const expected = runV34Scan({
        symbol: fx.symbol,
        h1Raw: rowsToOhlcv(closedRows),
        h4Raw: rowsToOhlcv(fx.rows4h),
        nowMs: clock.now,
      }).publishable.map((r) => `${r.setupOpenTime}`);
      const added = repo.countSignals({}) - before;
      expect(added).toBe(new Set(expected).size);

      for (const row of repo.listSignals({ limit: 5 })) {
        expect(['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'])
          .toContain(row.status);
      }
    }

    expect(barsChecked).toBeGreaterThan(150);
    const all = repo.listSignals({ limit: 100 });
    expect(all.length).toBe(publishedTotal);
    for (const row of all) {
      expect(row.strategy_id).toBe('V3_4_HTF_ZONE_MITIGATION_QUALITY');
      expect(row.strategy_version).toBe('3.4');
      expect(row.timeframe).toBe('1h');
      expect(row.symbol).toBe('ASSETA/USDT');
      expect(row.entry_min).not.toBeNull();
      expect(row.entry_max).not.toBeNull();
      expect(row.stop_loss).not.toBeNull();
      // Стоп не подменяется ценой входа.
      expect(row.stop_loss).not.toBe(row.entry_min);
      expect(row.tp1).not.toBeNull();
      expect(row.tp2).not.toBeNull();
      expect(row.tp1! < row.tp2!).toBe(row.direction === 'LONG');
    }
  });

  it('повторный скан того же бара не создаёт дублей и не повторяет события', async () => {
    const fx = makeFixtures({ bars1h: 300, seed: 10 });
    const t = tempDb(); cleanups.push(t.cleanup);
    const { clock, scanner, repo } = harness(fx, { repo: t.repo });
    clock.now = (fx.rows1h[180]![0] as number) + HOUR;

    const first = await scanner.scanAll();
    const signalsAfterFirst = repo.countSignals({});
    const eventsAfterFirst = repo.listSignals({ limit: 100 }).reduce((n, r) => n + repo.eventsOf(r.id).length, 0);

    const second = await scanner.scanAll();
    expect(second.signalsPublished).toBe(0);
    expect(repo.countSignals({})).toBe(signalsAfterFirst);
    const eventsAfterSecond = repo.listSignals({ limit: 100 }).reduce((n, r) => n + repo.eventsOf(r.id).length, 0);
    expect(eventsAfterSecond).toBe(eventsAfterFirst);
    // Повторный скан одного и того же бара не «переигрывает» статусы.
    expect(first.symbols[0]!.ok).toBe(true);
    expect(first.symbols[0]!.dataError).toBeNull();
  });

  it('ведение опубликованного сигнала воспроизводит исход, который посчитало ядро', async () => {
    const fx = makeFixtures({ bars1h: 900, seed: 10 });
    const t = tempDb(); cleanups.push(t.cleanup);
    const push = new FakePush();
    t.repo.upsertDevice('device-token-aaaaaaaaaaaaaaaaaaaa', 'android', new Date(0).toISOString());

    // Окно закрытых 1H-баров и его полный реплей — источник уровней публикации.
    // Закрытые серии строятся тем же адаптером, что и на сервере (isClosed).
    const closed = toClosedArchive(rowsToOhlcv(fx.rows1h), '1h', fx.nowMs);
    const h4 = toClosedArchive(rowsToOhlcv(fx.rows4h), '4h', fx.nowMs);
    const replay = runV34LiveReplay({ symbol: fx.symbol, h1: closed, h4 });
    const withFill = replay.records.filter((r) => r.fill !== null);
    const resolved = withFill.filter((r) => r.outcome !== null && r.outcome.grossR !== null);
    expect(resolved.length).toBeGreaterThan(0);

    // Берём разрешённые сделки как «опубликованные» записи БД. Уровни —
    // ровно те, что вернуло ядро (никаких выдуманных значений).
    const picked: ReplayRecord[] = resolved.slice(0, 5);
    for (const rec of picked) {
      const inserted = t.repo.insertSignal({
        id: `manual-${rec.setupOpenTime}`,
        strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
        strategyVersion: '3.4',
        symbol: 'ASSETA/USDT',
        exchangeSymbol: fx.symbol,
        timeframe: '1h',
        direction: rec.direction,
        setupOpenTime: rec.setupOpenTime,
        entryMin: rec.entryZone[0], entryMax: rec.entryZone[1],
        stopLoss: rec.stop, tp1: rec.targets[0]!, tp2: rec.targets[1]!,
        riskRewardRatio: rec.riskRewardRatio,
        dataSource: { exchange: 'Binance', isFallback: false },
        metadata: {},
        createdAt: new Date(rec.setupOpenTime).toISOString(),
      });
      expect(inserted).toBe(true);
      // Публикация в реальном контуре всегда пишет NEW_SIGNAL; воспроизводим это
      // для сигналов, засеянных вручную из результатов ядра.
      t.repo.recordEvent(`manual-${rec.setupOpenTime}`, 'NEW_SIGNAL', new Date(rec.setupOpenTime).toISOString());
    }

    const clock = clockOf(fx);
    const scanner = new Scanner({
      provider: new StaticProvider({ '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock.now }),
      repo: t.repo, symbols: [fx.symbol], push, now: () => clock.now,
    });
    for (let i = 100; i < fx.rows1h.length; i++) {
      clock.now = (fx.rows1h[i]![0] as number) + HOUR;
      await scanner.scanAll();
    }

    // 1. Сервер пришёл к тому же исходу, что frozen-ядро.
    for (const rec of picked) {
      const row = t.repo.getById(`manual-${rec.setupOpenTime}`)!;
      expect(row.fill_price).not.toBeNull();
      expect(row.filled_at).not.toBeNull();
      expect(row.status).toBe(rec.outcome!.status);
      expect(row.close_reason).toBe(rec.outcome!.exitReason);
      expect(row.fill_price!).toBeCloseTo(rec.fill!.price, 8);
      expect(row.result_r!).toBeCloseTo(rec.outcome!.grossR!, 4);
      expect(row.close_price).not.toBeNull();
      const types = t.repo.eventsOf(row.id).map((e) => e.event_type);
      expect(types).toContain('NEW_SIGNAL');
      expect(types).toContain('FILL');
      expect(new Set(types).size).toBe(types.length);
    }

    // 2. Все сигналы БД: события согласованы со статусами, дублей нет.
    for (const signal of t.repo.listSignals({ limit: 100 })) {
      const events = t.repo.eventsOf(signal.id);
      const types = events.map((e) => e.event_type);
      expect(new Set(types).size).toBe(types.length);
      if (signal.status === 'FILLED' || signal.fill_price !== null) {
        expect(types).toContain('FILL');
      }
      if (['TARGET_REACHED', 'INVALIDATED', 'CLOSED'].includes(signal.status)) {
        expect(signal.closed_at).not.toBeNull();
        expect(signal.close_reason).not.toBeNull();
        expect(signal.result_r).not.toBeNull();
        expect(signal.fill_price).not.toBeNull();
      }
      if (signal.status === 'EXPIRED' || signal.status === 'CANCELLED') {
        expect(signal.fill_price).toBeNull();
        expect(signal.result_r).toBeNull();
        expect(types).toContain('CANCELLED');
      }
      if (types.includes('TP2')) expect(signal.status).toBe('TARGET_REACHED');
      if (types.includes('STOP_LOSS')) expect(signal.status).toBe('INVALIDATED');

      // Проекция для приложения: безубыток/действующий стоп — только по фактам.
      const view = toSignalView(
        signal,
        events,
        { stale: false, staleReason: null, now: new Date(clock.now).toISOString() },
        { id: 'V3_4_HTF_ZONE_MITIGATION_QUALITY', version: '3.4', name: 'x' },
      );
      if (view.progress.breakevenArmed) {
        expect(view.status).toBe('FILLED');
        expect(view.progress.currentStop).toBe(view.entry!.price);
      } else {
        expect(view.progress.currentStop).toBeNull();
      }
      if (!view.progress.tp1Hit) expect(view.progress.tp1HitAt).toBeNull();
    }

    // 3. Push: одно сообщение на событие и устройство, без повторов.
    // Засеянные вручную NEW_SIGNAL отправлены не были — это тестовый стенд,
    // а не публикация сканером.
    const totalEvents = t.repo.listSignals({ limit: 100 })
      .reduce((n, row) => n + t.repo.eventsOf(row.id).length, 0);
    expect(push.sent).toHaveLength(totalEvents - picked.length);
    expect(push.sent.every((m) => m.token === 'device-token-aaaaaaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('TP1 / безубыток появляются только тогда, когда их подтвердило ядро', async () => {
    const fx = makeFixtures({ bars1h: 900, seed: 10 });
    const t = tempDb(); cleanups.push(t.cleanup);
    // Закрытые серии строятся тем же адаптером, что и на сервере (isClosed).
    const closed = toClosedArchive(rowsToOhlcv(fx.rows1h), '1h', fx.nowMs);
    const h4 = toClosedArchive(rowsToOhlcv(fx.rows4h), '4h', fx.nowMs);
    const replay = runV34LiveReplay({ symbol: fx.symbol, h1: closed, h4 });
    // Сделка, которая дошла до TP1 и была закрыта по безубытку или таймауту.
    const tp1Trade = replay.records.find(
      (r) => r.fill !== null && ['TP1_THEN_BE', 'TP1_THEN_TIMEOUT', 'TP1_THEN_SL', 'TP2'].includes(r.outcome?.exitReason ?? ''),
    );
    expect(tp1Trade).toBeTruthy();

    t.repo.insertSignal({
      id: 'manual-tp1',
      strategyId: 'V3_4_HTF_ZONE_MITIGATION_QUALITY',
      strategyVersion: '3.4',
      symbol: 'ASSETA/USDT',
      exchangeSymbol: fx.symbol,
      timeframe: '1h',
      direction: tp1Trade!.direction,
      setupOpenTime: tp1Trade!.setupOpenTime,
      entryMin: tp1Trade!.entryZone[0], entryMax: tp1Trade!.entryZone[1],
      stopLoss: tp1Trade!.stop, tp1: tp1Trade!.targets[0]!, tp2: tp1Trade!.targets[1]!,
      riskRewardRatio: tp1Trade!.riskRewardRatio,
      dataSource: null,
      metadata: {},
      createdAt: new Date(tp1Trade!.setupOpenTime).toISOString(),
    });
    t.repo.recordEvent('manual-tp1', 'NEW_SIGNAL', new Date(tp1Trade!.setupOpenTime).toISOString());

    const clock = clockOf(fx);
    const scanner = new Scanner({
      provider: new StaticProvider({ '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock.now }),
      repo: t.repo, symbols: [fx.symbol], now: () => clock.now,
    });

    const tp1BarIndex = fx.rows1h.findIndex((r) => (r[0] as number) === tp1Trade!.setupOpenTime);
    let sawTp1WithoutFill = false;
    for (let i = tp1BarIndex + 1; i < fx.rows1h.length; i++) {
      clock.now = (fx.rows1h[i]![0] as number) + HOUR;
      await scanner.scanAll();
      const row = t.repo.getById('manual-tp1')!;
      const types = t.repo.eventsOf('manual-tp1').map((e) => e.event_type);
      // BREAKEVEN у ОТКРЫТОЙ позиции — armed-стоп; терминальный TP1_THEN_BE
      // тоже несёт BREAKEVEN, но читается из close_reason, а не из флага.
      if (types.includes('BREAKEVEN') && row.status === 'FILLED') {
        expect(t.repo.getById('manual-tp1')!.fill_price).not.toBeNull();
      }
      if (types.includes('TP1') && !types.includes('FILL')) sawTp1WithoutFill = true;
      if (row.status === tp1Trade!.outcome!.status) break;
    }
    expect(sawTp1WithoutFill).toBe(false);

    const row = t.repo.getById('manual-tp1')!;
    const types = t.repo.eventsOf('manual-tp1').map((e) => e.event_type);
    expect(types).toContain('TP1');
    expect(row.status).toBe(tp1Trade!.outcome!.status);
  });

  it('работа продолжается после перезапуска: данные и дедупликация на месте', async () => {
    const fx = makeFixtures({ bars1h: 300, seed: 10 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-restart-'));
    const file = path.join(dir, 'db.sqlite');

    const db1 = openDatabase(file);
    const repo1 = new SignalRepository(db1);
    const clock1 = clockOf(fx);
    const scanner1 = new Scanner({
      provider: new StaticProvider({ '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock1.now }),
      repo: repo1, symbols: [fx.symbol], now: () => clock1.now,
    });
    for (let i = 100; i < 200; i++) {
      clock1.now = (fx.rows1h[i]![0] as number) + HOUR;
      await scanner1.scanAll();
    }
    const signalsBefore = repo1.countSignals({});
    const eventsBefore = repo1.listSignals({ limit: 100 }).reduce((n, r) => n + repo1.eventsOf(r.id).length, 0);
    const lastScanBefore = repo1.lastScan();
    db1.close();

    const db2 = openDatabase(file);
    const repo2 = new SignalRepository(db2);
    const clock2 = clockOf(fx);
    const scanner2 = new Scanner({
      provider: new StaticProvider({ '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock2.now }),
      repo: repo2, symbols: [fx.symbol], now: () => clock2.now,
    });
    clock2.now = (fx.rows1h[199]![0] as number) + HOUR + 5 * 60_000;
    const summary = await scanner2.scanAll();

    expect(summary.signalsPublished).toBe(0);
    expect(repo2.countSignals({})).toBe(signalsBefore);
    const eventsAfter = repo2.listSignals({ limit: 100 }).reduce((n, r) => n + repo2.eventsOf(r.id).length, 0);
    expect(eventsAfter).toBe(eventsBefore);
    expect(repo2.lastScan()!.started_at > lastScanBefore!.started_at).toBe(true);
    expect(repo2.lastSuccessfulScanAt()).not.toBeNull();

    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ошибка биржи не превращается в «нет сигналов»', async () => {
    const fx = makeFixtures({ bars1h: 200, seed: 5 });
    const t = tempDb(); cleanups.push(t.cleanup);
    const clock = clockOf(fx);
    const failing = new StaticProvider(
      { '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock.now },
      new Error('HTTP 451 от биржи'),
    );
    const scanner = new Scanner({ provider: failing, repo: t.repo, symbols: [fx.symbol], now: () => clock.now });
    clock.now = fx.nowMs;

    const summary = await scanner.scanAll();
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain('451');
    expect(summary.symbolsOk).toBe(0);
    expect(t.repo.countSignals({})).toBe(0);
    expect(t.repo.lastScan()?.status).toBe('FAILED');
    const status = t.repo.symbolStatuses()[0];
    expect(status?.data_error).toContain('451');
  });

  it('недостаточное окно данных фиксируется в статусе символа, а не публикуется', async () => {
    const fx = makeFixtures({ bars1h: 40, seed: 5 });
    const t = tempDb(); cleanups.push(t.cleanup);
    const clock = clockOf(fx);
    const scanner = new Scanner({
      provider: new StaticProvider({ '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock.now }),
      repo: t.repo, symbols: [fx.symbol], now: () => clock.now,
    });
    clock.now = fx.nowMs;
    const summary = await scanner.scanAll();
    expect(summary.symbols[0]!.dataError).toContain('недостаточно');
    expect(t.repo.countSignals({})).toBe(0);
  });

  it('устаревшие данные помечаются в статусе символа', async () => {
    const fx = makeFixtures({ bars1h: 200, seed: 10 });
    const t = tempDb(); cleanups.push(t.cleanup);
    const clock = clockOf(fx);
    const scanner = new Scanner({
      provider: new StaticProvider({ '1h': fx.rows1h, '4h': fx.rows4h, symbol: fx.symbol, now: () => clock.now }),
      repo: t.repo, symbols: [fx.symbol], now: () => clock.now,
    });
    // «Сейчас» на 6 часов позже последнего закрытого бара: серия устарела.
    clock.now = fx.nowMs + 6 * HOUR;
    await scanner.scanAll();
    const status = t.repo.symbolStatuses()[0]!;
    const notes = JSON.parse(status.notes ?? '[]') as string[];
    expect(notes.join(' ')).toContain('устарел');
  });
});
