/**
 * LiveSignalEngine — runs archived strategy cores on LIVE candle data.
 *
 * V3.0 — HTF Liquidation Trap (validated, flagship)
 * V3.3 — HTF Zone Mitigation (4H swing zone + 1H wick rejection)
 * V2.8 — Sniper (liquidity sweep + impulse reclaim)
 *
 * ⚠️ SIGNALS ONLY — CRYPTORA does NOT execute trades.
 */

import type { MarketDataProvider } from '@/services/data/MarketDataProvider';
import type { Timeframe } from '@/types/market';
import type { ArchiveCandle } from '@/services/strategyArchive/types';
import { SignalsAuditLedger } from '@/services/signals/SignalsAuditLedger';
import { ohlcvToArchive } from '@/services/signals/live/ohlcvAdapter';
import {
  V30_CONSTANTS,
  confirmedLevels,
  detectTrap,
  buildPending,
} from '@/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core';
import { V33_CONSTANTS, bodyRatio as v33BodyRatio, rejectionWick } from '@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core';
import { atrAt, rvolAt, findSwingsV2 } from '@/services/strategyArchive/shared/primitives';
import { FROZEN_ENGINE } from '@/services/strategyArchive/shared/frozenSettings';

export type SignalStrategy = 'V3.0' | 'V3.3' | 'V2.8';

export interface LiveSignalConfig {
  provider: MarketDataProvider;
  symbols?: readonly string[];
  strategies?: SignalStrategy[];
}

interface SymbolState {
  lastCheckedBarTime: number;
}

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'];

