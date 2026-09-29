import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ArrowLeft, ExternalLink, Layers, Radio, SlidersHorizontal } from 'lucide-react';
import type { CandleChartType } from '@/components/common/CandleChart';
import { CoinIcon } from '@/components/common/CoinIcon';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { OrderBookL2 } from '@/components/market/OrderBookL2';
import { AssetPulsePanel } from '@/components/market/AssetPulsePanel';
import {
  InstrumentChartCard,
  InstrumentMetricsCard,
  InstrumentMetricsGrid,
  InstrumentRadarCard,
  buildCorrelationRows,
  buildDerivativesRows,
  buildFuturesStatisticsRows,
  buildTechnicalRows,
  sectionSourceNote,
  type RadarSourcePolicy,
} from '@/components/instrument';
import { useMarketData } from '@/context/MarketDataContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useInstrumentCandles } from '@/hooks/useInstrumentCandles';
import { useFuturesOrderBook } from '@/hooks/useFuturesOrderBook';
import { getActiveSpotBaseSet, futuresBaseToSpot } from '@/services/data/registry/exchangeUniverse';
import { parseFuturesMultiplier } from '@/services/data/registry/futuresSymbols';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import { buildChartIndicatorOverlays, buildCorrelationContext } from '@/services/indicators/chartOverlays';
import { LiquidationPulse } from '@/services/liquidations/LiquidationPulse';
import type { FuturesAsset, LiquidationData, OHLCV, RadarEvent, Timeframe } from '@/types/market';
import { parseMarketType } from '@/types/market';
import { formatInstrumentPrice, formatPercent } from '@/utils/formatters';

/**
 * USD-M perpetual terminal.
 *
 * ROOT CAUSE RC-6 fix: this route exists so that opening a Futures contract
 * charts **USD-M candles** (`/fapi/v1/klines`) rather than the Spot candles of
 * a same-looking ticker. The market type is an explicit, deep-linkable part of
 * the route (`/futures/:symbol`, plus a `?market=` override kept for
 * compatibility) and is threaded down as
 * `provider.getCandles(symbol, tf, limit, { market: 'futures' })`.
 *
 * ЭТА СТРАНИЦА — ТОНКИЙ КОНТЕЙНЕР ДАННЫХ (задача §2). Вся презентация —
 * общие компоненты `@/components/instrument`, те же самые, что рендерит
 * Spot-страница: карточка графика с единым ChartTerminal, «Рыночная
 * статистика», «Деривативы», «Технические индикаторы», «Корреляция с BTC»,
 * стакан L2 и Radar. Второй копии Coin-страницы не создаётся, и правка общей
 * карточки/тулбара автоматически применяется к обоим рынкам (§17).
 *
 * ИНВАРИАНТ РЫНКА (§3): каждый источник на этой странице — USD-M:
 * свечи `{ market: 'futures' }`, стакан `/fapi/v1/depth`, метрики контракта
 * из `premiumIndex`/`ticker/24hr`/`openInterest`, BTC для корреляции — тоже
 * фьючерсный (`BTCUSDT` USD-M). Ни одна метрика не заменяется спотовой:
 * отсутствующее значение показывается как «Нет данных».
 *
 * Realtime merging is intentionally NOT enabled here: CRYPTORA's WebSocket
 * feed is a Binance **Spot** stream, and blending spot ticks into a futures
 * chart would be exactly the kind of silent cross-market contamination this
 * change removes.
 */

