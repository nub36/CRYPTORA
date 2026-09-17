import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { DataSourceUnavailable } from '@/components/common/DataSourceUnavailable';
import { AssetDetail, OHLCV, Timeframe, FuturesAsset, RadarEvent } from '@/types/market';
import { formatCurrency, formatPercent, formatNumber } from '@/utils/formatters';
import { radarEventTypeLabel, radarSeverityLabel } from '@/utils/labels';
import { CandleChart } from '@/components/common/CandleChart';
import { Badge } from '@/components/common/Badge';
import { OrderBookL2 } from '@/components/market/OrderBookL2';
import { IndicatorEngine } from '@/services/indicators/IndicatorEngine';
import { LiquidationPulse } from '@/services/liquidations/LiquidationPulse';
import { AssetPulsePanel } from '@/components/market/AssetPulsePanel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { LiquidationData } from '@/types/market';
import { MemoryTimeSeriesRepository } from '@/services/storage/TimeSeriesRepository';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { OrderBookSnapshot } from '@/types/realtime';
import {
  Star,
  Layers,
  Activity,
  Radio,
  ChevronLeft,
  SlidersHorizontal,
  ArrowUpRight,
  Cpu,
  Wrench,
  Flame,
} from 'lucide-react';

export const CoinDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const { provider, watchlist, toggleWatchlist, livePrices, subscribeSymbol } = useMarketData();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [futuresData, setFuturesData] = useState<FuturesAsset | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [liquidations, setLiquidations] = useState<LiquidationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);

  // Высота основного графика: доминирующий элемент рабочей области на desktop,
  // компактнее на мобильных. Значения детерминированы и не зависят от случайности.
  const isDesktopWorkspace = useMediaQuery('(min-width: 1280px)');
  const chartHeight = isDesktopWorkspace ? 460 : 340;

  useEffect(() => {
    if (symbol) {
      subscribeSymbol(symbol);
      const feed = RealtimeFeedManager.getInstance();
      feed.subscribeDepth(symbol);

      const unsubDepth = feed.eventBus.subscribe<OrderBookSnapshot>(
        `depth:${symbol.toUpperCase()}`,
        (snapshot) => {
          setOrderBook(snapshot);
        }
      );

      return () => unsubDepth();
    }
  }, [symbol, subscribeSymbol]);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setSourceUnavailable(false);

    async function fetchData() {
      try {
        const [detail, candleList, ftrs, rdr, liqs] = await Promise.all([
          provider.getAssetDetail(symbol || 'BTC'),
          provider.getCandles(symbol || 'BTC', timeframe),
          provider.getFuturesList(),
          provider.getRadarEvents(symbol || 'BTC'),
          provider.getLiquidations(),
        ]);

        setAsset(detail);
        setCandles(candleList);
        if (candleList.length > 0) {
          MemoryTimeSeriesRepository.getInstance().saveCandles(symbol || 'BTC', timeframe, candleList);
        }

        const matchFutures = ftrs.find(
          (f) => f.symbol.split('/')[0].toUpperCase() === (symbol || '').toUpperCase()
        );
        setFuturesData(matchFutures || null);
        setRadarEvents(rdr);
        setLiquidations(liqs);
      } catch {
        // LIVE-FIRST: актив не получен от источника — честное состояние без демо-подстановки.
        setSourceUnavailable(true);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [symbol, provider]);

  useEffect(() => {
    if (symbol) {
      provider.getCandles(symbol, timeframe).then((cl) => {
        setCandles(cl);
        if (cl.length > 0) {
          MemoryTimeSeriesRepository.getInstance().saveCandles(symbol, timeframe, cl);
        }
      });
    }
  }, [symbol, timeframe, provider]);

  const dynamicIndicators = useMemo(() => {
    if (candles.length > 0) {
      return IndicatorEngine.computeCompleteIndicators(candles);
    }
    return asset?.indicators;
  }, [candles, asset]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-sans text-sm">
        <Activity className="w-5 h-5 animate-spin mr-2 text-brand-cyan" />
        Загрузка аналитики монеты {symbol}...
      </div>
    );
  }

  if (!asset && sourceUnavailable) {
    return (
      <div className="mx-auto my-12 max-w-2xl px-4">
        <DataSourceUnavailable subject={`данные по инструменту ${symbol}`} />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-surface border border-surface-border rounded-lg text-center space-y-3">
        <h2 className="text-lg font-bold text-white font-sans">Актив не найден</h2>
        <p className="text-[13px] text-slate-400">
          Инструмент «{symbol}» отсутствует в реестре инструментов терминала.
        </p>
        <Link
          to="/market"
          className="inline-flex items-center space-x-1 text-xs text-brand-cyan hover:underline font-sans"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Вернуться к списку рынка</span>
        </Link>
      </div>
    );
  }

  const isStarred = watchlist.includes(asset.symbol);
  const livePrice = symbol ? livePrices[symbol.toUpperCase()] : undefined;
  const currentPrice = livePrice !== undefined ? livePrice : asset.price;

  // Снимок «ликвидации + деривативы» строго по текущему активу.
  // Источник данных определяется провайдером: фактические события, демо-набор или
  // модельная оценка — с явной маркировкой происхождения в UI.
  const pulse = LiquidationPulse.buildAssetPulse({
    symbol: asset.symbol,
    liquidations,
    futures: futuresData,
    priceChange24h: asset.change24h,
  });

  return (
    <div className="mx-auto max-w-[1920px] space-y-3.5 px-3 py-3 sm:px-4">
      {/* Breadcrumbs & Back */}
      <div className="flex items-center justify-between font-mono text-[13px] text-slate-400">
        <div className="flex items-center space-x-2">
          <Link to="/market" className="hover:text-white flex items-center space-x-1">
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Рынок</span>
          </Link>
          <span>/</span>
          <span className="text-white font-bold">{asset.symbol}</span>
        </div>

        <div className="flex items-center space-x-2">
          {!asset.isDemo ? (
            <Badge variant="green" size="xs">
              LIVE SPOT: {asset.provenance?.exchange.toUpperCase() || 'BINANCE'}{asset.provenance?.isFallback ? ' (FALLBACK)' : ''}
            </Badge>
          ) : (
            <Badge variant="demo" size="xs">
              QA-ДАТАСЕТ
            </Badge>
          )}
        </div>
      </div>

      {/* Asset Header Card */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center font-sans font-bold text-lg text-brand-cyan shadow-md">
            {asset.symbol.slice(0, 3)}
          </div>

          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl sm:text-2xl font-bold font-sans text-white">
                {asset.name}
              </h1>
              <span className="text-sm font-mono text-slate-400 font-semibold">
                {asset.symbol}
              </span>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-sans">
                Ранг #{asset.rank}
              </span>
              <span className="text-xs bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded font-sans uppercase">
                {asset.category}
              </span>
            </div>

            <p className="mt-1 max-w-3xl font-sans text-[13px] text-slate-400">
              {asset.description}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-6 self-start md:self-auto">
          <div className="text-right font-mono">
            <div className="text-2xl font-black text-white flex items-center justify-end space-x-1.5">
              {livePrice !== undefined && (
                <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse inline-block" title="Тик реального времени (WebSocket)" />
              )}
              <span>{formatCurrency(currentPrice, { decimals: currentPrice > 10 ? 2 : 4 })}</span>
            </div>
            <div className="flex items-center justify-end space-x-2 mt-0.5">
              <span
                className={`text-xs font-bold ${
                  asset.change24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                24h: {formatPercent(asset.change24h)}
              </span>
              <span className="text-slate-600 text-xs">•</span>
              <span
                className={`text-xs font-semibold ${
                  asset.change1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                1h: {formatPercent(asset.change1h)}
              </span>
            </div>
          </div>

          <button
            onClick={() => toggleWatchlist(asset.symbol)}
            className={`p-2.5 rounded border transition-colors ${
              isStarred
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'bg-surface-elevated border-surface-border text-slate-400 hover:text-white'
            }`}
            title={isStarred ? 'Удалить из избранного' : 'Добавить в избранное'}
          >
            <Star className={`w-5 h-5 ${isStarred ? 'fill-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Quick Action Navigation Bar */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Link
          to="/strategies"
          className="px-3 py-1.5 bg-surface border border-surface-border hover:border-brand-purple text-slate-300 hover:text-white rounded transition-colors flex items-center space-x-1.5"
        >
          <Cpu className="w-3.5 h-3.5 text-brand-purple" />
          <span>Симуляция в лаборатории стратегий</span>
        </Link>
        <Link
          to="/tools"
          className="px-3 py-1.5 bg-surface border border-surface-border hover:border-brand-cyan text-slate-300 hover:text-white rounded transition-colors flex items-center space-x-1.5"
        >
          <Wrench className="w-3.5 h-3.5 text-brand-cyan" />
          <span>Калькуляторы риска & DCA</span>
        </Link>
        <Link
          to="/liquidations"
          className="px-3 py-1.5 bg-surface border border-surface-border hover:border-rose-500 text-slate-300 hover:text-white rounded transition-colors flex items-center space-x-1.5"
        >
          <Flame className="w-3.5 h-3.5 text-rose-400" />
          <span>Кластеры ликвидаций</span>
        </Link>
      </div>

      {/* Analytical Workspace: доминирующий график + снимок деривативов/ликвидаций.
          Двухколоночная раскладка включается от 1280px; ниже Pulse складывается под график. */}
      <div
        data-qa="coin-workspace"
        className="grid grid-cols-1 xl:grid-cols-[72fr_28fr] gap-3.5 items-start"
      >
      <div data-qa="coin-chart-card" className="space-y-3 rounded-lg border border-surface-border bg-surface p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
          <div className="flex items-center space-x-3">
            <span className="font-sans font-bold text-sm text-white">
              {asset.symbol}/USDT Свечной график
            </span>
            <div className="hidden sm:flex items-center space-x-2 text-xs font-sans text-slate-400">
              <span>Макс. 24ч: <strong className="text-slate-200 font-mono tabular-nums">{formatCurrency(asset.high24h)}</strong></span>
              <span>Мин. 24ч: <strong className="text-slate-200 font-mono tabular-nums">{formatCurrency(asset.low24h)}</strong></span>
            </div>
          </div>

          {/* Timeframe buttons */}
          <div className="flex items-center space-x-1 font-sans text-xs bg-surface-elevated p-1 rounded border border-surface-border self-start sm:self-auto">
            {(['15m', '1h', '4h', '1D', '1W'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-brand-cyan text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive TradingView Lightweight Chart */}
        <CandleChart data={candles} symbol={`${asset.symbol}/USDT`} height={chartHeight} />
      </div>

        <div className="xl:sticky xl:top-[70px]">
          <AssetPulsePanel pulse={pulse} />
        </div>
      </div>

      {/* Stats Grid: Market Metrics, Derivatives, Technical Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Key Market Stats */}
        <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <Activity className="w-4 h-4 text-brand-cyan" />
            <span className="text-[13px] font-bold tracking-wide text-white">
              Рыночная статистика
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Капитализация</span>
              <span className="font-bold text-white font-mono tabular-nums">{formatCurrency(asset.marketCap)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Объём торгов 24ч</span>
              <span className="font-bold text-white font-mono tabular-nums">{formatCurrency(asset.volume24h)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">В обращении</span>
              <span className="text-slate-200 font-mono tabular-nums">
                {formatNumber(asset.circulatingSupply, { compact: true })} {asset.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Исторический максимум (ATH)</span>
              <span className="text-slate-200 font-mono tabular-nums">
                {formatCurrency(asset.ath)} ({asset.athDate})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Исторический минимум (ATL)</span>
              <span className="text-slate-200 font-mono tabular-nums">
                {formatCurrency(asset.atl)} ({asset.atlDate})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Динамика за 7 дней</span>
              <span
                className={`font-bold ${
                  asset.change7d >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {formatPercent(asset.change7d)}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Futures & Derivatives Snapshot */}
        <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <Layers className="w-4 h-4 text-brand-purple" />
            <span className="text-[13px] font-bold tracking-wide text-white">
              Деривативы: детали контракта
            </span>
          </div>

          {futuresData ? (
            <div className="space-y-2 text-xs">
              {/* Детализация без дублей со снимком Pulse: там OI, OI Δ24ч и фандинг 8ч,
                  здесь — остальные метрики контракта и производные показатели. */}
              <div className="flex justify-between">
                <span className="text-slate-400">Метка / индексная цена</span>
                <span className="font-bold text-white font-mono tabular-nums">
                  {formatCurrency(futuresData.markPrice, { decimals: futuresData.markPrice > 10 ? 2 : 4 })} /{' '}
                  {formatCurrency(futuresData.indexPrice, { decimals: futuresData.indexPrice > 10 ? 2 : 4 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Спред метки к индексу</span>
                <span className="text-slate-200 tabular-nums font-mono">
                  {formatCurrency(futuresData.markPrice - futuresData.indexPrice, {
                    decimals: futuresData.markPrice > 10 ? 2 : 4,
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Прогноз фандинга (8h)</span>
                <span
                  className={`font-bold tabular-nums  font-mono${
                    futuresData.predictedFundingRate >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {futuresData.predictedFundingRate >= 0 ? '+' : ''}
                  {futuresData.predictedFundingRate.toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Годовой фандинг (APR)</span>
                <span className="text-slate-200 font-semibold tabular-nums font-mono">
                  {formatPercent(futuresData.annualizedFundingRate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">OI Δ за 1 час</span>
                <span
                  className={`font-bold tabular-nums  font-mono${
                    futuresData.openInterestChange1h >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {formatPercent(futuresData.openInterestChange1h)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Суточный фьючерсный объем</span>
                <span className="text-slate-200 tabular-nums font-mono">
                  {formatCurrency(futuresData.futuresVolume24h, { compact: true })}
                </span>
              </div>
              <Link
                to="/futures"
                className="inline-flex items-center space-x-1 text-[11px] text-brand-cyan hover:underline pt-1"
              >
                <span>Все фьючерсы и фандинг</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="py-8 text-center text-[13px] text-slate-500">
              Нет активного фьючерсного бессрочного контракта в демо-выборке.
            </div>
          )}
        </div>

        {/* Card 3: Technical Indicators Snapshot */}
        <div className="bg-surface border border-surface-border rounded-lg p-3.5 space-y-2.5 font-sans">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <SlidersHorizontal className="w-4 h-4 text-brand-sky" />
            <span className="text-[13px] font-bold tracking-wide text-white">
              Технические индикаторы
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">RSI (14)</span>
              <span
                className={`font-bold ${
                  (dynamicIndicators?.rsi14 ?? 50) >= 70
                    ? 'text-rose-400'
                    : (dynamicIndicators?.rsi14 ?? 50) <= 30
                    ? 'text-emerald-400'
                    : 'text-brand-cyan'
                }`}
              >
                {(dynamicIndicators?.rsi14 ?? 50).toFixed(1)}{' '}
                <span className="text-[11px] font-normal text-slate-400">
                  {(dynamicIndicators?.rsi14 ?? 50) >= 70
                    ? '(Перекуплен)'
                    : (dynamicIndicators?.rsi14 ?? 50) <= 30
                    ? '(Перепродан)'
                    : '(Нейтрально)'}
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Гистограмма MACD</span>
              <span
                className={`font-bold ${
                  (dynamicIndicators?.macd?.hist ?? 0) >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {(dynamicIndicators?.macd?.hist ?? 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SMA (20 / 50 / 200)</span>
              <span className="text-slate-200 font-mono tabular-nums">
                {formatCurrency(dynamicIndicators?.sma20 ?? 0, { compact: true })} /{' '}
                {formatCurrency(dynamicIndicators?.sma50 ?? 0, { compact: true })} /{' '}
                {formatCurrency(dynamicIndicators?.sma200 ?? 0, { compact: true })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Полосы Боллинджера (верх / низ)</span>
              <span className="text-xs text-slate-400 font-mono tabular-nums">
                {formatCurrency(dynamicIndicators?.bollinger?.upper ?? 0, { compact: true })} /{' '}
                {formatCurrency(dynamicIndicators?.bollinger?.lower ?? 0, { compact: true })}
              </span>
            </div>
            {dynamicIndicators && 'atr14' in dynamicIndicators && (
              <div className="flex justify-between">
                <span className="text-slate-400">ATR (14) / VWAP</span>
                <span className="text-xs text-brand-cyan">
                  ±{formatCurrency((dynamicIndicators as any).atr14, { compact: true })} /{' '}
                  {formatCurrency((dynamicIndicators as any).vwap, { compact: true })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Book L2, Trading Pairs & Radar Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Order Book L2 Column */}
        <div className="lg:col-span-1 min-h-[380px]">
          <OrderBookL2
            orderBook={orderBook}
            currentPrice={currentPrice}
            symbol={asset.symbol}
          />
        </div>

        {/* Pairs and Radar in 2-column layout */}
        <div className="lg:col-span-2 space-y-4">
          {/* Trading Pairs Table */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-surface-border">
              <span className="font-sans text-[13px] font-bold tracking-wide text-white">
                {asset.isDemo ? 'Пары на ведущих биржах (QA-датасет)' : 'Пары на ведущих биржах (Spot Market)'}
              </span>
              <span className="text-[11px] font-sans text-slate-400">Биржевая глубина</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="border-b border-surface-border text-xs text-slate-400">
                  <tr>
                    <th className="py-2 text-left">Биржа</th>
                    <th className="py-2 text-left">Пара</th>
                    <th className="py-2 text-right">Цена</th>
                    <th className="py-2 text-right">24h Объем</th>
                    <th className="py-2 text-right">Спред %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {asset.pairs.map((p, idx) => (
                    <tr key={idx} className="hover:bg-surface-hover">
                      <td className="py-2 text-white font-semibold">{p.exchange}</td>
                      <td className="py-2 text-brand-cyan">{p.pair}</td>
                      <td className="py-2 text-right font-mono tabular-nums">{formatCurrency(p.price)}</td>
                      <td className="py-2 text-right text-slate-400 font-mono tabular-nums">
                        {formatCurrency(p.volume24h, { compact: true })}
                      </td>
                      <td className="py-2 text-right text-slate-400">{p.spreadPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Radar events for this coin */}
          <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-surface-border">
              <div className="flex items-center space-x-2">
                <Radio className="w-4 h-4 text-brand-cyan" />
                <span className="font-sans text-[13px] font-bold tracking-wide text-white">
                  События Market Radar по {asset.symbol}
                </span>
              </div>
              <Link
                to="/radar"
                className="flex items-center space-x-1 font-sans text-xs text-brand-cyan hover:underline"
              >
                <span>Все аномалии</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {radarEvents.length === 0 ? (
              <div className="py-6 text-center font-sans text-[13px] text-slate-500">
                По инструменту {asset.symbol} активных аномалий не зафиксировано.
              </div>
            ) : (
              <div className="space-y-2 font-sans">
                {radarEvents.map((re) => (
                  <div
                    key={re.id}
                    className="p-2.5 rounded bg-surface-elevated border border-surface-border text-xs flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center space-x-2">
                      <Badge
                        variant={
                          re.severity === 'HIGH' ? 'red' : re.severity === 'MEDIUM' ? 'amber' : 'cyan'
                        }
                        size="xs"
                      >
                        {radarSeverityLabel(re.severity)}
                      </Badge>
                      <span className="text-white font-semibold">{radarEventTypeLabel(re.type)}</span>
                      <span className="hidden text-xs text-slate-400 sm:inline">
                        {re.observation}
                      </span>
                    </div>
                    <span className="text-brand-cyan font-bold whitespace-nowrap">
                      {re.metricValue}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
