import { FuturesAsset, LiquidationData, LiquidationEvent } from '@/types/market';

/**
 * Источник данных о ликвидациях по активу.
 * Жёсткое различие между фактом, демонстрационным набором и моделью.
 */
export type AssetLiquidationSource = 'FACTUAL' | 'DEMO' | 'ESTIMATED' | 'UNAVAILABLE';

export interface AssetLiquidationPulse {
  source: AssetLiquidationSource;
  longUsd: number;
  shortUsd: number;
  totalUsd: number;
  /** Доля лонгов в общем объеме ликвидаций, % (0 при отсутствии данных). */
  longSharePct: number;
  shortSharePct: number;
  /** Наиболее значимые события по активу (по убыванию объема). */
  topEvents: LiquidationEvent[];
  /** Пояснение для UI, когда фактических событий нет. */
  note: string | null;
}

export type ImbalanceBias = 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'BALANCED';

export interface AssetImbalance {
  /** Композитный балл в диапазоне −100…+100: > 0 — давление вверх. */
  score: number;
  bias: ImbalanceBias;
  label: string;
  /** Разложение балла по компонентам — для прозрачности расчета. */
  components: {
    liquidation: number;
    funding: number;
    openInterest: number;
    price: number;
  };
  /** Есть ли в основе демонстрационные входные метрики. */
  basedOnDemo: boolean;
}

export interface AssetPulse {
  symbol: string;
  liquidation: AssetLiquidationPulse;
  imbalance: AssetImbalance | null;
  derivatives: {
    openInterestUsd: number;
    openInterestChange1h: number;
    openInterestChange24h: number;
    fundingRate8h: number;
    annualizedFundingRate: number;
    basisPct: number;
    futuresVolume24h: number;
    markPrice: number;
    indexPrice: number;
    isDemo: boolean;
  } | null;
}

export interface BuildAssetPulseInput {
  symbol: string; // канонический символ без пары, например 'ETH'
  liquidations: LiquidationData | null;
  futures: FuturesAsset | null;
  priceChange24h: number;
  topEventsLimit?: number;
}

/**
 * LiquidationPulse — доменная сборка компактного среза «ликвидации + деривативы»
 * по одному активу для рабочей области Coin Detail.
 *
 * Инварианты (RULES §1, §3; AGENTS §3.1):
 *  1. Никаких синтетических или случайных значений: используются только данные,
 *     полученные от провайдера (фактический поток либо явно демонстрационный набор).
 *  2. Приоритет фактических данных: если в конвейере есть фактические события по
 *     активу — они и только они формируют цифры, со статусом `FACTUAL`.
 *  3. Если фактических событий нет, но есть модельная оценка движка деривативов —
 *     она показывается ТОЛЬКО со статусом `ESTIMATED` (модель, а не факт).
 *  4. Композитный индикатор перекоса — детерминированная формула с фиксированными
 *     весами, помечается как производный показатель (не торговый сигнал).
 */
export class LiquidationPulse {
  /** Веса компонентов (в сумме 100) — фиксированы и не зависят от Math.random(). */
  public static readonly WEIGHTS = {
    liquidation: 40,
    funding: 25,
    openInterest: 15,
    price: 20,
  } as const;

  private static readonly FUNDING_FULL_SCALE = 0.05; // 0.05% за 8ч — насыщение шкалы
  private static readonly OI_FULL_SCALE = 10; // 10% изменения OI — насыщение шкалы
  private static readonly PRICE_FULL_SCALE = 10; // 10% движения цены — насыщение шкалы

  public static buildAssetPulse(input: BuildAssetPulseInput): AssetPulse {
    const { symbol, liquidations, futures, priceChange24h, topEventsLimit = 4 } = input;
    const canonical = symbol.toUpperCase().replace(/\/USDT$/, '').replace(/USDT$/, '');

    const liquidation = this.buildLiquidationPulse(canonical, liquidations, futures, topEventsLimit);

    const derivatives = futures
      ? {
          openInterestUsd: futures.openInterest,
          openInterestChange1h: futures.openInterestChange1h,
          openInterestChange24h: futures.openInterestChange24h,
          fundingRate8h: futures.fundingRate,
          annualizedFundingRate: futures.annualizedFundingRate,
          basisPct: futures.basisPct,
          futuresVolume24h: futures.futuresVolume24h,
          markPrice: futures.markPrice,
          indexPrice: futures.indexPrice,
          isDemo: futures.isDemo,
        }
      : null;

    const imbalance =
      liquidation.source === 'UNAVAILABLE' || !futures
        ? null
        : this.buildImbalance(liquidation, futures, priceChange24h);

    return { symbol: canonical, liquidation, imbalance, derivatives };
  }

  /* ------------------------------------------------------------------ */
  /* Ликвидации по активу                                                */
  /* ------------------------------------------------------------------ */

