/**
 * AiExplanationPanel — кнопка «AI-разбор актива» + панель с структурированным ответом.
 *
 * Интегрирована в CoinDetailPage (docs/AI.md §7).
 * Вызывается ТОЛЬКО по явному действию пользователя (клик).
 * Не отправляет запрос при каждом market tick.
 *
 * Состояния:
 *   idle        — кнопка видна, AI не запрашивался
 *   loading     — запрос в полёте
 *   ok          — structured explanation отображается
 *   not_configured — AI_API_KEY не задан на сервере
 *   rejected    — grounding guard отклонил ответ LLM
 *   unavailable — ошибка сети / LLM недоступен
 *   timeout     — превышен таймаут
 *   rate_limited — rate limit
 */

import React, { useState, useCallback } from 'react';
import type { AiExplanation, AiExplainStatus } from '@/services/ai/AiOutputContract';
import { requestLlmExplanation, buildCoinDetailFacts } from '@/services/ai/LlmExplainClient';
import type { AssetDetail, FuturesAsset, RadarEvent, LiquidationData } from '@/types/market';

interface AiExplanationPanelProps {
  asset: AssetDetail;
  futures?: FuturesAsset | null;
  radarEvents?: RadarEvent[];
  liquidations?: LiquidationData | null;
}

type PanelState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; explanation: AiExplanation; model: string; generatedAt: string }
  | { phase: 'error'; status: AiExplainStatus; reason?: string };

const STATUS_LABELS: Record<AiExplainStatus, string> = {
  OK: '',
  NOT_CONFIGURED: 'AI не настроен на сервере',
  REJECTED: 'Ответ AI не прошёл проверку точности',
  UNAVAILABLE: 'AI временно недоступен',
  TIMEOUT: 'Превышен таймаут запроса',
  RATE_LIMITED: 'Превышен лимит запросов',
};

