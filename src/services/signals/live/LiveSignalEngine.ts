/**
 * LiveSignalEngine — runs archived strategy cores on LIVE candle data.
 *
 * Subscribes to 1H + 4H candles for the 6 canonical symbols.
 * On each new closed 1H bar, runs V3.0 / V3.3 / V2.8 detection.
 * Publishes matches to SignalsAuditLedger.
 *
 * ⚠️ SIGNALS ONLY — CRYPTORA does NOT execute trades.
 * Every setup includes disclaimers and invalidation factors.
 */

import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { Timeframe } from '@/types/market';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import type { AnalyticalSetup } from '@/services/signals/SignalsAuditLedger';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
import { ohlcvToArchive } from '@/services/signals/live/ohlcvAdapter';
import {
  V30_CONSTANTS,
  confirmedLevels,
  detectTrap,
  buildPending,
  type V30Pending,
} from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import { atrAt, rvolAt } from '@/services/strategyArchive/shared/primitives';
import { FROZEN_ENGINE } from '@/services/strategyArchive/shared/frozenSettings';

export type SignalStrategy = 'V3.0' | 'V3.3' | 'V2.8';

export interface LiveSignalConfig {
  provider: MarketDataProvider;
  symbols?: readonly string[];
  checkIntervalMs?: number;
  strategies?: SignalStrategy[];
}

interface SymbolState {
  lastCheckedBarTime: number;
  h1Candles: ArchiveCandle[];
  h4Candles: ArchiveCandle[];
  pendingV30: V30Pending | null;
  pendingSetupTime: number;
}

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'];

export class LiveSignalEngine {
  private static instance: LiveSignalEngine | null = null;

