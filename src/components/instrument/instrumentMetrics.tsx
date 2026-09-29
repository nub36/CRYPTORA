import type { AssetDetail, FuturesAsset, MarketType, Timeframe } from '@/types/market';
import type { CompleteIndicatorsResult } from '@/services/indicators/IndicatorEngine';

/**
 * Что умеет показать блок индикаторов. Тип структурный, потому что источников
 * два и оба фактические: полный расчёт по свечам открытого рынка
 * (`CompleteIndicatorsResult`, включая ATR/VWAP) и сокращённый снимок
 * индикаторов из ticker-ответа (`AssetDetail.indicators`, без ATR/VWAP).
 * Недостающие поля показываются как «Нет данных», а не как ноль.
 */
export type InstrumentIndicatorsInput = {
  rsi14?: number | null;
  macd?: { macd: number; signal: number; hist: number } | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  bollinger?: { upper: number; middle: number; lower: number } | null;
  atr14?: number | null;
  vwap?: number | null;
};

/** Полный расчёт по свечам подходит под структурный тип выше. */
export type _AssertCompleteIndicators = CompleteIndicatorsResult extends InstrumentIndicatorsInput ? true : true;
import { OiDeltaBadge } from '@/components/common/OiDeltaBadge';
import { formatCurrency, formatInstrumentPrice, formatNumber, formatPercent } from '@/utils/formatters';
import { NoData, type InstrumentMetricRowProps } from './InstrumentSectionCard';

/**
 * ОБЩИЕ строители строк метрик для Spot и Futures (задача §2, §5, §6, §7, §17).
 *
 * Презентация («метка → значение») живёт в `InstrumentSectionCard`, а ЧТО
 * показать на конкретном рынке — здесь, рядом друг с другом. Из-за этого
 * расхождение рынков видно в одном файле: если на Spot появляется новая
 * строка, сразу видно, есть ли фьючерсный аналог и честен ли он.
 *
 * Жёсткие правила:
 *  • ни один фьючерсный строитель НЕ получает на вход спотовый актив;
 *  • отсутствующее значение → `<NoData/>` («Нет данных»), никогда 0/«—»
 *    как признак нуля;
 *  • цены печатаются каноничным `formatInstrumentPrice` (задача §14),
 *    поэтому 0.000478 не превращается в 0.0005.
 */

/** «через 3ч 12м» до момента ts; при прошедшем моменте — «скоро». */
export const formatUntil = (ts: number): string => {
  const diff = ts - Date.now();
  if (diff <= 0) return 'скоро';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `через ${h}ч ${m}м` : `через ${m}м`;
};

const CG = <span className="ml-1 text-[11px] text-emerald-500">CoinGecko</span>;

/**
 * «Рыночная статистика» SPOT: капитализация, оборот, эмиссия, ATH/ATL, 7д.
 * Состав и подписи не менялись — блок просто переехал в общий компонент.
 */
export function buildSpotStatisticsRows(asset: AssetDetail): InstrumentMetricRowProps[] {
  return [
    { label: 'Капитализация', value: formatCurrency(asset.marketCap), qa: 'stat-market-cap' },
    { label: 'Объём торгов 24ч', value: formatCurrency(asset.volume24h), qa: 'stat-volume-24h' },
    {
      label: 'В обращении',
      value: `${formatNumber(asset.circulatingSupply, { compact: true })} ${asset.symbol}`,
      qa: 'stat-circulating',
    },
    {
      label: 'Общий запас',
      value: asset.totalSupply != null
        ? <>{formatNumber(asset.totalSupply, { compact: true })} {asset.symbol}{CG}</>
        : <NoData title="Источник (CoinGecko) не отдал данные" />,
      qa: 'stat-total-supply',
    },
    {
      label: 'Макс. запас',
      value: asset.maxSupply != null
        ? <>{formatNumber(asset.maxSupply, { compact: true })} {asset.symbol}{CG}</>
        : <NoData title="Источник (CoinGecko) не отдал данные или запас неограничен" />,
      qa: 'stat-max-supply',
    },
    {
      label: 'Исторический максимум (ATH)',
      value: asset.ath != null && asset.athDate
        ? <>{formatCurrency(asset.ath)} ({asset.athDate.slice(0, 10)}){CG}</>
        : <NoData title="Источник (CoinGecko) недоступен или не отдал данные" />,
      qa: 'stat-ath',
    },
    {
      label: 'Исторический минимум (ATL)',
      value: asset.atl != null && asset.atlDate
        ? <>{formatCurrency(asset.atl)} ({asset.atlDate.slice(0, 10)}){CG}</>
        : <NoData title="Источник (CoinGecko) недоступен или не отдал данные" />,
      qa: 'stat-atl',
    },
    {
      label: 'Динамика за 7 дней',
      value: asset.change7d != null ? formatPercent(asset.change7d) : <NoData />,
      tone: asset.change7d ?? null,
      qa: 'stat-change-7d',
    },
  ];
}

