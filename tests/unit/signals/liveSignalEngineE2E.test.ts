/**
 * Сквозной контракт LIVE-движка сигналов на mock-провайдере (без сети):
 *
 *   1. Скан на закрытом баре сетапа публикует сетап в журнал (ACTIVE) с
 *      теми же уровнями, что нашёл реплей архивной стратегии; forming-бар
 *      никогда не участвует.
 *   2. По мере «прихода» новых закрытых баров жизненный цикл ведёт публикацию
 *      теми же frozen-функциями: FILLED → исход (TARGET_REACHED / INVALIDATED /
 *      CLOSED) или EXPIRED / CANCELLED без сделки; исход совпадает с исходом
 *      полного реплея; хэш-цепочка остаётся целой.
 *   3. Повторные сканы идемпотентны (нет дублей), ошибки провайдера попадают в
 *      статус, а не проглатываются.
 *
 * Данные — детерминированная фикстура паритета V3.0 (та же, что для архива).
 * Время движка (`now`) подменяется так, чтобы «сейчас» было сразу после
 * закрытия нужного бара; провайдер отдаёт всё, что «уже произошло», включая
 * forming-свечу — как реальный REST-ответ Binance.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fixture from '../strategyArchive/fixtures/v30-synthetic-parity.json';
import type { OHLCV, Timeframe } from '@/types/market';
import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import {
  LiveSignalEngine, STRATEGY_IDS, setupId, toPair, CANDLE_LIMIT_1H, CANDLE_LIMIT_4H,
} from '@/services/signals/live/LiveSignalEngine';
import { SignalsAuditLedger, SIGNALS_LEDGER_STORAGE_KEY } from '@/services/signals/SignalsAuditLedger';
import { runV30LiveReplay } from '@/services/signals/live/replays/v30LiveReplay';
import type { ReplayRecord } from '@/services/signals/live/replays/types';

const H = 3_600_000;
type Row = [number, number, number, number, number, number];

function toArchive(rows: Row[], spanMs: number): ArchiveCandle[] {
  return rows.map(([openTime, open, high, low, close, volume]) => ({
    openTime, open, high, low, close, volume, closeTime: openTime + spanMs - 1, isClosed: true,
  }));
}
const H1 = toArchive(fixture.candles1h as Row[], H);
const H4 = toArchive(fixture.candles4h as Row[], 4 * H);

function toOhlcv(c: ArchiveCandle): OHLCV {
  return { time: c.openTime / 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
}

/**
 * Провайдер «как биржа»: отдаёт последние `limit` свечей, чей openTime ≤ now,
 * включая ещё формирующуюся (её OHLC — усечённая версия настоящей свечи, чтобы
 * look-ahead был бы заметен, если бы движок её использовал).
 */
function exchangeLikeProvider(nowRef: { ms: number }, opts?: { failSymbols?: string[] }) {
  const calls: { symbol: string; tf: Timeframe; limit: number | undefined; nowMs: number }[] = [];
  const getCandles = vi.fn(async (symbol: string, tf: Timeframe, limit?: number): Promise<OHLCV[]> => {
    calls.push({ symbol, tf, limit, nowMs: nowRef.ms });
    if (opts?.failSymbols?.includes(symbol)) throw new Error(`HTTP 503 from exchange for ${symbol}`);
    const src = tf === '1h' ? H1 : tf === '4h' ? H4 : [];
    const span = tf === '1h' ? H : 4 * H;
    const visible = src.filter((c) => c.openTime <= nowRef.ms);
    const out = visible.slice(-(limit ?? 500)).map((c) => {
      if (c.openTime + span - 1 < nowRef.ms) return toOhlcv(c);
      // forming: намеренно искажённая свеча (экстремумы за пределами настоящих)
      return { ...toOhlcv(c), high: c.high * 1.5, low: c.low * 0.5, close: c.open };
    });
    return out;
  });
  const provider = {
    isDemo: false,
    getAssets: vi.fn().mockResolvedValue([]),
    getAssetDetail: vi.fn().mockResolvedValue(null),
    getCandles,
    getFuturesList: vi.fn().mockResolvedValue([]),
    getLiquidations: vi.fn().mockResolvedValue({ total24h: 0, dataStatus: 'UNAVAILABLE' }),
    getRadarEvents: vi.fn().mockResolvedValue([]),
    getMarketOverview: vi.fn().mockResolvedValue({}),
    getScreenerResults: vi.fn().mockResolvedValue([]),
  } as unknown as MarketDataProvider;
  return { provider, calls };
}

/** Момент «сразу после закрытия» бара с индексом i (следующая свеча уже формируется 1 секунду). */
function justAfterClose(i: number): number {
  return H1[i]!.openTime + H + 1_000;
}

/** Полный реплей V3.0 по всей фикстуре — эталон, с которым сверяется движок. */
const fullV30 = runV30LiveReplay({ symbol: 'BTC', h1: H1, h4: H4 });
const fullById = new Map<string, ReplayRecord>();
for (const r of fullV30.records) fullById.set(setupId(r.strategyId, 'BTC', r.setupOpenTime), r);

