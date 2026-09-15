import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMarketData } from '@/context/MarketDataContext';
import { AssetDetail, OHLCV, Timeframe, FuturesAsset, RadarEvent } from '@/types/market';
import { formatCurrency, formatPercent, formatNumber, formatTimestamp } from '@/utils/formatters';
import { CandleChart } from '@/components/common/CandleChart';
import { Badge } from '@/components/common/Badge';
import {
  Star,
  Layers,
  Activity,
  Radio,
  ChevronLeft,
  SlidersHorizontal,
} from 'lucide-react';

export const CoinDetailPage: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const { provider, watchlist, toggleWatchlist, livePrices, subscribeSymbol } = useMarketData();

  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [futuresData, setFuturesData] = useState<FuturesAsset | null>(null);
  const [radarEvents, setRadarEvents] = useState<RadarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (symbol) {
      subscribeSymbol(symbol);
    }
  }, [symbol, subscribeSymbol]);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);

    async function fetchData() {
      try {
        const [detail, candleList, ftrs, rdr] = await Promise.all([
          provider.getAssetDetail(symbol || 'BTC'),
          provider.getCandles(symbol || 'BTC', timeframe),
          provider.getFuturesList(),
          provider.getRadarEvents(symbol || 'BTC'),
        ]);

        setAsset(detail);
        setCandles(candleList);
        const matchFutures = ftrs.find(
          (f) => f.symbol.split('/')[0].toUpperCase() === (symbol || '').toUpperCase()
        );
        setFuturesData(matchFutures || null);
        setRadarEvents(rdr);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [symbol, provider]);

  useEffect(() => {
    if (symbol) {
      provider.getCandles(symbol, timeframe).then(setCandles);
    }
  }, [symbol, timeframe, provider]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-mono text-sm">
        <Activity className="w-5 h-5 animate-spin mr-2 text-brand-cyan" />
        Загрузка аналитики монеты {symbol}...
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 bg-surface border border-surface-border rounded-lg text-center space-y-3">
        <h2 className="text-lg font-bold text-white font-mono">Актив не найден</h2>
        <p className="text-xs text-slate-400">
          Инструмент «{symbol}» не зарегистрирован в демонстрационной базе данных.
        </p>
        <Link
          to="/market"
          className="inline-flex items-center space-x-1 text-xs text-brand-cyan hover:underline font-mono"
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

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto px-3 sm:px-4 py-3">
      {/* Breadcrumbs & Back */}
      <div className="flex items-center justify-between text-xs font-mono text-slate-400">
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
              ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ
            </Badge>
          )}
        </div>
      </div>

      {/* Asset Header Card */}
      <div className="bg-surface border border-surface-border rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center font-mono font-bold text-lg text-brand-cyan shadow-md">
            {asset.symbol.slice(0, 3)}
          </div>

          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl sm:text-2xl font-bold font-mono text-white">
                {asset.name}
              </h1>
              <span className="text-sm font-mono text-slate-400 font-semibold">
                {asset.symbol}
              </span>
              <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                Ранг #{asset.rank}
              </span>
              <span className="text-xs bg-brand-cyan/10 text-brand-cyan px-2 py-0.5 rounded font-mono uppercase">
                {asset.category}
              </span>
            </div>

            <p className="text-xs text-slate-400 font-sans mt-1 max-w-2xl line-clamp-1">
              {asset.description}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-6 self-start md:self-auto">
          <div className="text-right font-mono">
            <div className="text-2xl font-black text-white flex items-center justify-end space-x-1.5">
              {livePrice !== undefined && (
                <span className="w-2 h-2 rounded-full bg-brand-green animate-pulse inline-block" title="Realtime WebSocket Tick" />
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

      {/* Main Chart + Timeframes Row */}
      <div className="bg-surface border border-surface-border rounded-lg p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-surface-border gap-2">
          <div className="flex items-center space-x-3">
            <span className="font-mono font-bold text-sm text-white">
              {asset.symbol}/USDT Свечной график
            </span>
            <div className="hidden sm:flex items-center space-x-2 text-xs font-mono text-slate-400">
              <span>24h High: <strong className="text-slate-200">{formatCurrency(asset.high24h)}</strong></span>
              <span>24h Low: <strong className="text-slate-200">{formatCurrency(asset.low24h)}</strong></span>
            </div>
          </div>

          {/* Timeframe buttons */}
          <div className="flex items-center space-x-1 font-mono text-xs bg-surface-elevated p-1 rounded border border-surface-border self-start sm:self-auto">
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
        <CandleChart data={candles} symbol={`${asset.symbol}/USDT`} height={380} />
      </div>

      {/* Stats Grid: Market Metrics, Derivatives, Technical Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Key Market Stats */}
        <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3 font-mono">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <Activity className="w-4 h-4 text-brand-cyan" />
            <span className="font-bold text-xs uppercase tracking-wider text-white">
              Рыночная статистика
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Капитализация (Market Cap)</span>
              <span className="font-bold text-white">{formatCurrency(asset.marketCap)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">24h Объем торгов</span>
              <span className="font-bold text-white">{formatCurrency(asset.volume24h)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">В обращении (Circulating)</span>
              <span className="text-slate-200">
                {formatNumber(asset.circulatingSupply, { compact: true })} {asset.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">All-Time High (ATH)</span>
              <span className="text-slate-200">
                {formatCurrency(asset.ath)} ({asset.athDate})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">All-Time Low (ATL)</span>
              <span className="text-slate-200">
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
        <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3 font-mono">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <Layers className="w-4 h-4 text-brand-purple" />
            <span className="font-bold text-xs uppercase tracking-wider text-white">
              Деривативы и фьючерсы
            </span>
          </div>

          {futuresData ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Mark Price</span>
                <span className="font-bold text-white">
                  {formatCurrency(futuresData.markPrice, { decimals: futuresData.markPrice > 10 ? 2 : 4 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ставка финансирования (8h)</span>
                <span
                  className={`font-bold ${
                    futuresData.fundingRate >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {futuresData.fundingRate >= 0 ? '+' : ''}
                  {(futuresData.fundingRate).toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Годовой фандинг (APR)</span>
                <span className="text-slate-200 font-semibold">
                  {formatPercent(futuresData.annualizedFundingRate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Открытый интерес (OI)</span>
                <span className="font-bold text-white">
                  {formatCurrency(futuresData.openInterest, { compact: true })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">OI Δ за 24 часа</span>
                <span
                  className={`font-bold ${
                    futuresData.openInterestChange24h >= 0 ? 'text-brand-green' : 'text-brand-red'
                  }`}
                >
                  {formatPercent(futuresData.openInterestChange24h)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Суточный фьючерсный объем</span>
                <span className="text-slate-200">
                  {formatCurrency(futuresData.futuresVolume24h, { compact: true })}
                </span>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-slate-500 text-xs">
              Нет активного фьючерсного бессрочного контракта в демо-выборке.
            </div>
          )}
        </div>

        {/* Card 3: Technical Indicators Snapshot */}
        <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3 font-mono">
          <div className="flex items-center space-x-2 pb-2 border-b border-surface-border">
            <SlidersHorizontal className="w-4 h-4 text-brand-sky" />
            <span className="font-bold text-xs uppercase tracking-wider text-white">
              Технические индикаторы
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">RSI (14)</span>
              <span
                className={`font-bold ${
                  asset.indicators.rsi14 >= 70
                    ? 'text-rose-400'
                    : asset.indicators.rsi14 <= 30
                    ? 'text-emerald-400'
                    : 'text-brand-cyan'
                }`}
              >
                {asset.indicators.rsi14.toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">MACD Histogram</span>
              <span
                className={`font-bold ${
                  asset.indicators.macd.hist >= 0 ? 'text-brand-green' : 'text-brand-red'
                }`}
              >
                {asset.indicators.macd.hist.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SMA (20)</span>
              <span className="text-slate-200">{formatCurrency(asset.indicators.sma20)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SMA (50)</span>
              <span className="text-slate-200">{formatCurrency(asset.indicators.sma50)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">SMA (200)</span>
              <span className="text-slate-200">{formatCurrency(asset.indicators.sma200)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bollinger Upper/Lower</span>
              <span className="text-slate-400 text-[11px]">
                {formatCurrency(asset.indicators.bollinger.upper, { compact: true })} /{' '}
                {formatCurrency(asset.indicators.bollinger.lower, { compact: true })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Trading Pairs & Radar Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trading Pairs Table */}
        <div className="bg-surface border border-surface-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-surface-border">
            <span className="font-mono font-bold text-xs uppercase tracking-wider text-white">
              Демо-пары на ведущих биржах
            </span>
            <span className="text-[10px] font-mono text-slate-500">Spot Market</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-slate-400 text-[11px] border-b border-surface-border">
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
                    <td className="py-2 text-right">{formatCurrency(p.price)}</td>
                    <td className="py-2 text-right text-slate-400">
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
              <span className="font-mono font-bold text-xs uppercase tracking-wider text-white">
                События Market Radar по {asset.symbol}
              </span>
            </div>
            <Link
              to="/radar"
              className="text-[11px] font-mono text-brand-sky hover:underline"
            >
              Все события →
            </Link>
          </div>

          {radarEvents.length === 0 ? (
            <div className="py-8 text-center text-slate-500 font-mono text-xs">
              Для актива {asset.symbol} в текущем окне аномалий не зафиксировано.
            </div>
          ) : (
            <div className="space-y-2">
              {radarEvents.map((e) => (
                <div
                  key={e.id}
                  className="p-2.5 rounded bg-surface-elevated border border-surface-border text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-mono">
                    <Badge variant={e.severity === 'HIGH' ? 'red' : 'amber'} size="xs">
                      {e.type}
                    </Badge>
                    <span className="text-[10px] text-slate-400">
                      {formatTimestamp(e.timestamp)}
                    </span>
                  </div>
                  <div className="font-mono text-brand-cyan font-bold">{e.metricValue}</div>
                  <p className="text-[11px] text-slate-300 font-sans">{e.observation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