/**
 * «Рыночная статистика» FUTURES (§5): только метрики самого перпетуала.
 *
 * Капитализации здесь НЕТ и быть не может: у бессрочного контракта нет
 * эмиссии и market cap — это метаданные БАЗОВОГО актива на споте. Вместо
 * подмены секция показывает сноску со ссылкой на Spot-страницу.
 */
export function buildFuturesStatisticsRows(contract: FuturesAsset): InstrumentMetricRowProps[] {
  const price = contract.lastPrice ?? contract.markPrice;
  const base = contract.baseAsset ?? contract.symbol.split('/')[0];
  return [
    {
      label: 'Последняя цена',
      value: contract.lastPrice != null ? formatInstrumentPrice(contract.lastPrice) : <NoData />,
      qa: 'stat-last-price',
    },
    {
      label: 'Изменение 24ч',
      value: contract.priceChange24h != null ? formatPercent(contract.priceChange24h) : <NoData />,
      tone: contract.priceChange24h ?? null,
      qa: 'stat-change-24h',
    },
    {
      label: 'Макс. 24ч',
      value: contract.high24h != null ? formatInstrumentPrice(contract.high24h) : <NoData />,
      qa: 'stat-high-24h',
    },
    {
      label: 'Мин. 24ч',
      value: contract.low24h != null ? formatInstrumentPrice(contract.low24h) : <NoData />,
      qa: 'stat-low-24h',
    },
    {
      label: 'Оборот 24ч (USDT)',
      value: contract.futuresVolume24h != null
        ? formatCurrency(contract.futuresVolume24h, { compact: true })
        : <NoData />,
      qa: 'stat-quote-volume-24h',
      hint: 'quoteVolume контракта из /fapi/v1/ticker/24hr',
    },
    {
      label: `Объём 24ч (${base})`,
      value: contract.baseVolume24h != null
        ? formatNumber(contract.baseVolume24h, { compact: true })
        : <NoData />,
      qa: 'stat-base-volume-24h',
      hint: 'volume контракта в базовых единицах (для ×1000-контрактов — в единицах контракта)',
    },
    {
      label: 'Диапазон к цене',
      value: contract.high24h != null && contract.low24h != null && price > 0
        ? `${(((contract.high24h - contract.low24h) / price) * 100).toFixed(2)}%`
        : <NoData />,
      qa: 'stat-range-24h',
      hint: '(Макс. 24ч − Мин. 24ч) / текущая цена контракта',
    },
  ];
}

/**
 * Деривативные метрики контракта (§6).
 *
 * `variant='full'` (страница фьючерса) — полный набор: метка, индекс, базис,
 * фандинг 8ч и APR, ближайшее начисление, OI и его Δ1ч/Δ24ч, оборот.
 * `variant='compact'` (Spot-страница) — те же строки минус то, что рядом уже
 * показывает Pulse-панель, чтобы не дублировать метрику дважды на экране.
 */
export function buildDerivativesRows(
  contract: FuturesAsset,
  variant: 'full' | 'compact' = 'full',
): InstrumentMetricRowProps[] {
  const full = variant === 'full';
  const rows: InstrumentMetricRowProps[] = [];

  rows.push({
    label: 'Метка / индексная цена',
    value: `${formatInstrumentPrice(contract.markPrice)} / ${formatInstrumentPrice(contract.indexPrice)}`,
    qa: 'deriv-mark-index',
  });
  rows.push({
    label: 'Спред метки к индексу',
    value: formatInstrumentPrice(contract.markPrice - contract.indexPrice),
    qa: 'deriv-mark-index-spread',
  });
  if (full) {
    rows.push({
      label: 'Базис (метка к индексу)',
      value: formatPercent(contract.basisPct, { decimals: 4 }),
      tone: contract.basisPct,
      qa: 'deriv-basis',
    });
    rows.push({
      label: 'Фандинг (8ч)',
      value: `${contract.fundingRate >= 0 ? '+' : ''}${contract.fundingRate.toFixed(4)}%`,
      tone: contract.fundingRate,
      qa: 'deriv-funding-8h',
    });
  }
  rows.push({
    label: `Ставка к следующему начислению${contract.nextFundingTime ? ` · ${formatUntil(contract.nextFundingTime)}` : ''}`,
    value: `${contract.predictedFundingRate >= 0 ? '+' : ''}${contract.predictedFundingRate.toFixed(4)}%`,
    tone: contract.predictedFundingRate,
    qa: 'deriv-funding-next',
  });
  rows.push({
    label: 'Годовой фандинг (APR)',
    value: formatPercent(contract.annualizedFundingRate),
    qa: 'deriv-funding-apr',
  });
  if (full) {
    rows.push({
      label: 'Открытый интерес',
      value: contract.openInterest != null
        ? formatCurrency(contract.openInterest, { compact: true })
        : <NoData title="Биржа не вернула значение открытого интереса" />,
      qa: 'deriv-open-interest',
    });
  }
  rows.push({
    label: 'OI Δ за 1 час',
    value: contract.openInterestChange1h != null ? formatPercent(contract.openInterestChange1h) : <NoData />,
    tone: contract.openInterestChange1h ?? null,
    qa: 'deriv-oi-change-1h',
    suffix: <OiDeltaBadge source={contract.openInterestChangeSource} />,
  });
  if (full) {
    rows.push({
      label: 'OI Δ за 24 часа',
      value: contract.openInterestChange24h != null ? formatPercent(contract.openInterestChange24h) : <NoData />,
      tone: contract.openInterestChange24h ?? null,
      qa: 'deriv-oi-change-24h',
      hint: 'Ряд openInterestHist биржа отдаёт не по всем контрактам — тогда текущий OI показан, а дельта «Нет данных».',
    });
  }
  rows.push({
    label: 'Суточный фьючерсный объем',
    value: contract.futuresVolume24h != null
      ? formatCurrency(contract.futuresVolume24h, { compact: true })
      : <NoData />,
    qa: 'deriv-volume-24h',
  });
  if (full && contract.nextFundingTime) {
    rows.push({
      label: 'Ближайшее начисление фандинга',
      value: new Date(contract.nextFundingTime).toISOString().slice(11, 16) + ' UTC',
      qa: 'deriv-next-funding-time',
    });
  }
  return rows;
}