function normalizeBase(raw: string | undefined): string {
  return String(raw ?? '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

export const FuturesContractPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { provider } = useMarketData();
  const base = normalizeBase(symbol);
  /**
   * The route already pins the market; `?market=` is honoured only so an old
   * `/futures/:symbol?market=spot` deep link degrades predictably instead of
   * lying about its source.
   */
  const market = searchParams.has('market') ? parseMarketType(searchParams.get('market')) : 'futures';

  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [contract, setContract] = useState<FuturesAsset | null>(null);
  const [contractStatus, setContractStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [spotBase, setSpotBase] = useState<string | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [radarStatus, setRadarStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [liquidations, setLiquidations] = useState<LiquidationData | null>(null);
  const [btcCandles, setBtcCandles] = useState<OHLCV[]>([]);
  const [metaRetryKey, setMetaRetryKey] = useState(0);
  const [chartType, setChartType] = useState<CandleChartType>('candles');
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showMA, setShowMA] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showTimezone, setShowTimezone] = useState(true);

  const isDesktop = useMediaQuery('(min-width: 1280px)');
  const isPhone = useMediaQuery('(max-width: 639.98px)');
  const chartHeight = isDesktop ? 460 : isPhone ? 300 : 340;

  /**
   * Свечи USD-M. Общий с Spot-страницей хук: рынок передаётся явно, ответ с
   * устаревшим ключом отбрасывается, предыдущий запрос отменяется
   * AbortSignal'ом (RC-8 / §18).
   */
  const {
    candles,
    status: chartStatus,
    retry: retryCandles,
  } = useInstrumentCandles({
    provider,
    symbol: base,
    market,
    timeframe,
    limit: 500,
    abortOnChange: true,
  });

  /** Стакан USD-M (`/fapi/v1/depth`), поллинг 5с с отменой устаревших запросов. */
  const { orderBook, status: orderBookStatus, updatedAt: orderBookAt } = useFuturesOrderBook({
    provider,
    symbol: base,
    enabled: market === 'futures',
  });

  const retryMeta = useCallback(() => setMetaRetryKey((key) => key + 1), []);
  const retryAll = useCallback(() => {
    retryCandles();
    retryMeta();
  }, [retryCandles, retryMeta]);

  useEffect(() => {
    let active = true;
    void getActiveSpotBaseSet().then((set) => {
      if (active) setSpotBase(futuresBaseToSpot(base, set));
    });
    return () => { active = false; };
  }, [base]);

  // Contract metadata (funding/OI/basis) — independent of the chart block.
  useEffect(() => {
    if (!base) return;
    let active = true;
    setContractStatus('loading');
    setContract(null);
    const getter = provider.getFuturesContract
      ? provider.getFuturesContract(base)
      : provider.getFuturesList().then((list) => list.find((f) => f.symbol.split('/')[0] === base) ?? null);
    void getter
      .then((found) => {
        if (!active) return;
        setContract(found);
        setContractStatus(found ? 'ready' : 'missing');
      })
      .catch(() => { if (active) setContractStatus('error'); });
    return () => { active = false; };
  }, [base, provider, metaRetryKey]);

  /**
   * Radar и ликвидации — вторичные блоки: их отказ не влияет ни на график,
   * ни на метрики контракта (§15). Radar запрашивается по СПОТОВОЙ базе,
   * потому что серверный монитор считает аномалии спота (см. политику в
   * `InstrumentRadarCard`).
   */
  useEffect(() => {
    if (!base) return;
    let active = true;
    setRadarStatus('loading');
    setRadarEvents([]);
    setLiquidations(null);
    const radarSymbol = spotBase ?? base;
    void Promise.allSettled([provider.getRadarEvents(radarSymbol), provider.getLiquidations()])
      .then(([radarResult, liquidationResult]) => {
        if (!active) return;
        if (radarResult.status === 'fulfilled') {
          setRadarEvents(radarResult.value);
          setRadarStatus('ready');
        } else {
          setRadarStatus('error');
        }
        if (liquidationResult.status === 'fulfilled') setLiquidations(liquidationResult.value);
      });
    return () => { active = false; };
  }, [base, spotBase, provider, metaRetryKey]);

  /**
   * Корреляция с BTC считается по ФЬЮЧЕРСНЫМ свечам BTCUSDT (§8): сравнивать
   * перпетуал со спотовым BTC значит смешивать рынки. Формулы не изменены —
   * используется тот же `IndicatorEngine`.
   */
  useEffect(() => {
    let active = true;
    setBtcCandles([]);
    if (!base || base === 'BTC' || market !== 'futures') return () => { active = false; };
    void provider.getCandles('BTC', timeframe, 500, { market: 'futures' })
      .then((rows) => { if (active) setBtcCandles(rows); })
      .catch(() => { if (active) setBtcCandles([]); });
    return () => { active = false; };
  }, [base, timeframe, market, provider]);

  // Оверлеи графика: общая с Spot реализация (SMA 20/50/200 + Bollinger).
  const chartIndicators = useMemo(() => buildChartIndicatorOverlays(candles), [candles]);

  /** Индикаторы считаются по свечам ЭТОГО рынка; формулы не тронуты (§7). */
  const indicators = useMemo(
    () => (candles.length > 0 ? IndicatorEngine.computeCompleteIndicators(candles) : undefined),
    [candles],
  );

  const correlation = useMemo(() => {
    const context = buildCorrelationContext(candles, btcCandles);
    return context ? { ...context, timeframe } : null;
  }, [candles, btcCandles, timeframe]);

  const multiplier = useMemo(() => parseFuturesMultiplier(base), [base]);
  const displayPair = `${base}/USDT`;
  const contractSymbol = contract?.contractSymbol ?? `${base}USDT`;
  const price = contract?.lastPrice ?? contract?.markPrice ?? candles.at(-1)?.close ?? 0;

  /**
   * Снимок ликвидаций/деривативов по контракту. Источник помечается самим
   * компонентом (FACTUAL / ESTIMATED / UNAVAILABLE), поэтому оценочные
   * значения нельзя принять за биржевой факт.
   */
  const pulse = useMemo(
    () => LiquidationPulse.buildAssetPulse({
      symbol: base,
      liquidations,
      futures: contract,
      priceChange24h: contract?.priceChange24h ?? 0,
    }),
    [base, liquidations, contract],
  );

  const sectionStatus = contractStatus === 'ready'
    ? 'ready'
    : contractStatus === 'loading'
      ? 'loading'
      : contractStatus === 'missing' ? 'unsupported' : 'error';

  /** Политика Radar (§9): спотовые аномалии показываются только с явной подписью. */
  const radarPolicy: RadarSourcePolicy = spotBase ? 'spot-underlying' : 'hidden';

  if (!base) {
    return (
      <div className="route-shell mx-auto max-w-[1920px] px-3 py-6 sm:px-4" data-route="futures-contract">
        <p className="font-sans text-sm text-slate-300">Контракт не указан.</p>
      </div>
    );
  }

  return (
    <div
      className="route-shell mx-auto max-w-[1920px] space-y-3.5 px-3 py-3 sm:px-4"
      data-route="futures-contract"
      data-market={market}
      data-contract={contractSymbol}
    >
      {/* ── Идентичность инструмента ─────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b border-white/[0.08] pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/futures')}
            aria-label="Назад к списку контрактов"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-surface-elevated text-slate-300 transition-colors hover:bg-surface-hover hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <CoinIcon symbol={base} size={32} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-sans text-lg font-bold tracking-wide text-white sm:text-xl">
                {displayPair}
              </h1>
              <span
                data-qa="futures-market-badge"
                className="rounded-full border border-brand-green/30 bg-brand-green/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-brand-green"
              >
                USD-M PERPETUAL
              </span>
              {multiplier.multiplier > 1 && (
                <span
                  title={`Контракт с множителем: 1 контракт = ${multiplier.multiplier} ${multiplier.underlying}`}
                  className="rounded border border-white/[0.12] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
                >
                  ×{multiplier.multiplier.toLocaleString('ru-RU')} {multiplier.underlying}
                </span>
              )}
            </div>
            <p className="mt-0.5 font-sans text-xs text-slate-400">
              Свечи и метрики — Binance USD-M Futures ({contractSymbol}). Spot-данные не подставляются.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Цена контракта каноничной точностью: 0.000478 не округляется (§14). */}
          <div className="text-right font-mono">
            <div data-qa="futures-last-price" className="text-xl font-black tabular-nums text-white sm:text-2xl">
              {contractStatus === 'ready' && price > 0 ? formatInstrumentPrice(price) : '—'}
            </div>
            <div
              data-qa="futures-change-24h"
              className={`text-xs font-bold ${
                contract?.priceChange24h == null
                  ? 'text-slate-500'
                  : contract.priceChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
              }`}
            >
              24h: {contract?.priceChange24h != null ? formatPercent(contract.priceChange24h) : 'Нет данных'}
            </div>
          </div>
          {spotBase && (
            <Link
              to={`/coin/${spotBase}`}
              data-qa="futures-open-spot"
              className="inline-flex min-h-[36px] w-fit items-center gap-1.5 rounded-lg border border-white/[0.08] bg-surface-elevated px-3 font-sans text-xs font-semibold text-slate-200 transition-colors hover:bg-surface-hover hover:text-white"
            >
              Открыть Spot {spotBase}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>
      </div>

      {/* ── График + снимок деривативов ──────────────────────────────── */}
      <TerminalSection
        label="DERIVATIVES TERMINAL"
        title={`${displayPair} · USD-M`}
        meta={market === 'futures' ? 'BINANCE USD-M KLINES' : 'BINANCE SPOT KLINES'}
        className="coin-workspace-region"
      >
        {/*
         * `items-start`: карточка графика и Pulse-панель держат СВОЮ
         * естественную высоту. Прежний `items-stretch` растягивал рамку
         * карточки графика до высоты более высокой Pulse-панели — внутри
         * рамки появлялась пустая полоса (UI-cleanup §2). Pulse-обёртка
         * прозрачна (`<aside>` без фона), поэтому ничем растягивать её
         * было не нужно.
         */}
        <div data-qa="futures-workspace" className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[72fr_28fr]">
          <InstrumentChartCard
            market={market}
            displayPair={displayPair}
            status={chartStatus}
            onRetry={retryCandles}
            stateQa="futures-chart-state"
            high24h={contract?.high24h ?? null}
            low24h={contract?.low24h ?? null}
            note="Аналитический terminal · без исполнения сделок"
            qa="futures-chart-card"
            terminal={{
              data: candles,
              symbol: displayPair,
              timeframe,
              onTimeframeChange: setTimeframe,
              height: chartHeight,
              indicators: chartIndicators,
              chartType,
              onChartTypeChange: setChartType,
              showRSI,
              onShowRSIChange: setShowRSI,
              showMACD,
              onShowMACDChange: setShowMACD,
              showMA,
              onShowMAChange: setShowMA,
              showVolume,
              onShowVolumeChange: setShowVolume,
              showTimezone,
              onShowTimezoneChange: setShowTimezone,
            }}
          />
          <div className="self-start xl:sticky xl:top-[70px]">
            <AssetPulsePanel pulse={pulse} />
          </div>
        </div>
      </TerminalSection>

      {/* ── Метрики: те же карточки и в том же порядке, что на Spot ──── */}
      <TerminalSection label="CONTRACT METRICS" title="Метрики контракта" className="market-workspace">
        {/*
         * ОБЩАЯ сетка метрик (UI-cleanup §3/§4/§6): 1 колонка на мобильном,
         * 2 на tablet, 3 на desktop; «Корреляция с BTC» поглощает хвостовую
         * строку (`lg:col-span-3`) и внутри — горизонтальный inline-контент,
         * поэтому сетка не резервирует две пустые ячейки второй строки.
         */}
        <InstrumentMetricsGrid>
          <InstrumentMetricsCard
            title="Рыночная статистика"
            icon={Activity}
            market={market}
            status={sectionStatus}
            qa="futures-market-statistics"
            sourceNote={sectionSourceNote(market, contractSymbol)}
            unsupportedMessage={`Контракт ${contractSymbol} отсутствует в активной вселенной Binance USD-M.`}
            onRetry={retryMeta}
            rows={contract ? buildFuturesStatisticsRows(contract) : []}
            footer={
              <p className="border-t border-surface-border pt-2 font-sans text-[11px] leading-4 text-slate-500">
                Капитализация и данные об эмиссии относятся к базовому активу и у бессрочного контракта не определены.
                {spotBase && (
                  <>
                    {' '}
                    <Link to={`/coin/${spotBase}`} className="text-brand-cyan hover:underline">
                      Открыть Spot {spotBase}
                    </Link>
                  </>
                )}
              </p>
            }
          />

          <InstrumentMetricsCard
            title="Деривативы: детали контракта"
            icon={Layers}
            iconClassName="text-brand-purple"
            market={market}
            status={sectionStatus}
            qa="futures-derivatives"
            sourceNote={sectionSourceNote(market, 'premiumIndex · openInterest')}
            unsupportedMessage={`Контракт ${contractSymbol} отсутствует в активной вселенной Binance USD-M.`}
            onRetry={retryMeta}
            rows={contract ? buildDerivativesRows(contract, 'full') : []}
          />

          <InstrumentMetricsCard
            title="Технические индикаторы"
            icon={SlidersHorizontal}
            iconClassName="text-brand-sky"
            market={market}
            status={chartStatus === 'ready' ? (indicators ? 'ready' : 'no-data') : chartStatus === 'loading' ? 'loading' : chartStatus === 'unsupported' ? 'unsupported' : 'no-data'}
            qa="futures-indicators"
            sourceNote={sectionSourceNote(market, `свечи ${timeframe}`)}
            emptyMessage="Недостаточно фактических свечей контракта для расчёта."
            onRetry={retryCandles}
            rows={buildTechnicalRows(indicators)}
          />

          {base !== 'BTC' && (
            <InstrumentMetricsCard
              title="Корреляция с BTC"
              icon={Activity}
              iconClassName="text-amber-400"
              market={market}
              status={correlation ? 'ready' : chartStatus === 'loading' ? 'loading' : 'no-data'}
              qa="futures-btc-correlation"
              sourceNote={sectionSourceNote(market, 'BTCUSDT PERP')}
              emptyMessage="Недостаточно истории для расчёта"
              rows={correlation ? buildCorrelationRows(correlation) : []}
              variant="inline"
              footer={
                <p className="border-t border-surface-border pt-2 font-sans text-[11px] leading-4 text-slate-500">
                  Сравнение с фьючерсом BTCUSDT (USD-M), а не со спотовым BTC.
                </p>
              }
            />
          )}
        </InstrumentMetricsGrid>
      </TerminalSection>

      {/* ── Стакан USD-M + Radar базового актива ─────────────────────── */}
      <TerminalSection label="DEPTH & RADAR" title="Книга заявок и аномалии" className="market-workspace">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-h-[380px] lg:col-span-1">
            <OrderBookL2
              orderBook={orderBook}
              currentPrice={price}
              symbol={base}
              market="futures"
              status={orderBookStatus}
              qa="futures-order-book"
              sourceLabel={
                orderBookAt
                  ? `USD-M DEPTH · ${new Date(orderBookAt).toISOString().slice(11, 19)} UTC`
                  : 'USD-M DEPTH · REST 5s'
              }
            />
          </div>
          <div className="space-y-4 lg:col-span-2">
            {radarPolicy === 'hidden' ? (
              <div
                data-qa="futures-radar-hidden"
                className="rounded-lg border border-surface-border bg-surface p-4 font-sans text-[13px] text-slate-500"
              >
                <div className="mb-1 flex items-center gap-2 text-white">
                  <Radio className="h-4 w-4 text-brand-cyan" />
                  <span className="text-[13px] font-bold tracking-wide">Market Radar</span>
                </div>
                Radar считает аномалии Spot-рынка. У контракта {contractSymbol} нет активной спотовой базы, поэтому
                события не показываются: выдавать спотовую аномалию другого инструмента за фьючерсную нельзя.
              </div>
            ) : (
              <InstrumentRadarCard
                events={radarEvents}
                status={radarStatus === 'error' ? 'error' : radarStatus === 'loading' ? 'loading' : 'ready'}
                policy={radarPolicy}
                sourceSymbol={spotBase ?? base}
                qa="futures-radar"
                onRetry={retryAll}
              />
            )}
          </div>
        </div>
      </TerminalSection>
    </div>
  );
};

export default FuturesContractPage;
