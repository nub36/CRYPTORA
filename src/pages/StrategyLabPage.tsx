/**
 * CRYPTORA — Strategy Lab (страница /strategy-lab, Phase 2A)
 * ---------------------------------------------------------------------------
 * ВИЗУАЛЬНЫЙ КОНСТРУКТОР СТРАТЕГИЙ (RESEARCH ONLY, ADMIN ONLY).
 * Изолированный исследовательский раздел для создания стратегий из индикаторов.
 * Не изменяет production-стратегии (V2.8/V3.0/V3.3/V3.4), сигналы, settings, scheduler и БД.
 *
 * Двухуровневая защита: клиентский guard (useAuth().isAdmin) + серверный (requireAuth, requireAdmin).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, ShieldAlert, Activity, Info } from 'lucide-react';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { useAuth } from '@/context/AuthContext';
import { defaultDraftDefinition } from '@/services/strategyLab/registry';
import type {
  LabReplayResult,
  LabTrade,
  StrategyDraftDefinition,
} from '@/services/strategyLab/types';
import {
  runLabBacktest,
  fetchLabDataCoverage,
  LabApiError,
  type LabDataCoverage,
} from '@/services/strategyLab/labClient';
import { LabControls, type LabControlsState } from '@/components/strategyLab/LabControls';
import { LabConstructor } from '@/components/strategyLab/LabConstructor';
import { LabChart } from '@/components/strategyLab/LabChart';
import { LabTester, type LabTab } from '@/components/strategyLab/LabTester';
import { LabTutorialButton } from '@/components/strategyLab/LabTutorialButton';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

const CompactResearchBadge: React.FC = () => (
  <div className="inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200">
    <Info className="h-3.5 w-3.5 text-amber-400 shrink-0" />
    <span>
      <span className="font-bold text-amber-300">ИССЛЕДОВАНИЕ:</span> Не влияет на рабочие стратегии
    </span>
  </div>
);

export const StrategyLabPage: React.FC = () => {
  const { isAdmin, isLoading: authLoading } = useAuth();

  const [controls, setControls] = useState<LabControlsState>(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    return {
      market: 'spot',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      from: toLocalInput(from),
      to: toLocalInput(now),
    };
  });

  const [definition, setDefinition] = useState<StrategyDraftDefinition>(() =>
    defaultDraftDefinition('EMA 20/50 Cross + ATR Stop')
  );

  const [result, setResult] = useState<LabReplayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<LabDataCoverage | null>(null);
  const [tab, setTab] = useState<LabTab>('overview');
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedTrade: LabTrade | null = useMemo(
    () => result?.trades.find((t) => t.id === selectedTradeId) ?? null,
    [result, selectedTradeId]
  );

  const handleControlChange = useCallback(
    <K extends keyof LabControlsState>(key: K, v: LabControlsState[K]) => {
      setControls((prev) => ({ ...prev, [key]: v }));
    },
    []
  );

  // Создать чистый draft новой стратегии
  const handleNewStrategy = useCallback(() => {
    setDefinition(defaultDraftDefinition('Новая стратегия'));
    setResult(null);
    setError(null);
    setSelectedTradeId(null);
  }, []);

  const handleRun = useCallback(async () => {
    setError(null);
    const fromMs = new Date(controls.from).getTime();
    const toMs = new Date(controls.to).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      setError('Укажите корректные даты диапазона.');
      return;
    }
    if (!(fromMs < toMs)) {
      setError('Дата «От» должна быть строго раньше даты «До».');
      return;
    }
    if (!controls.symbol.trim()) {
      setError('Выберите или укажите монету.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setSelectedTradeId(null);
    try {
      const res = await runLabBacktest(
        {
          strategyDefinition: definition,
          market: controls.market,
          symbol: controls.symbol.trim().toUpperCase(),
          timeframe: controls.timeframe,
          from: fromMs,
          to: toMs,
        },
        controller.signal
      );
      setResult(res);
      setTab('overview');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      const msg = e instanceof LabApiError ? e.message : 'Не удалось выполнить бэктест.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [controls, definition]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (authLoading || !isAdmin) {
      setCoverage(null);
      return;
    }
    const controller = new AbortController();
    fetchLabDataCoverage(controller.signal)
      .then(setCoverage)
      .catch((coverageError: unknown) => {
        if ((coverageError as Error)?.name !== 'AbortError') {
          setCoverage({ datasetAvailable: false });
        }
      });
    return () => controller.abort();
  }, [authLoading, isAdmin]);

  // ── Guard ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        <Activity className="mr-2 h-5 w-5 animate-spin text-brand-cyan" />
        Загрузка…
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-slate-500" />
        <p className="text-slate-400">Доступ запрещён</p>
        <p className="text-[12px] text-slate-500">Лаборатория доступна только администраторам.</p>
      </div>
    );
  }

  return (
    <div
      className="route-shell mx-auto w-full min-w-0 max-w-[1600px] px-3 py-4 sm:px-4 sm:py-6"
      data-route="strategy-lab"
      data-qa="strategy-lab-shell"
    >
      <TerminalSection
        label="ЛАБОРАТОРИЯ"
        title="Конструктор стратегий"
        meta="исследование"
        className="strategy-lab-command-bar"
      >
        {/* 1. Компактный Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-cyan-400" />
              <div>
                <h1 className="text-xl font-bold text-white">Лаборатория стратегий</h1>
                <p className="text-[12px] text-slate-400">
                  Визуальный конструктор и историческое тестирование стратегий.
                </p>
              </div>
            </div>
            <CompactResearchBadge />
          </div>
          <LabTutorialButton />
        </div>

        {/* 2. Основные действия и выбор монеты/таймфрейма */}
        <div className="mb-4">
          <LabControls
            value={controls}
            onChange={handleControlChange}
            onNewStrategy={handleNewStrategy}
            onRun={handleRun}
            loading={loading}
            coverage={coverage}
          />
        </div>

        {/* Ошибки и примечания */}
        {error && (
          <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">
            {error}
          </div>
        )}

        {result?.meta.notes && result.meta.notes.length > 0 && (
          <div className="mb-4 rounded-md border border-slate-500/30 bg-slate-500/10 px-3 py-2 text-[12px] text-slate-300">
            {result.meta.notes.join(' ')}
          </div>
        )}

        {/* 3. ГРАФИК — ГЛАВНЫЙ ЭЛЕМЕНТ (находится ВЫШЕ настроек) */}
        <div className="mb-4">
          <LabChart
            result={result}
            selectedTrade={selectedTrade}
            onSelectTrade={setSelectedTradeId}
          />
        </div>

        {/* 4. Конструктор стратегии и Результаты бэктеста */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Конструктор стратегии */}
          <div className="min-w-0">
            <LabConstructor
              definition={definition}
              onChange={setDefinition}
              disabled={loading}
            />
          </div>

          {/* Результаты бэктеста */}
          <div className="min-w-0">
            <LabTester
              result={result}
              tab={tab}
              onTabChange={setTab}
              selectedTradeId={selectedTradeId}
              onSelectTrade={setSelectedTradeId}
            />
          </div>
        </div>
      </TerminalSection>
    </div>
  );
};

export default StrategyLabPage;