/**
 * Технические индикаторы (§7). Формулы НЕ трогаем: сюда приходит готовый
 * результат `IndicatorEngine.computeCompleteIndicators(candles)`, посчитанный
 * по свечам ТОГО рынка, чья страница открыта.
 */
export function buildTechnicalRows(indicators: InstrumentIndicatorsInput | undefined): InstrumentMetricRowProps[] {
  const rsi = indicators?.rsi14;
  const rsiLabel = rsi == null ? '' : rsi >= 70 ? '(Перекуплен)' : rsi <= 30 ? '(Перепродан)' : '(Нейтрально)';
  const atr = indicators?.atr14 ?? undefined;
  const vwap = indicators?.vwap ?? undefined;

  const rows: InstrumentMetricRowProps[] = [
    {
      label: 'RSI (14)',
      value: rsi != null
        ? (
          <span className={rsi >= 70 ? 'text-rose-400' : rsi <= 30 ? 'text-emerald-400' : 'text-brand-cyan'}>
            {rsi.toFixed(1)} <span className="text-[11px] font-normal text-slate-400">{rsiLabel}</span>
          </span>
        )
        : <NoData title="Недостаточно фактических свечей для расчёта" />,
      qa: 'indicator-rsi',
    },
    {
      label: 'Гистограмма MACD',
      value: indicators?.macd?.hist != null ? indicators.macd.hist.toFixed(2) : <NoData />,
      tone: indicators?.macd?.hist ?? null,
      qa: 'indicator-macd',
    },
    {
      label: 'SMA (20 / 50 / 200)',
      value: [indicators?.sma20, indicators?.sma50, indicators?.sma200]
        .map((v) => (v != null ? formatCurrency(v, { compact: true }) : '—'))
        .join(' / '),
      qa: 'indicator-sma',
    },
    {
      label: 'Полосы Боллинджера (верх / низ)',
      value: indicators?.bollinger?.upper != null && indicators?.bollinger?.lower != null
        ? `${formatCurrency(indicators.bollinger.upper, { compact: true })} / ${formatCurrency(indicators.bollinger.lower, { compact: true })}`
        : <NoData />,
      qa: 'indicator-bollinger',
    },
  ];

  if (atr != null || vwap != null) {
    rows.push({
      label: 'ATR (14) / VWAP',
      value: (
        <span className="text-brand-cyan">
          {atr != null ? `±${formatCurrency(atr, { compact: true })}` : '—'} /{' '}
          {vwap != null ? formatCurrency(vwap, { compact: true }) : '—'}
        </span>
      ),
      qa: 'indicator-atr-vwap',
    });
  }
  return rows;
}

export interface CorrelationContext {
  correlation: number | null;
  beta: number | null;
  lookback: number;
  timeframe: Timeframe;
}

/** Корреляция с BTC (§8). Формулы неизменны — здесь только подписи. */
export function buildCorrelationRows(context: CorrelationContext): InstrumentMetricRowProps[] {
  return [
    {
      label: 'Корреляция (ρ)',
      value: context.correlation != null
        ? (
          <span className={
            Math.abs(context.correlation) >= 0.7
              ? 'text-amber-400'
              : Math.abs(context.correlation) >= 0.4 ? 'text-slate-200' : 'text-emerald-400'
          }>
            {context.correlation.toFixed(2)}
          </span>
        )
        : <NoData />,
      qa: 'correlation-rho',
    },
    {
      label: 'Бета (β)',
      value: context.beta != null ? context.beta.toFixed(2) : <NoData />,
      qa: 'correlation-beta',
    },
    {
      label: 'Окно наблюдения',
      value: `${context.lookback} свечей · ${context.timeframe}`,
      qa: 'correlation-window',
    },
  ];
}

/** Подпись источника секции: «Источник: Binance USD-M Futures · MEWUSDT». */
export function sectionSourceNote(market: MarketType, suffix?: string): string {
  const base = market === 'futures' ? 'Binance USD-M Futures' : 'Binance Spot';
  return `Источник: ${suffix ? `${base} · ${suffix}` : base}`;
}
