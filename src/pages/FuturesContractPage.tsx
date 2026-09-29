import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { ChartTerminal } from '@/components/common/ChartTerminal';
import type { CandleChartType, ChartIndicatorData } from '@/components/common/CandleChart';
import { ChartDataState, type ChartDataStatus } from '@/components/common/ChartDataState';
import { CoinIcon } from '@/components/common/CoinIcon';
import { OiDeltaBadge } from '@/components/common/OiDeltaBadge';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { useMarketData } from '@/context/MarketDataContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { UnsupportedMarketSymbolError } from '@/services/data/adapters/errors';
import { getActiveSpotBaseSet, futuresBaseToSpot } from '@/services/data/registry/exchangeUniverse';
import { parseFuturesMultiplier } from '@/services/data/registry/futuresSymbols';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import type { FuturesAsset, OHLCV, Timeframe } from '@/types/market';
import { parseMarketType } from '@/types/market';
import { formatCurrency, formatPercent } from '@/utils/formatters';

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
 * Realtime merging is intentionally NOT enabled here: CRYPTORA's WebSocket
 * feed is a Binance **Spot** stream, and blending spot ticks into a futures
 * chart would be exactly the kind of silent cross-market contamination this
 * change removes.
 */

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '5m': '5м', '15m': '15м', '30m': '30м', '1h': '1ч', '4h': '4ч', '1D': '1Д', '1W': '1Н',
};

