/**
 * CRYPTORA — Strategy Lab (страница /strategy-lab)
 * ---------------------------------------------------------------------------
 * RESEARCH ONLY, ADMIN ONLY. Изолированный исследовательский раздел для новых
 * стратегий с нуля. Не трогает production-стратегии (V2.8/V3.0/V3.3/V3.4),
 * сигналы, strategy_settings, scheduler и БД.
 *
 * Защита фронта (двухуровневая с бэком): страница закрыта существующим
 * useAuth().isAdmin. Прямой переход не-админа не показывает содержимое Lab; все
 * данные всё равно приходят из admin-only API /api/strategy-lab/* (сервер —
 * источник истины, скрытие кнопки не является защитой).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, ShieldAlert, Activity } from 'lucide-react';
import { TerminalSection } from '@/components/layout/TerminalSection';
import { useAuth } from '@/context/AuthContext';
import {
  LAB_STRATEGIES as STATIC_LAB_STRATEGIES,
  getLabStrategy,
  defaultResearchConfig,
  type LabStrategyMeta,
} from '@/services/strategyLab/registry';
import type { LabReplayResult, LabTrade, ResearchConfig } from '@/services/strategyLab/types';
import { fetchLabStrategies, runLabBacktest, LabApiError } from '@/services/strategyLab/labClient';
import { LabControls, type LabControlsState } from '@/components/strategyLab/LabControls';
import { LabParamsPanel } from '@/components/strategyLab/LabParamsPanel';
import { LabChart } from '@/components/strategyLab/LabChart';
import { LabTester, type LabTab } from '@/components/strategyLab/LabTester';
import { LabTutorialButton } from '@/components/strategyLab/LabTutorialButton';

const CONFIG_STORAGE_PREFIX = 'cryptora.strategyLab.config.';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function loadStoredConfig(strategyId: string): ResearchConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_PREFIX + strategyId);
    if (!raw) return null;
    return JSON.parse(raw) as ResearchConfig;
  } catch {
    return null;
  }
}
function storeConfig(strategyId: string, cfg: ResearchConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_PREFIX + strategyId, JSON.stringify(cfg));
  } catch {
    /* localStorage может быть недоступен — не критично */
  }
}

/** Иммутабельно записать число по пути "group.key" в ResearchConfig. */
function setByPath(cfg: ResearchConfig, path: string, value: number): ResearchConfig {
  const [group, key] = path.split('.') as [keyof ResearchConfig, string];
  return {
    ...cfg,
    [group]: { ...(cfg[group] as Record<string, number>), [key]: value },
  };
}

const ResearchOnlyBanner: React.FC = () => (
  <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
    <ShieldAlert className="h-4 w-4 shrink-0" />
    <span>
      <span className="font-bold">RESEARCH ONLY.</span> Лаборатория не изменяет production:
      не трогает стратегии V2.8/V3.0/V3.3/V3.4, сигналы, настройки и планировщик.
    </span>
  </div>
);

export const StrategyLabPage: React.FC = () => {
  const { isAdmin, isLoading: authLoading } = useAuth();

  const [strategies, setStrategies] = useState<LabStrategyMeta[]>([...STATIC_LAB_STRATEGIES]);
  const firstStrategyId = strategies[0]?.id ?? '';

  const [controls, setControls] = useState<LabControlsState>(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    return {
      strategyId: firstStrategyId,
      market: 'spot',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      from: toLocalInput(from),
      to: toLocalInput(now),
    };
  });

  const [config, setConfig] = useState<ResearchConfig>(() => defaultResearchConfig(firstStrategyId));
  const [result, setResult] = useState<LabReplayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<LabTab>('overview');
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Загрузка каталога исследовательских стратегий (admin-only API).
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const controller = new AbortController();
    fetchLabStrategies(controller.signal)
      .then((res) => {
        if (!active || !res.strategies?.length) return;
        setStrategies(res.strategies);
        setControls((prev) => ({
          ...prev,
          strategyId: prev.strategyId || res.strategies[0].id,
        }));
      })
      .catch(() => {
        /* оставляем статический реестр как фолбэк для UI-каркаса */
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [isAdmin]);

  // Смена стратегии → подгрузить сохранённый/дефолтный config.
  useEffect(() => {
    if (!controls.strategyId) return;
    const stored = loadStoredConfig(controls.strategyId);
    setConfig(stored ?? defaultResearchConfig(controls.strategyId));
  }, [controls.strategyId]);

  const currentStrategy = useMemo(
    () => getLabStrategy(controls.strategyId) ?? strategies.find((s) => s.id === controls.strategyId) ?? null,
    [controls.strategyId, strategies]
  );

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

  const handleParamChange = useCallback(
    (path: string, value: number) => {
      setConfig((prev) => {
        const next = setByPath(prev, path, value);
        storeConfig(controls.strategyId, next);
        return next;
      });
    },
    [controls.strategyId]
  );

  const handleReset = useCallback(() => {
    const fresh = defaultResearchConfig(controls.strategyId);
    setConfig(fresh);
    storeConfig(controls.strategyId, fresh);
  }, [controls.strategyId]);

  const handleRun = useCallback(async () => {
    setError(null);
    const fromMs = new Date(controls.from).getTime();
    const toMs = new Date(controls.to).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      setError('Укажите корректные даты диапазона.');
      return;
    }
    if (!(fromMs < toMs)) {
      setError('Дата «От» должна быть раньше «До».');
      return;
    }
    if (!controls.symbol.trim()) {
      setError('Укажите символ.');
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
          strategyId: controls.strategyId,
          market: controls.market,
          symbol: controls.symbol.trim().toUpperCase(),
          timeframe: controls.timeframe,
          from: fromMs,
          to: toMs,
          researchConfig: config,
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
  }, [controls, config]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
        label="RESEARCH LAB"
        title="Strategy Lab"
        meta="research contour"
        className="strategy-lab-command-bar"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-cyan-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Лаборатория стратегий</h1>
              <p className="text-[12px] text-slate-400">
                Разработка новых исследовательских стратегий с нуля.
              </p>
            </div>
          </div>
          <LabTutorialButton />
        </div>

        <div className="mb-4">
          <ResearchOnlyBanner />
        </div>

        <div className="mb-4">
          <LabControls
            strategies={strategies}
            value={controls}
            onChange={handleControlChange}
            onRun={handleRun}
            onReset={handleReset}
            loading={loading}
          />
        </div>

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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <LabChart
              result={result}
              selectedTrade={selectedTrade}
              onSelectTrade={setSelectedTradeId}
            />
            <LabTester
              result={result}
              tab={tab}
              onTabChange={setTab}
              selectedTradeId={selectedTradeId}
              onSelectTrade={setSelectedTradeId}
            />
          </div>

          <div className="min-w-0">
            <LabParamsPanel
              strategy={currentStrategy}
              config={config}
              onChange={handleParamChange}
              disabled={loading}
            />
          </div>
        </div>
      </TerminalSection>
    </div>
  );
};

export default StrategyLabPage;