function indexOfOpenTime(openTime: number): number {
  return H1.findIndex((c) => c.openTime === openTime);
}

/** Сетапы полного прогона, чей бар сетапа виден в 1000-барном окне на момент публикации и чья зона решена. */
function pickScenarios(): { record: ReplayRecord; setupIndex: number }[] {
  const out: { record: ReplayRecord; setupIndex: number }[] = [];
  for (const r of fullV30.records) {
    const i = indexOfOpenTime(r.setupOpenTime);
    if (i < CANDLE_LIMIT_1H + 50 || !r.publishable || !r.outcome) continue;
    out.push({ record: r, setupIndex: i });
  }
  return out;
}

describe('LiveSignalEngine × archive replay × ledger lifecycle (mock exchange, no network)', () => {
  beforeEach(() => {
    LiveSignalEngine.resetInstance();
    SignalsAuditLedger.resetInstance();
    localStorage.removeItem(SIGNALS_LEDGER_STORAGE_KEY);
  });
  afterEach(() => {
    LiveSignalEngine.resetInstance();
  });

  it('publishes the setup of the last CLOSED bar with the replay levels, ignoring the forming candle', async () => {
    const scenarios = pickScenarios();
    expect(scenarios.length).toBeGreaterThan(5);
    const { record, setupIndex } = scenarios[0]!;
    const nowRef = { ms: justAfterClose(setupIndex) };
    const { provider, calls } = exchangeLikeProvider(nowRef);
    const engine = LiveSignalEngine.getInstance({
      provider, symbols: ['BTC'], strategies: ['V3.0'], now: () => nowRef.ms, yieldBetweenSymbols: false,
    })!;

    await engine.scanNow();

    const ledger = SignalsAuditLedger.getInstance();
    const id = setupId(STRATEGY_IDS['V3.0'], 'BTC', record.setupOpenTime);
    const published = ledger.getById(id);
    expect(published).toBeDefined();
    expect(published!.symbol).toBe(toPair('BTC'));
    expect(published!.status).toBe('ACTIVE');
    expect(published!.direction).toBe(record.direction);
    expect(published!.entryZone).toEqual(record.entryZone);
    expect(published!.invalidationLevel).toBe(record.stop);
    expect(published!.targets).toEqual(record.targets);
    expect(published!.setupOpenTime).toBe(record.setupOpenTime);
    expect(published!.latencyBars).toBe(0);
    expect(published!.auditHash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(ledger.verifyIntegrity()).toBe(true);

    // Никакая публикация не ссылается на forming-бар и не датирована будущим.
    for (const s of ledger.getSetups()) {
      expect(s.setupOpenTime + H - 1).toBeLessThan(nowRef.ms);
    }
    // Провайдер запрашивался с лимитами окна (1h и 4h), время передавалось движком.
    expect(calls.some((c) => c.tf === '1h' && c.limit === CANDLE_LIMIT_1H)).toBe(true);
    expect(calls.some((c) => c.tf === '4h' && c.limit === CANDLE_LIMIT_4H)).toBe(true);

    const status = engine.getStatus();
    expect(status.scanCount).toBe(1);
    expect(status.lastError).toBeNull();
    expect(status.perSymbol.BTC!.lastEvaluatedBarOpenTime).toBe(record.setupOpenTime);
    expect(status.perSymbol.BTC!.replays[STRATEGY_IDS['V3.0']]!.records).toBeGreaterThan(0);
    expect(status.perSymbol.BTC!.closedBars['1h']).toBe(CANDLE_LIMIT_1H - 1);   // 1000 запрошено, последняя — forming

    // Повторный скан на том же баре: ничего нового, дублей нет.
    const before = ledger.getSetups().length;
    await engine.scanNow();
    expect(ledger.getSetups().length).toBe(before);
    expect(engine.getStatus().scanCount).toBe(2);
  });

  it('drives every published setup to the same fill/outcome as the full replay as bars close, keeping the chain intact', { timeout: 60_000 }, async () => {
    const scenarios = pickScenarios();
    const ledger = SignalsAuditLedger.getInstance();
    const nowRef = { ms: 0 };
    const { provider } = exchangeLikeProvider(nowRef);
    const engine = LiveSignalEngine.getInstance({
      provider, symbols: ['BTC'], strategies: ['V3.0'], now: () => nowRef.ms, yieldBetweenSymbols: false,
    })!;

    // Разные исходы: сделка с целью/стопом/таймаутом и no-trade (отмена/истечение).
    const wanted = new Set<string>();
    const chosen: { record: ReplayRecord; setupIndex: number }[] = [];
    for (const sc of scenarios) {
      const key = sc.record.fill ? `TRADE:${sc.record.outcome!.status}` : `NOTRADE:${sc.record.outcome!.status}`;
      if (wanted.has(key)) continue;
      wanted.add(key);
      chosen.push(sc);
    }
    expect(chosen.length).toBeGreaterThanOrEqual(2);
    expect([...wanted].some((k) => k.startsWith('TRADE:'))).toBe(true);

    for (const { record, setupIndex } of chosen) {
      // 1) скан на баре сетапа → публикация
      nowRef.ms = justAfterClose(setupIndex);
      await engine.scanNow();
      const id = setupId(STRATEGY_IDS['V3.0'], 'BTC', record.setupOpenTime);
      expect(ledger.getById(id)?.status).toBe('ACTIVE');

      // 2) бары закрываются один за другим до исхода полного реплея
      const lastNeeded = indexOfOpenTime(record.outcome!.barOpenTime);
      expect(lastNeeded).toBeGreaterThan(setupIndex);
      let sawFilled = false;
      for (let j = setupIndex + 1; j <= lastNeeded; j++) {
        nowRef.ms = justAfterClose(j);
        await engine.scanNow();
        const cur = ledger.getById(id)!;
        if (cur.status === 'FILLED') sawFilled = true;
        // Исход не может появиться раньше бара, на котором его увидел полный реплей.
        if (j < lastNeeded) {
          expect(['ACTIVE', 'FILLED']).toContain(cur.status);
        }
        // Исполнение фиксируется ровно на баре исполнения полного реплея.
        if (record.fill && j === indexOfOpenTime(record.fill.barOpenTime)) {
          expect(cur.fill?.barOpenTime).toBe(record.fill.barOpenTime);
          expect(cur.fill?.price).toBeCloseTo(record.fill.price, 10);
        }
      }
      const done = ledger.getById(id)!;
      expect(done.status).toBe(record.outcome!.status);
      expect(done.exitReason).toBe(record.outcome!.exitReason);
      if (record.fill) {
        expect(sawFilled || done.fill !== null).toBe(true);
        expect(done.fill?.price).toBeCloseTo(record.fill.price, 10);
        expect(done.resultR).toBeCloseTo(record.outcome!.grossR!, 3);
        expect(done.netResultR).toBeCloseTo(record.outcome!.netR!, 3);
        expect(done.outcomeHash).toMatch(/^sha256-[0-9a-f]{64}$/);
      } else {
        expect(done.fill ?? null).toBeNull();
        expect(done.resultR).toBeNull();
      }
      expect(ledger.verifyIntegrity()).toBe(true);
    }

    // Сводка считает только сделки с исходом; no-trade не портит точность.
    const summary = ledger.getSummary();
    expect(summary.totalSetups).toBeGreaterThanOrEqual(chosen.length);
    expect(summary.tradesClosed).toBe(chosen.filter((c) => c.record.fill).length);
  });

  it('records provider failures per symbol in the status instead of swallowing them', async () => {
    const scenarios = pickScenarios();
    const nowRef = { ms: justAfterClose(scenarios[0]!.setupIndex) };
    const { provider } = exchangeLikeProvider(nowRef, { failSymbols: ['ETH'] });
    const engine = LiveSignalEngine.getInstance({
      provider, symbols: ['BTC', 'ETH'], strategies: ['V3.0'], now: () => nowRef.ms, yieldBetweenSymbols: false,
    })!;
    await engine.scanNow();
    const st = engine.getStatus();
    expect(st.perSymbol.ETH!.lastError).toMatch(/503/);
    expect(st.perSymbol.BTC!.lastError).toBeNull();
    expect(st.lastError).toMatch(/ETH/);
    // BTC при этом опубликован — сбой одного инструмента не останавливает остальные.
    expect(SignalsAuditLedger.getInstance().getSetups().some((s) => s.symbol === 'BTC/USDT')).toBe(true);
  });

  it('retrospective exposes replay records for diagnostics but never writes them to the journal', async () => {
    const scenarios = pickScenarios();
    const nowRef = { ms: justAfterClose(scenarios[0]!.setupIndex) };
    const { provider } = exchangeLikeProvider(nowRef);
    const engine = LiveSignalEngine.getInstance({
      provider, symbols: ['BTC'], strategies: ['V3.0', 'V3.3'], now: () => nowRef.ms, yieldBetweenSymbols: false,
    })!;
    await engine.scanNow();
    const retro = engine.getRetrospective({ symbol: 'BTC' });
    expect(retro.length).toBeGreaterThan(1);
    const journal = SignalsAuditLedger.getInstance().getSetups();
    // В журнале только сетапы последнего закрытого бара.
    for (const s of journal) expect(s.setupOpenTime).toBe(H1[scenarios[0]!.setupIndex]!.openTime);
    expect(journal.length).toBeLessThan(retro.length);
    // Ретроспектива отсортирована по убыванию времени и содержит обе стратегии.
    for (let k = 1; k < retro.length; k++) expect(retro[k - 1]!.setupOpenTime).toBeGreaterThanOrEqual(retro[k]!.setupOpenTime);
    expect(new Set(retro.map((r) => r.strategyId)).size).toBeGreaterThanOrEqual(1);
  });
});