const NO_DATA = <span className="font-sans text-[11px] text-slate-500">Нет данных</span>;

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
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [chartStatus, setChartStatus] = useState<ChartDataStatus>('loading');
  const [contract, setContract] = useState<FuturesAsset | null>(null);
  const [contractStatus, setContractStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [spotBase, setSpotBase] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
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
   * Stale-response guard (RC-8). The key includes the MARKET, so switching
   * Spot↔Futures for the same ticker can never apply the other market's
   * response, and a slow response for a previous symbol is discarded.
   */
  const requestKeyRef = useRef('');
  const requestKey = `${base}:${timeframe}:${market}:${retryKey}`;

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
  }, [base, provider, retryKey]);

  // Candles — USD-M only, with abort + stale-response protection.
  useEffect(() => {
    if (!base) return;
    requestKeyRef.current = requestKey;
    const controller = new AbortController();
    setCandles([]);
    setChartStatus('loading');

    void provider
      .getCandles(base, timeframe, 500, { market, signal: controller.signal })
      .then((rows) => {
        if (requestKeyRef.current !== requestKey) return; // stale response — discard
        setCandles(rows);
        setChartStatus(rows.length === 0 ? 'no-data' : 'ready');
      })
      .catch((error: unknown) => {
        if (requestKeyRef.current !== requestKey) return;
        setCandles([]);
        setChartStatus(error instanceof UnsupportedMarketSymbolError ? 'unsupported' : 'unavailable');
      });

    return () => { controller.abort(); };
  }, [base, timeframe, market, provider, requestKey]);

  // Overlay series only (presentation). Indicator MATH is untouched — the same
  // IndicatorEngine the Spot terminal uses, fed with USD-M closes.
  const chartIndicators = useMemo<ChartIndicatorData | undefined>(() => {
    if (candles.length < 20) return undefined;
    const closes = candles.map((c) => c.close);
    const pad = (series: number[], offset: number): number[] => new Array<number>(offset).fill(NaN).concat(series);
    const sma20 = IndicatorEngine.calculateSMA(closes, 20);
    const sma50 = IndicatorEngine.calculateSMA(closes, 50);
    return {
      sma20: candles.length >= 20 ? pad(sma20, closes.length - sma20.length) : undefined,
      sma50: candles.length >= 50 ? pad(sma50, closes.length - sma50.length) : undefined,
    };
  }, [candles]);

  const multiplier = useMemo(() => parseFuturesMultiplier(base), [base]);
  const retry = useCallback(() => setRetryKey((k) => k + 1), []);

  if (!base) {
    return (
      <div className="route-shell mx-auto max-w-[1920px] px-3 py-6 sm:px-4" data-route="futures-contract">
        <p className="font-sans text-sm text-slate-300">Контракт не указан.</p>
      </div>
    );
  }

  return (
    <div
      className="route-shell mx-auto max-w-[1920px] space-y-4 px-3 py-3.5 sm:px-4"
      data-route="futures-contract"
      data-market={market}
      data-contract={contract?.contractSymbol ?? `${base}USDT`}
    >
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
                {base}/USDT
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
              Свечи и метрики — Binance USD-M Futures ({contract?.contractSymbol ?? `${base}USDT`}). Spot-данные не подставляются.
            </p>
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

      <TerminalSection
        label="DERIVATIVES TERMINAL"
        title={`${base}/USDT · ${TIMEFRAME_LABELS[timeframe]}`}
        meta={market === 'futures' ? 'BINANCE USD-M KLINES' : 'BINANCE SPOT KLINES'}
        className="coin-workspace-region"
      >
        <div className="space-y-2">
          <ChartDataState
            status={chartStatus}
            symbol={`${base}/USDT`}
            market={market}
            onRetry={retry}
            qa="futures-chart-state"
          />
          {chartStatus === 'ready' && (
            <ChartTerminal
              data={candles}
              symbol={`${base}/USDT`}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              height={chartHeight}
              indicators={chartIndicators}
              chartType={chartType}
              onChartTypeChange={setChartType}
              showRSI={showRSI}
              onShowRSIChange={setShowRSI}
              showMACD={showMACD}
              onShowMACDChange={setShowMACD}
              showMA={showMA}
              onShowMAChange={setShowMA}
              showVolume={showVolume}
              onShowVolumeChange={setShowVolume}
              showTimezone={showTimezone}
              onShowTimezoneChange={setShowTimezone}
            />
          )}
          {/* Пока график не готов (загрузка/ошибка) — таймфреймы остаются доступными. */}
          {chartStatus !== 'ready' && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Таймфрейм">
              {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  aria-pressed={tf === timeframe}
                  className={`min-h-[36px] min-w-[44px] rounded-lg border px-2.5 font-mono text-xs transition-colors ${
                    tf === timeframe
                      ? 'border-cyan-500 bg-cyan-500 font-bold text-slate-950'
                      : 'border-white/[0.08] bg-surface-elevated text-slate-300 hover:bg-surface-hover hover:text-white'
                  }`}
                >
                  {TIMEFRAME_LABELS[tf]}
                </button>
              ))}
            </div>
          )}
        </div>
      </TerminalSection>

      <TerminalSection label="CONTRACT METRICS" title="Метрики контракта" className="market-workspace">
        {contractStatus === 'loading' && (
          <p role="status" className="py-6 text-center font-sans text-xs text-slate-400">Загрузка метрик контракта…</p>
        )}
        {contractStatus === 'missing' && (
          <p role="status" data-qa="futures-contract-missing" className="py-6 text-center font-sans text-xs text-slate-400">
            Контракт {base}USDT отсутствует в активной вселенной Binance USD-M.
          </p>
        )}
        {contractStatus === 'error' && (
          <p role="alert" className="py-6 text-center font-sans text-xs text-rose-300">
            Источник деривативов недоступен.
          </p>
        )}
        {contractStatus === 'ready' && contract && (
          <div className="grid grid-cols-2 gap-3 font-sans md:grid-cols-3 xl:grid-cols-6">
            {[
              { label: 'Цена метки', node: formatCurrency(contract.markPrice, { decimals: contract.markPrice > 10 ? 2 : 4 }) },
              { label: 'Индексная цена', node: formatCurrency(contract.indexPrice, { decimals: contract.indexPrice > 10 ? 2 : 4 }) },
              {
                label: '24ч %',
                node: contract.priceChange24h != null ? formatPercent(contract.priceChange24h) : NO_DATA,
                tone: contract.priceChange24h,
              },
              { label: 'Фандинг (8ч)', node: `${contract.fundingRate >= 0 ? '+' : ''}${contract.fundingRate.toFixed(4)}%`, tone: contract.fundingRate },
              {
                label: 'Открытый интерес',
                node: contract.openInterest != null ? formatCurrency(contract.openInterest, { compact: true }) : NO_DATA,
              },
              {
                label: 'Объём 24ч',
                node: contract.futuresVolume24h != null ? formatCurrency(contract.futuresVolume24h, { compact: true }) : NO_DATA,
              },
            ].map((metric) => (
              <div key={metric.label} className="rounded-xl border border-white/[0.08] bg-surface p-3 shadow-panel">
                <div className="text-[11px] tracking-wide text-slate-400">{metric.label}</div>
                <div
                  className={`mt-1 font-mono text-base font-bold tabular-nums ${
                    metric.tone == null ? 'text-white' : metric.tone >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {metric.node}
                </div>
              </div>
            ))}
            <div className="col-span-2 rounded-xl border border-white/[0.08] bg-surface p-3 shadow-panel md:col-span-3 xl:col-span-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs tabular-nums text-slate-300">
                <span>Базис: <span className={contract.basisPct >= 0 ? 'text-brand-green' : 'text-brand-red'}>{formatPercent(contract.basisPct, { decimals: 4 })}</span></span>
                <span>APR: {formatPercent(contract.annualizedFundingRate)}</span>
                <span className="inline-flex items-center">
                  OI 1ч Δ:&nbsp;
                  {contract.openInterestChange1h != null ? formatPercent(contract.openInterestChange1h) : NO_DATA}
                  <OiDeltaBadge source={contract.openInterestChangeSource} />
                </span>
                <span className="inline-flex items-center">
                  OI 24ч Δ:&nbsp;
                  {contract.openInterestChange24h != null ? formatPercent(contract.openInterestChange24h) : NO_DATA}
                </span>
              </div>
            </div>
          </div>
        )}
      </TerminalSection>
    </div>
  );
};

export default FuturesContractPage;