function fmtPrice(p: number): number {
  return Number(p.toFixed(p > 100 ? 2 : p > 1 ? 4 : 6));
}

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
    this.strategies = config.strategies ?? ['V3.0', 'V3.3', 'V2.8'];
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

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.scan(), 60_000);
    setTimeout(() => this.scan(), 5_000);
  }

  public stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  public isActive(): boolean { return this.running; }

  private async scan(): Promise<void> {
    // Expire signals older than 4 hours
    this.ledger.expireStale();

    for (const symbol of this.symbols) {
      try { await this.scanSymbol(symbol); } catch { /* non-fatal */ }
    }
  }

  private async scanSymbol(symbol: string): Promise<void> {
    const [h1Raw, h4Raw] = await Promise.all([
      this.provider.getCandles(symbol, '1h' as Timeframe),
      this.provider.getCandles(symbol, '4h' as Timeframe),
    ]);

    if (h1Raw.length < V30_CONSTANTS.WARMUP_BARS) return;

    const h1 = h1Raw.map((c) => ohlcvToArchive(c, '1h'));
    const h4 = h4Raw.map((c) => ohlcvToArchive(c, '4h'));

    let symState = this.state.get(symbol);
    if (!symState) {
      symState = { lastCheckedBarTime: 0 };
      this.state.set(symbol, symState);
    }

    const lastBar = h1[h1.length - 1];
    if (!lastBar || lastBar.openTime === symState.lastCheckedBarTime) return;
    symState.lastCheckedBarTime = lastBar.openTime;

    const closedBars = h1.filter((c) => c.isClosed);
    if (closedBars.length < 2) return;
    const bar = closedBars[closedBars.length - 1];
    const barIndex = closedBars.length - 1;

    if (this.strategies.includes('V3.0')) this.runV30(symbol, bar, barIndex, closedBars, h4);
    if (this.strategies.includes('V3.3')) this.runV33(symbol, bar, barIndex, closedBars, h4);
    if (this.strategies.includes('V2.8')) this.runV28(symbol, bar, barIndex, closedBars);
  }

  /* ===== V3.0 — HTF Liquidation Trap ===== */

  private runV30(symbol: string, bar: ArchiveCandle, barIndex: number, h1: ArchiveCandle[], h4: ArchiveCandle[]): void {
    const strength = FROZEN_ENGINE.swingLookback;
    const atr = atrAt(h1, barIndex, FROZEN_ENGINE.atrPeriod);
    const rvol = rvolAt(h1, barIndex, FROZEN_ENGINE.volumePeriod);
    if (!atr || atr <= 0) return;

    const levels = confirmedLevels(h4, bar.closeTime, strength);
    if (levels.swingHigh === null || levels.swingLow === null) return;

    const trap = detectTrap(bar, levels as { swingHigh: number; swingLow: number }, rvol);
    if (!trap) return;

    const pending = buildPending(trap, bar, levels as { swingHigh: number; swingLow: number }, atr, barIndex);

    this.publish({
      id: `v30-${symbol}-${bar.openTime}`, strategy: 'V3.0', symbol, direction: pending.dir,
      entryLow: pending.zoneLow, entryHigh: pending.zoneHigh, stop: pending.stop,
      tp1: pending.tp1, tp2: pending.tp2,
      confirmingFactors: [
        `Ложный пробой 4H ${pending.dir === 'SHORT' ? 'максимума' : 'минимума'} (${trap.level.toFixed(2)})`,
        `Тело ${(trap.bodyRatio * 100).toFixed(1)}% (мин 35%)`,
        `RVOL ${trap.rvol.toFixed(2)}x (мин 1.25x)`,
      ],
      invalidationFactors: [
        'Ложный пробой не подтвердился',
        '⚠️ V3.0 (валидирована), не инвест-совет',
      ],
    });
  }

  /* ===== V3.3 — HTF Zone Mitigation ===== */

  private runV33(symbol: string, bar: ArchiveCandle, barIndex: number, h1: ArchiveCandle[], h4: ArchiveCandle[]): void {
    const atr = atrAt(h1, barIndex, FROZEN_ENGINE.atrPeriod);
    const rvol = rvolAt(h1, barIndex);
    if (!atr || atr <= 0 || rvol === null || !(rvol > V33_CONSTANTS.MIN_RVOL)) return;

    const br = v33BodyRatio(bar);
    if (br < V33_CONSTANTS.WICK_FRAC_MIN) return;

    // Find 4H swing zones
    const strength = FROZEN_ENGINE.swingLookback;
    const swings4 = findSwingsV2(h4, strength);
    if (swings4.length < 2) return;

    // Check each recent swing as a zone
    for (let i = swings4.length - 1; i >= Math.max(0, swings4.length - 4); i--) {
      const sw = swings4[i];
      if (!sw) continue;

      const zoneHalf = 0.5 * atr;
      const zoneLow = sw.price - zoneHalf;
      const zoneHigh = sw.price + zoneHalf;
      const dir = sw.kind === 'LOW' ? 'LONG' as const : 'SHORT' as const;

      // Does the bar enter this zone?
      if (bar.low > zoneHigh || bar.high < zoneLow) continue;

      // Wick rejection?
      const wick = rejectionWick(bar, dir);
      if (wick < V33_CONSTANTS.WICK_FRAC_MIN) continue;

      const entryMid = (zoneLow + zoneHigh) / 2;
      const half = V33_CONSTANTS.CORRIDOR_ATR_FRAC * atr;
      const stop = dir === 'LONG' ? bar.low - V33_CONSTANTS.STOP_BUFFER_ATR * atr : bar.high + V33_CONSTANTS.STOP_BUFFER_ATR * atr;
      const eq = (bar.high + bar.low) / 2;
      const tp1 = dir === 'LONG' ? eq + Math.abs(eq - entryMid) : eq - Math.abs(entryMid - eq);
      const risk = Math.abs(entryMid - stop);
      const tp2 = dir === 'LONG' ? entryMid + 2 * risk : entryMid - 2 * risk;

      this.publish({
        id: `v33-${symbol}-${bar.openTime}`, strategy: 'V3.3', symbol, direction: dir,
        entryLow: entryMid - half, entryHigh: entryMid + half, stop, tp1, tp2,
        confirmingFactors: [
          `4H зона (${sw.kind === 'LOW' ? 'спрос' : 'предложение'}) ${sw.price.toFixed(2)}`,
          `Отбой: тень ${(wick * 100).toFixed(1)}% (мин 35%)`,
          `RVOL ${rvol.toFixed(2)}x (мин 1.25x)`,
        ],
        invalidationFactors: [
          'Зона пробита',
          '⚠️ V3.3 (TRAIN ONLY), не инвест-совет',
        ],
      });
      return; // one signal per bar
    }
  }

  /* ===== V2.8 — Sniper (liquidity sweep + reclaim) ===== */

  private runV28(symbol: string, bar: ArchiveCandle, barIndex: number, h1: ArchiveCandle[]): void {
    const atr = atrAt(h1, barIndex, FROZEN_ENGINE.atrPeriod);
    const rvol = rvolAt(h1, barIndex);
    if (!atr || atr <= 0 || rvol === null || !(rvol > 1.2)) return;

    const range = bar.high - bar.low;
    if (!(range > 0)) return;
    const br = Math.abs(bar.close - bar.open) / range;
    if (br < 0.35) return;

    const strength = Math.min(5, Math.floor(barIndex / 4));
    if (strength < 2) return;
    const swings = findSwingsV2(h1.slice(0, barIndex), strength);
    if (swings.length < 2) return;

    const lastSwing = swings[swings.length - 1];
    if (!lastSwing) return;

    // Bullish: sweep below swing low, close back above
    if (lastSwing.kind === 'LOW' && bar.low < lastSwing.price && bar.close > lastSwing.price) {
      const entry = bar.close;
      const stop = bar.low - V30_CONSTANTS.STOP_BUFFER_ATR * atr;
      const risk = entry - stop;
      if (risk <= 0) return;

      this.publish({
        id: `v28-${symbol}-${bar.openTime}`, strategy: 'V2.8', symbol, direction: 'LONG',
        entryLow: entry - V33_CONSTANTS.CORRIDOR_ATR_FRAC * atr,
        entryHigh: entry + V33_CONSTANTS.CORRIDOR_ATR_FRAC * atr,
        stop, tp1: entry + risk, tp2: entry + 2 * risk,
        confirmingFactors: [
          `Свинг-лоу ${lastSwing.price.toFixed(2)} вынесен → выкуп`,
          `Тело ${(br * 100).toFixed(1)}% (мин 35%)`,
          `RVOL ${rvol.toFixed(2)}x (мин 1.2x)`,
        ],
        invalidationFactors: ['Выкуп не подтвердился', '⚠️ V2.8 (gross only), не инвест-совет'],
      });
      return;
    }

    // Bearish: sweep above swing high, close back below
    if (lastSwing.kind === 'HIGH' && bar.high > lastSwing.price && bar.close < lastSwing.price) {
      const entry = bar.close;
      const stop = bar.high + V30_CONSTANTS.STOP_BUFFER_ATR * atr;
      const risk = stop - entry;
      if (risk <= 0) return;

      this.publish({
        id: `v28-${symbol}-${bar.openTime}`, strategy: 'V2.8', symbol, direction: 'SHORT',
        entryLow: entry - V33_CONSTANTS.CORRIDOR_ATR_FRAC * atr,
        entryHigh: entry + V33_CONSTANTS.CORRIDOR_ATR_FRAC * atr,
        stop, tp1: entry - risk, tp2: entry - 2 * risk,
        confirmingFactors: [
          `Свинг-хай ${lastSwing.price.toFixed(2)} вынесен → откат`,
          `Тело ${(br * 100).toFixed(1)}% (мин 35%)`,
          `RVOL ${rvol.toFixed(2)}x (мин 1.2x)`,
        ],
        invalidationFactors: ['Откат не подтвердился', '⚠️ V2.8 (gross only), не инвест-совет'],
      });
    }
  }

  /* ===== Publish ===== */

  private publish(params: {
    id: string; strategy: string; symbol: string; direction: 'LONG' | 'SHORT';
    entryLow: number; entryHigh: number; stop: number; tp1: number; tp2: number;
    confirmingFactors: string[]; invalidationFactors: string[];
  }): void {
    const mid = (params.entryLow + params.entryHigh) / 2;
    const risk = Math.abs(mid - params.stop);
    const reward = Math.abs(params.tp2 - mid);

    this.ledger.append({
      id: params.id,
      symbol: `${params.symbol}/USDT`,
      direction: params.direction,
      timeframe: '1h',
      entryZone: [fmtPrice(params.entryLow), fmtPrice(params.entryHigh)],
      invalidationLevel: fmtPrice(params.stop),
      targets: [fmtPrice(params.tp1), fmtPrice(params.tp2)],
      riskRewardRatio: risk > 0 ? Number((reward / risk).toFixed(2)) : 0,
      confirmingFactors: params.confirmingFactors,
      invalidationFactors: params.invalidationFactors,
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    });
  }
}
