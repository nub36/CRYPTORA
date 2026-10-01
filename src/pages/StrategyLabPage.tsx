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
import { createEmaTrendTemplate } from '@/services/strategyLab/graph/templates';
import { validateStrategyGraph } from '@/services/strategyLab/graph/validate';
import { compileGraphToDraftDefinition } from '@/services/strategyLab/graph/compile';
import type {
  LabAuthoringMode,
  StrategyGraph,
} from '@/services/strategyLab/graph/types';
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
import { LabAuthoringModeSwitch } from '@/components/strategyLab/LabAuthoringModeSwitch';
import { LabBlockEditor } from '@/components/strategyLab/blocks/LabBlockEditor';
import { LabCodeEditor } from '@/components/strategyLab/code/LabCodeEditor';
import { EMA_TREND_CODE } from '@/services/strategyLab/code/templates';
import { codeToGraph, graphToCode } from '@/services/strategyLab/code';

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

  /*
   * §23: у каждого режима СВОЙ черновик. Переключение режима не
   * переинтерпретирует стратегию молча — простой конструктор продолжает
   * работать с `StrategyDraftDefinition`, блок-схема — со `StrategyGraph`.
   */
  const [authoringMode, setAuthoringMode] = useState<LabAuthoringMode>('blocks');
  const [sourceCode, setSourceCode] = useState(EMA_TREND_CODE);
  const [codeErrors, setCodeErrors] = useState<any[]>([]);

  const [definition, setDefinition] = useState<StrategyDraftDefinition>(() =>
    defaultDraftDefinition('EMA 20/50 Cross + ATR Stop')
  );

  const [graph, setGraph] = useState<StrategyGraph>(() => createEmaTrendTemplate());

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

  const isBlocksMode = authoringMode === 'blocks';
  const isCodeMode = authoringMode === 'code';
  const handleCodeChange = (value: string) => { setSourceCode(value); };
  const validateCode = () => { const r = codeToGraph(sourceCode); setCodeErrors(r.errors); return r; };
  const showCodeAsBlocks = () => { const r = validateCode(); if (r.graph) { setGraph(r.graph); setAuthoringMode('blocks'); } };
  const openBlocksAsCode = () => { try { setSourceCode(graphToCode(graph)); setCodeErrors([]); setAuthoringMode('code'); } catch (e) { setError(e instanceof Error ? e.message : 'Граф нельзя представить в режиме КОД.'); } };

  /* Тот же валидатор, что независимо исполняет сервер (§10). */
  const graphValidation = useMemo(() => validateStrategyGraph(graph), [graph]);

  /*
   * Компиляция графа в декларативное определение — ЧИСТОЕ преобразование
   * данных, нужное только инспектору сделок (подписи условий). Стратегическая
   * математика в React по-прежнему НЕ считается: бэктест компилирует граф на
   * сервере и возвращает готовый результат.
   */
  const blockInspectorDefinition = useMemo(() => {
    if (!isBlocksMode || !graphValidation.ok) return null;
    try {
      return compileGraphToDraftDefinition(graph);
    } catch {
      return null;
    }
  }, [graph, graphValidation.ok, isBlocksMode]);

  const chartDefinition = isBlocksMode ? blockInspectorDefinition : definition;

  const handleControlChange = useCallback(
    <K extends keyof LabControlsState>(key: K, v: LabControlsState[K]) => {
      setControls((prev) => ({ ...prev, [key]: v }));
    },
    []
  );

  // Создать чистый черновик новой стратегии в АКТИВНОМ режиме
  const handleNewStrategy = useCallback(() => {
    if (authoringMode === 'blocks') {
      setGraph(createEmaTrendTemplate());
    } else {
      setDefinition(defaultDraftDefinition('Новая стратегия'));
    }
    setResult(null);
    setError(null);
    setSelectedTradeId(null);
  }, [authoringMode]);

  const handleRun = useCallback(async () => {
    setError(null);
    if (isCodeMode) { const checked = validateCode(); if (!checked.graph) { setError('Код содержит ошибки.'); return; } setGraph(checked.graph); }
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

    if ((isBlocksMode || isCodeMode) && (!graphValidation.ok || codeErrors.length > 0)) {
      setError(
        `Блок-схема не готова: ${graphValidation.errors
          .slice(0, 2)
          .map((e) => e.message)
          .join(' ')}`
      );
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
          ...(isBlocksMode || isCodeMode ? { strategyGraph: graph } : { strategyDefinition: definition }),
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
  }, [controls, definition, graph, graphValidation, isBlocksMode]);

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

        {/* 2. Режим авторинга: блок-схема / простой конструктор / код */}
        <div className="mb-3">
          <LabAuthoringModeSwitch
            mode={authoringMode}
            onChange={setAuthoringMode}
            disabled={loading}
          />
        </div>

        {/* 3. Основные действия и выбор монеты/таймфрейма */}
        <div className="mb-4">
          <LabControls
            value={controls}
            onChange={handleControlChange}
            onNewStrategy={handleNewStrategy}
            onRun={handleRun}
            loading={loading}
            coverage={coverage}
            runDisabled={isBlocksMode && !graphValidation.ok}
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

        {/* 4. ГРАФИК — ГЛАВНЫЙ ЭЛЕМЕНТ (находится ВЫШЕ настроек) */}
        <div className="mb-4">
          <LabChart
            result={result}
            selectedTrade={selectedTrade}
            onSelectTrade={setSelectedTradeId}
            definition={chartDefinition}
          />
        </div>

        {/* 5. Редактор стратегии (по режиму) и Результаты бэктеста */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* Редактор стратегии */}
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-2">
              {isCodeMode && <><button type="button" onClick={validateCode} className="rounded border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200">Проверить код</button><button type="button" onClick={showCodeAsBlocks} className="rounded border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200">Показать блоками</button><button type="button" onClick={handleRun} disabled={loading} className="rounded border border-emerald-400/30 px-3 py-2 text-xs text-emerald-200">Запустить бэктест</button></>}
              {isBlocksMode && <button type="button" onClick={openBlocksAsCode} className="rounded border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200">Открыть как код</button>}
            </div>
            {isBlocksMode ? (
              <LabBlockEditor
                graph={graph}
                onChange={setGraph}
                validation={graphValidation}
                disabled={loading}
              />
            ) : isCodeMode ? (
              <LabCodeEditor value={sourceCode} onChange={handleCodeChange} errors={codeErrors} disabled={loading} />
            ) : (
              <LabConstructor
                definition={definition}
                onChange={setDefinition}
                disabled={loading}
              />
            )}
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