  private static buildLiquidationPulse(
    canonical: string,
    liquidations: LiquidationData | null,
    futures: FuturesAsset | null,
    limit: number
  ): AssetLiquidationPulse {
    if (liquidations && liquidations.dataStatus === 'DEMO') {
      const bucket = liquidations.assetBreakdown.find((a) => this.matches(a.symbol, canonical));
      if (bucket) {
        return this.assemble(bucket.longUsd, bucket.shortUsd, this.topEvents(liquidations, canonical, limit), 'DEMO', null);
      }
    }

    if (liquidations && liquidations.dataStatus !== 'DEMO') {
      const events = this.topEvents(liquidations, canonical, limit);
      const bucket = liquidations.assetBreakdown.find((a) => this.matches(a.symbol, canonical));

      if (bucket && bucket.totalUsd > 0) {
        return this.assemble(bucket.longUsd, bucket.shortUsd, events, 'FACTUAL', null);
      }

      // Разбивка по активам может не содержать инструмент, но фактические события
      // по нему уже приняты потоком — агрегируем их напрямую (окно 24ч обеспечено конвейером).
      const assetEvents = liquidations.recentEvents.filter((e) => this.matches(e.symbol, canonical));
      if (assetEvents.length > 0) {
        const longUsd = assetEvents.filter((e) => e.side === 'LONG').reduce((a, e) => a + e.amountUsd, 0);
        const shortUsd = assetEvents.filter((e) => e.side === 'SHORT').reduce((a, e) => a + e.amountUsd, 0);
        return this.assemble(longUsd, shortUsd, events, 'FACTUAL', null);
      }

      // Фактических событий по активу нет — оценивать «на глаз» запрещено.
      const note =
        liquidations.dataStatus === 'AWAITING_STREAM'
          ? 'Поток фактических ликвидаций подключен, событий по этому активу за 24ч не поступало.'
          : 'Фактический поток ликвидаций недоступен — суммы не подставляются.';

      if (futures && futures.longLiquidations24h + futures.shortLiquidations24h > 0) {
        // Модельная оценка движка деривативов: показывается только как ESTIMATED.
        return this.assemble(
          futures.longLiquidations24h,
          futures.shortLiquidations24h,
          [],
          'ESTIMATED',
          `${note} Ниже — модельная оценка (heuristic 0.5% оборота), не фактическое событие.`
        );
      }

      return this.assemble(0, 0, [], 'UNAVAILABLE', note);
    }

    if (futures && futures.longLiquidations24h + futures.shortLiquidations24h > 0) {
      return this.assemble(
        futures.longLiquidations24h,
        futures.shortLiquidations24h,
        [],
        'ESTIMATED',
        'Фактический поток ликвидаций недоступен: показана модельная оценка, а не свершившиеся события.'
      );
    }

    return this.assemble(0, 0, [], 'UNAVAILABLE', 'Данные о ликвидациях по активу недоступны.');
  }

  private static assemble(
    longUsd: number,
    shortUsd: number,
    topEvents: LiquidationEvent[],
    source: AssetLiquidationSource,
    note: string | null
  ): AssetLiquidationPulse {
    const totalUsd = longUsd + shortUsd;
    return {
      source,
      longUsd: Number(longUsd.toFixed(2)),
      shortUsd: Number(shortUsd.toFixed(2)),
      totalUsd: Number(totalUsd.toFixed(2)),
      longSharePct: totalUsd > 0 ? Number(((longUsd / totalUsd) * 100).toFixed(1)) : 0,
      shortSharePct: totalUsd > 0 ? Number(((shortUsd / totalUsd) * 100).toFixed(1)) : 0,
      topEvents,
      note,
    };
  }

  private static topEvents(
    liquidations: LiquidationData,
    canonical: string,
    limit: number
  ): LiquidationEvent[] {
    return liquidations.recentEvents
      .filter((event) => this.matches(event.symbol, canonical))
      .sort((a, b) => b.amountUsd - a.amountUsd)
      .slice(0, limit);
  }

  private static matches(symbol: string, canonical: string): boolean {
    return symbol.toUpperCase().replace(/\/USDT$/, '').replace(/USDT$/, '') === canonical;
  }

  /* ------------------------------------------------------------------ */
  /* Производный индикатор перекоса                                      */
  /* ------------------------------------------------------------------ */

  private static buildImbalance(
    liquidation: AssetLiquidationPulse,
    futures: FuturesAsset,
    priceChange24h: number
  ): AssetImbalance {
    // Положительный балл — давление вверх (шорты под давлением), отрицательный — вниз.
    const liquidationComponent =
      liquidation.totalUsd > 0
        ? this.clamp(
            ((liquidation.shortUsd - liquidation.longUsd) / liquidation.totalUsd) *
              this.WEIGHTS.liquidation,
            -this.WEIGHTS.liquidation,
            this.WEIGHTS.liquidation
          )
        : 0;

    // Положительный фандинг => лонги платят шортам => перегруженность лонгов (давление вниз).
    const fundingComponent =
      this.clamp(futures.fundingRate / this.FUNDING_FULL_SCALE, -1, 1) * -this.WEIGHTS.funding;

    const openInterestComponent =
      this.clamp(futures.openInterestChange24h / this.OI_FULL_SCALE, -1, 1) * this.WEIGHTS.openInterest;

    const priceComponent =
      this.clamp(priceChange24h / this.PRICE_FULL_SCALE, -1, 1) * this.WEIGHTS.price;

    const score = Math.round(
      this.clamp(
        liquidationComponent + fundingComponent + openInterestComponent + priceComponent,
        -100,
        100
      )
    );

    const bias: ImbalanceBias = score >= 25 ? 'SHORT_SQUEEZE' : score <= -25 ? 'LONG_SQUEEZE' : 'BALANCED';
    const label =
      bias === 'SHORT_SQUEEZE'
        ? 'Перевес вверх: шорты под давлением'
        : bias === 'LONG_SQUEEZE'
          ? 'Перевес вниз: лонги под давлением'
          : 'Баланс: выраженного перевеса нет';

    const basedOnDemo =
      futures.isDemo || liquidation.source === 'DEMO' || liquidation.source === 'ESTIMATED';

    return {
      score,
      bias,
      label,
      components: {
        liquidation: Number(liquidationComponent.toFixed(1)),
        funding: Number(fundingComponent.toFixed(1)),
        openInterest: Number(openInterestComponent.toFixed(1)),
        price: Number(priceComponent.toFixed(1)),
      },
      basedOnDemo,
    };
  }

  private static clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(value, min), max);
  }
}