export const AiExplanationPanel: React.FC<AiExplanationPanelProps> = ({
  asset,
  futures,
  radarEvents,
  liquidations,
}) => {
  const [state, setState] = useState<PanelState>({ phase: 'idle' });

  const handleExplain = useCallback(async () => {
    setState({ phase: 'loading' });

    // Derive liquidation origin
    const liqOrigin = liquidations?.dataStatus === 'LIVE_STREAM' ? 'FACTUAL' as const
      : liquidations?.dataStatus === 'AWAITING_STREAM' ? 'UNAVAILABLE' as const
      : 'MODEL_ESTIMATED' as const;

    // Find futures for this asset
    const futuresData = futures;

    const facts = buildCoinDetailFacts({
      symbol: asset.symbol,
      price: asset.price,
      change24h: asset.change24h,
      change1h: asset.change1h ?? undefined,
      change7d: asset.change7d ?? undefined,
      volume24h: asset.volume24h,
      high24h: asset.high24h,
      low24h: asset.low24h,
      marketCap: asset.marketCap,
      source: asset.provenance?.exchange ?? 'binance',
      // Derivatives
      openInterest: futuresData?.openInterest ?? undefined,
      openInterestDelta24h: futuresData?.openInterestChange24h ?? undefined,
      fundingRate8h: futuresData?.fundingRate,
      basisPct: futuresData?.basisPct,
      markPrice: futuresData?.markPrice,
      indexPrice: futuresData?.indexPrice,
      derivativesOrigin: futuresData ? 'FACTUAL' : 'UNAVAILABLE',
      // Liquidations
      longLiquidations24h: futuresData?.longLiquidations24h,
      shortLiquidations24h: futuresData?.shortLiquidations24h,
      liquidationsOrigin: liqOrigin,
      // Indicators
      rsi14: asset.indicators?.rsi14,
      macd: asset.indicators?.macd,
      sma20: asset.indicators?.sma20,
      sma50: asset.indicators?.sma50,
      sma200: asset.indicators?.sma200,
      bollinger: asset.indicators?.bollinger
        ? { ...asset.indicators.bollinger }
        : undefined,
      indicatorsOrigin: asset.indicators ? 'DERIVED' : 'UNAVAILABLE',
      // Radar
      anomalies: radarEvents?.map((r) => ({
        type: r.type,
        metricValue: r.metricValue,
        severity: r.severity,
      })),
      radarOrigin: radarEvents && radarEvents.length > 0 ? 'FACTUAL' : 'UNAVAILABLE',
      // Models
      liquidationZones: undefined,
      heatmapAvailable: false,
      leverageTiersAvailable: false,
    });

    const result = await requestLlmExplanation(facts);

    switch (result.status) {
      case 'OK':
        setState({
          phase: 'ok',
          explanation: result.explanation!,
          model: result.model ?? '',
          generatedAt: result.generatedAt ?? '',
        });
        break;
      default:
        setState({ phase: 'error', status: result.status, reason: result.reason });
    }
  }, [asset, futures, radarEvents, liquidations]);

  return (
    <div className="mt-6 border border-slate-700/50 rounded-xl bg-slate-900/40 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <h3 className="text-sm font-medium text-slate-200">AI-разбор актива</h3>
          <span className="text-[11px] text-slate-500">β</span>
        </div>
        {state.phase === 'idle' && (
          <button
            onClick={handleExplain}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
            data-qa="ai-explain-button"
          >
            Объяснить данные
          </button>
        )}
      </div>

      {/* Loading state */}
      {state.phase === 'loading' && (
        <div className="flex items-center gap-2 py-4 text-slate-400 text-sm">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Анализ данных…</span>
        </div>
      )}

      {/* Error states */}
      {state.phase === 'error' && (
        <div className="py-3 px-4 rounded-lg bg-slate-800/60 border border-slate-700/40" data-qa="ai-error">
          <p className="text-sm text-amber-400">
            {STATUS_LABELS[state.status] ?? 'Неизвестная ошибка'}
          </p>
          {state.reason && (
            <p className="text-xs text-slate-500 mt-1">{state.reason}</p>
          )}
          {(state.status === 'UNAVAILABLE' || state.status === 'TIMEOUT' || state.status === 'RATE_LIMITED') && (
            <button
              onClick={handleExplain}
              className="mt-2 px-2 py-1 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Повторить
            </button>
          )}
        </div>
      )}

      {/* Success: structured explanation */}
      {state.phase === 'ok' && (
        <div className="space-y-3" data-qa="ai-explanation">
          {/* Summary */}
          <p className="text-sm text-slate-200 leading-relaxed">
            {state.explanation.summary}
          </p>

          {/* Key Observations */}
          {state.explanation.keyObservations.length > 0 && (
            <Section title="Ключевые наблюдения" items={state.explanation.keyObservations} color="cyan" />
          )}

          {/* Supporting Facts */}
          {state.explanation.supportingFacts.length > 0 && (
            <Section title="Поддерживающие факты" items={state.explanation.supportingFacts} color="emerald" />
          )}

          {/* Counter Evidence */}
          {state.explanation.counterEvidence.length > 0 && (
            <Section title="Альтернативные трактовки" items={state.explanation.counterEvidence} color="amber" />
          )}

          {/* Data Limitations */}
          {state.explanation.dataLimitations.length > 0 && (
            <Section title="Ограничения данных" items={state.explanation.dataLimitations} color="slate" />
          )}

          {/* Risk Notes */}
          {state.explanation.riskNotes.length > 0 && (
            <Section title="Наблюдения по риску" items={state.explanation.riskNotes} color="red" />
          )}

          {/* Meta */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-700/30">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>Сгенерировано AI</span>
              <span>·</span>
              <span>{state.model}</span>
              <span>·</span>
              <span>{new Date(state.generatedAt).toLocaleTimeString('ru-RU')}</span>
            </div>
            <button
              onClick={handleExplain}
              className="px-2 py-1 text-[11px] rounded bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              Обновить
            </button>
          </div>

          {/* Disclaimer */}
          <p className="text-[11px] text-slate-500 leading-tight">
            CRYPTORA — аналитический терминал. AI-разбор не является инвестиционной рекомендацией или торговым сигналом.
            Решения принимаются пользователем самостоятельно.
          </p>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------
const Section: React.FC<{ title: string; items: string[]; color: string }> = ({ title, items, color }) => {
  const bulletColors: Record<string, string> = {
    cyan: 'bg-cyan-400',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    slate: 'bg-slate-400',
    red: 'bg-red-400',
  };
  return (
    <div>
      <h4 className="text-xs font-medium text-slate-400 mb-1">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${bulletColors[color] ?? 'bg-slate-400'} shrink-0`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