  private provider: MarketDataProvider;
  private symbols: readonly string[];
  private strategies: SignalStrategy[];
  private ledger: SignalsAuditLedger;
  private state = new Map<string, SymbolState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: LiveSignalConfig) {
    this.provider = config.provider;
    this.symbols = config.symbols ?? DEFAULT_SYMBOLS;
    this.strategies = config.strategies ?? ['V3.0'];
    this.ledger = SignalsAuditLedger.getInstance();
  }

  public static getInstance(config?: LiveSignalConfig): LiveSignalEngine | null {
    if (!LiveSignalEngine.instance && config) {
      LiveSignalEngine.instance = new LiveSignalEngine(config);
    }
    return LiveSignalEngine.instance;
  }

  public static resetInstance(): void {
    if (LiveSignalEngine.instance?.running) {
      LiveSignalEngine.instance.stop();
    }
    LiveSignalEngine.instance = null;
  }

  /** Start periodic signal scanning. */
  public start(): void {
    if (this.running) return;
    this.running = true;
    // Check every 60 seconds for new closed candles
    this.timer = setInterval(() => this.scan(), 60_000);
    // Initial scan after short delay (let provider initialize)
    setTimeout(() => this.scan(), 5_000);
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isActive(): boolean {
    return this.running;
  }

  /** Main scan: fetch candles for all symbols, run detection. */
  private async scan(): Promise<void> {
    for (const symbol of this.symbols) {
      try {
        await this.scanSymbol(symbol);
      } catch {
        // Non-fatal: skip symbol on error
      }
    }
  }

  private async scanSymbol(symbol: string): Promise<void> {
    // Fetch 1H and 4H candles
    const [h1Raw, h4Raw] = await Promise.all([
      this.provider.getCandles(symbol, '1h' as Timeframe),
      this.provider.getCandles(symbol, '4h' as Timeframe),
    ]);

    if (h1Raw.length < V30_CONSTANTS.WARMUP_BARS) return;

    const h1 = h1Raw.map((c) => ohlcvToArchive(c, '1h'));
    const h4 = h4Raw.map((c) => ohlcvToArchive(c, '4h'));

    // Get or create state
    let symState = this.state.get(symbol);
    if (!symState) {
      symState = { lastCheckedBarTime: 0, h1Candles: [], h4Candles: [], pendingV30: null, pendingSetupTime: 0 };
      this.state.set(symbol, symState);
    }

    // Check if we have a new closed bar
    const lastBar = h1[h1.length - 1];
    if (!lastBar || lastBar.openTime === symState.lastCheckedBarTime) return;
    symState.lastCheckedBarTime = lastBar.openTime;
    symState.h1Candles = h1;
    symState.h4Candles = h4;

    // Run V3.0 detection on the LATEST closed bar (second-to-last if last is forming)
    const closedBars = h1.filter((c) => c.isClosed);
    if (closedBars.length < 2) return;
    const checkBar = closedBars[closedBars.length - 1];
    const checkBarIndex = closedBars.length - 1;

    if (this.strategies.includes('V3.0')) {
      this.runV30(symbol, checkBar, checkBarIndex, closedBars, h4);
    }
  }

  /** V3.0 — HTF Liquidation Trap detection on latest closed 1H bar. */
  private runV30(
    symbol: string,
    bar: ArchiveCandle,
    barIndex: number,
    h1Candles: ArchiveCandle[],
    h4Candles: ArchiveCandle[],
  ): void {
    const symState = this.state.get(symbol)!;
    const strength = FROZEN_ENGINE.swingLookback;
    const atrPeriod = FROZEN_ENGINE.atrPeriod;
    const volPeriod = FROZEN_ENGINE.volumePeriod;

    // 1. Get confirmed 4H swing levels
    const levels = confirmedLevels(h4Candles, bar.closeTime, strength);
    if (levels.swingHigh === null || levels.swingLow === null) return;

    // 2. Calculate ATR and RVOL
    const atr = atrAt(h1Candles, barIndex, atrPeriod);
    const rvol = rvolAt(h1Candles, barIndex, volPeriod);
    if (!atr || atr <= 0) return;

    // 3. Detect trap
    const trap = detectTrap(bar, levels as { swingHigh: number; swingLow: number }, rvol);
    if (!trap) return;

    // 4. Build pending corridor
    const pending = buildPending(trap, bar, levels as { swingHigh: number; swingLow: number }, atr, barIndex);
    symState.pendingV30 = pending;
    symState.pendingSetupTime = Date.now();

    // 5. Publish signal to ledger
    const entryLow = pending.zoneLow;
    const entryHigh = pending.zoneHigh;
    const direction = pending.dir;

    const setup: Omit<AnalyticalSetup, 'auditHash'> = {
      id: `v30-live-${symbol}-${bar.openTime}`,
      symbol: `${symbol}/USDT`,
      direction,
      timeframe: '1h',
      entryZone: [
        Number(entryLow.toFixed(entryLow > 100 ? 2 : entryLow > 1 ? 4 : 6)),
        Number(entryHigh.toFixed(entryHigh > 100 ? 2 : entryHigh > 1 ? 4 : 6)),
      ],
      invalidationLevel: Number(pending.stop.toFixed(pending.stop > 100 ? 2 : pending.stop > 1 ? 4 : 6)),
      targets: [
        Number(pending.tp1.toFixed(pending.tp1 > 100 ? 2 : pending.tp1 > 1 ? 4 : 6)),
        Number(pending.tp2.toFixed(pending.tp2 > 100 ? 2 : pending.tp2 > 1 ? 4 : 6)),
      ],
      riskRewardRatio: Number((Math.abs(pending.tp2 - (entryLow + entryHigh) / 2) / Math.abs((entryLow + entryHigh) / 2 - pending.stop)).toFixed(2)),
      confirmingFactors: [
        `Ложный пробой 4H ${direction === 'SHORT' ? 'максимума' : 'минимума'} (${trap.level.toFixed(2)})`,
        `Тело свечи ${(trap.bodyRatio * 100).toFixed(1)}% (мин ${(V30_CONSTANTS.MIN_BODY_RATIO * 100)}%)`,
        `RVOL ${(trap.rvol).toFixed(2)}x (мин ${V30_CONSTANTS.MIN_RVOL}x)`,
        `ATR(14) = ${atr.toFixed(2)}`,
      ],
      invalidationFactors: [
        'Ложный пробой не подтвердился — цена закрепилась за уровнем',
        'Объём ниже порогового — возможен фейковый сигнал',
        'Риск: перекрытие с макро-событием (FOMC, CPI)',
        '⚠️ Сигнал из архивной стратегии, не инвест-совет',
      ],
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };

    this.ledger.append(setup);
  }
}
