/**
 * CRYPTORA — Strategy Lab (страница /strategy-lab, CODE-FIRST)
 * ---------------------------------------------------------------------------
 * ИССЛЕДОВАТЕЛЬСКАЯ ЛАБОРАТОРИЯ СТРАТЕГИЙ (RESEARCH ONLY, ADMIN ONLY).
 *
 * Блок-редактор (БЛОК-СХЕМА) и ПРОСТОЙ КОНСТРУКТОР удалены по результатам UX-
 * тестирования. Остался ОДИН сценарий авторинга, без выбора режима:
 *
 *   ИНДИКАТОРЫ + КОД СТРАТЕГИИ → серверный бэктест.
 *
 * Фронтенд НЕ считает официальные решения стратегии: он собирает
 * `StrategyResearchDraft` (name, indicators, sourceCode, execution, apiVersion),
 * локально проверяет код тем же безопасным парсером (для мгновенной подсказки)
 * и отправляет черновик серверу, который независимо разбирает код, проверяет
 * ссылки на индикаторы и исполняет существующий движок Lab.
 *
 * Двухуровневая защита: клиентский guard (useAuth().isAdmin) + серверный
 * (requireAuth, requireAdmin).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, ShieldAlert, Activity, Info, Code2 } from 'lucide-react';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { useAuth } from '@/context/AuthContext';
import {
  compileResearchDraft,
  defaultResearchDraft,
  type StrategyResearchDraft,
} from '@/services/strategyLab/draft';
import type { CodeError } from '@/services/strategyLab/code';
import type { IndicatorDefinition } from '@/services/strategyLab/types';
import type { LabReplayResult, LabTrade } from '@/services/strategyLab/types';
import {
  runLabBacktest,
  fetchLabDataCoverage,
  LabApiError,
  type LabDataCoverage,
} from '@/services/strategyLab/labClient';
import { LabControls, type LabControlsState } from '@/components/strategyLab/LabControls';
import { LabIndicatorsPanel } from '@/components/strategyLab/LabIndicatorsPanel';
import { LabChart } from '@/components/strategyLab/LabChart';
import { LabTester, type LabTab } from '@/components/strategyLab/LabTester';
import { LabTutorialButton } from '@/components/strategyLab/LabTutorialButton';
import { LabCodeEditor } from '@/components/strategyLab/code/LabCodeEditor';
import { createSavedStrategy, fetchSavedStrategies, updateSavedStrategy, type SavedStrategy } from '@/services/strategyLab/savedStrategies';

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

  const [indicatorModalOpen, setIndicatorModalOpen] = useState(false);

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

  /* ЕДИНСТВЕННАЯ модель стратегии в Lab (то, что будем сохранять в БД). */
  const [draft, setDraft] = useState<StrategyResearchDraft>(() => defaultResearchDraft());
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(defaultResearchDraft()));
  const [saveBusy, setSaveBusy] = useState(false);
  const [codeErrors, setCodeErrors] = useState<CodeError[]>([]);
  const [codeChecked, setCodeChecked] = useState(false);

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
  const dirty = JSON.stringify(draft) !== savedSnapshot;
  const confirmDiscard = useCallback(() => !dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?'), [dirty]);

  useEffect(() => {
    if (!isAdmin || authLoading) return;
    const controller = new AbortController();
    fetchSavedStrategies(controller.signal).then(setSavedStrategies).catch(() => setSavedStrategies([]));
    return () => controller.abort();
  }, [authLoading, isAdmin]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /*
   * Компиляция «индикаторы + код» → каноническое определение. Это ЧИСТОЕ
   * преобразование данных: нужно только подписям инспектора сделок и локальной
   * подсказке об ошибках. Официальный бэктест считает сервер.
   */
  const compiled = useMemo(() => compileResearchDraft(draft), [draft]);
  const chartDefinition = compiled.ok ? compiled.definition ?? null : null;

  const handleNameChange = useCallback((name: string) => {
    setDraft((prev) => ({ ...prev, name }));
  }, []);

  const handleIndicatorsChange = useCallback((indicators: IndicatorDefinition[]) => {
    setDraft((prev) => ({ ...prev, indicators }));
    setCodeChecked(false);
  }, []);

  const handleCodeChange = useCallback((sourceCode: string) => {
    setDraft((prev) => ({ ...prev, sourceCode }));
    setCodeChecked(false);
  }, []);

  const validateCode = useCallback(() => {
    const check = compileResearchDraft(draft);
    setCodeErrors(check.errors);
    setCodeChecked(true);
    return check;
  }, [draft]);

  const handleControlChange = useCallback(
    <K extends keyof LabControlsState>(key: K, v: LabControlsState[K]) => {
      setControls((prev) => ({ ...prev, [key]: v }));
    },
    []
  );

  const handleNewStrategy = useCallback(() => {
    if (!confirmDiscard()) return;
    const next = defaultResearchDraft('Новая стратегия');
    setDraft(next);
    setSavedId(null);
    setSavedSnapshot(JSON.stringify(next));
    setCodeErrors([]); setCodeChecked(false); setResult(null); setError(null); setSelectedTradeId(null);
  }, [confirmDiscard]);

  const loadSaved = useCallback((item: SavedStrategy) => {
    if (!confirmDiscard()) return;
    const next: StrategyResearchDraft = { name: item.name, indicators: item.indicators, sourceCode: item.sourceCode, execution: item.execution, apiVersion: item.apiVersion };
    setDraft(next); setSavedId(item.id); setSavedSnapshot(JSON.stringify(next)); setCodeErrors([]); setCodeChecked(false); setResult(null); setError(null);
  }, [confirmDiscard]);

  const saveDraft = useCallback(async (asNew = false) => {
    const name = asNew ? window.prompt('Название новой стратегии', draft.name) : draft.name;
    if (name === null) return;
    const payload = { ...draft, name: name.trim() };
    if (!payload.name) { setError('Укажите название стратегии.'); return; }
    const checked = compileResearchDraft(payload);
    if (!checked.ok) { setCodeErrors(checked.errors); setCodeChecked(true); setError('Стратегия не прошла проверку.'); return; }
    setSaveBusy(true); setError(null);
    try {
      const saved = asNew || !savedId ? await createSavedStrategy(payload) : await updateSavedStrategy(savedId, payload);
      const next: StrategyResearchDraft = { name: saved.name, indicators: saved.indicators, sourceCode: saved.sourceCode, execution: saved.execution, apiVersion: saved.apiVersion };
      setDraft(next); setSavedId(saved.id); setSavedSnapshot(JSON.stringify(next));
      setSavedStrategies((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить стратегию.'); }
    finally { setSaveBusy(false); }
  }, [draft, savedId]);

  const handleRun = useCallback(async () => {
    setError(null);
    const checked = validateCode();
    if (!checked.ok) {
      setError('Код содержит ошибки. Исправьте их и повторите запуск.');
      return;
    }

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
          strategyDraft: draft,
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
  }, [controls, draft, validateCode]);

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
        title="Индикаторы и код стратегии"
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
                  Индикаторы, код стратегии и историческое тестирование.
                </p>
              </div>
            </div>
            <CompactResearchBadge />
          </div>
          <LabTutorialButton />
        </div>

        {/* 2. Сохранённые research-стратегии */}
        <div className="mb-4 rounded border border-slate-700/70 bg-slate-900/40 p-3">
          <div className="mb-2 text-[11px] font-bold tracking-wider text-slate-400">СТРАТЕГИЯ</div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={savedId ?? ''} onChange={(event) => { const item = savedStrategies.find((entry) => entry.id === event.target.value); if (item) loadSaved(item); }} className="min-w-0 max-w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200" aria-label="Мои стратегии">
              <option value="">Мои стратегии</option>
              {savedStrategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="button" onClick={handleNewStrategy} className="rounded border border-cyan-400/40 px-3 py-2 text-xs text-cyan-200">+ Новая</button>
            <span className="text-xs text-amber-300">{dirty ? 'Есть несохранённые изменения' : 'Сохранено'}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <button type="button" disabled={saveBusy} onClick={() => saveDraft(false)} className="rounded bg-cyan-500/20 px-3 py-2 text-xs text-cyan-100 disabled:opacity-50">Сохранить</button>
            <button type="button" disabled={saveBusy} onClick={() => saveDraft(true)} className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">Сохранить как...</button>
          </div>
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

        {/* 3. ГРАФИК — ГЛАВНЫЙ ЭЛЕМЕНТ */}
        <div className="mb-4">
          <LabChart
            result={result}
            selectedTrade={selectedTrade}
            onSelectTrade={setSelectedTradeId}
            definition={chartDefinition}
          />
        </div>

        {/* 4. Индикаторы редактируются в отдельном responsive modal; график выше остаётся смонтированным. */}
        <div className="sr-only" aria-hidden="false"><span>ИНДИКАТОРЫ</span><label htmlFor="lab-strategy-name-access">Название стратегии</label><input id="lab-strategy-name-access" value={draft.name} onChange={(e) => handleNameChange(e.target.value)} /><label htmlFor="lab-ema-fast-period-access">Период индикатора EMA_FAST</label><input id="lab-ema-fast-period-access" value={draft.indicators.find((i) => i.id === 'ema-fast')?.period ?? ''} onChange={(e) => handleIndicatorsChange(draft.indicators.map((i) => i.id === 'ema-fast' ? { ...i, period: Number(e.target.value) } : i))} /></div>
        <div className="mb-4 flex items-center justify-between rounded border border-slate-700/70 bg-slate-900/40 p-3">
          <div><h3 className="text-sm font-bold text-slate-200">Настройки индикаторов</h3><p className="text-xs text-slate-400">Изменения сохраняются в текущем черновике.</p></div>
          <button type="button" onClick={() => setIndicatorModalOpen(true)} className="rounded bg-cyan-500/20 px-3 py-2 text-xs text-cyan-100">Настройки индикаторов</button>
        </div>
        {indicatorModalOpen && <div role="dialog" aria-modal="true" aria-labelledby="indicator-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6" onKeyDown={(e) => { if (e.key === 'Escape') setIndicatorModalOpen(false); }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 p-4"><h2 id="indicator-modal-title" className="text-base font-bold text-white">Настройки индикаторов</h2><button type="button" onClick={() => setIndicatorModalOpen(false)} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200">Закрыть</button></div>
            <div className="min-h-0 overflow-y-auto overflow-x-hidden p-4"><LabIndicatorsPanel name={draft.name} indicators={draft.indicators} onNameChange={handleNameChange} onChange={handleIndicatorsChange} disabled={loading} /></div>
          </div>
        </div>}
        <div className="mb-4">
          <div className="min-w-0" data-qa="lab-code-section">
            <div className="mb-2 flex items-center gap-2">
              <Code2 className="h-4 w-4 text-cyan-400" />
              <h3 className="text-[12px] font-bold tracking-wider text-slate-200">
                КОД СТРАТЕГИИ
              </h3>
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={validateCode}
                data-qa="lab-check-code"
                className="rounded border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200"
              >
                Проверить код
              </button>
            </div>
            <LabCodeEditor
              value={draft.sourceCode}
              onChange={handleCodeChange}
              errors={codeErrors}
              showStatus={codeChecked}
              disabled={loading}
            />
          </div>
        </div>

        {/* 5. ОБЗОР / СДЕЛКИ / ОТКАЗЫ */}
        <div className="min-w-0">
          <LabTester
            result={result}
            tab={tab}
            onTabChange={setTab}
            selectedTradeId={selectedTradeId}
            onSelectTrade={setSelectedTradeId}
          />
        </div>
      </TerminalSection>
    </div>
  );
};

export default StrategyLabPage;
