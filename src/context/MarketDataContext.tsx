import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { DemoMarketDataProvider } from '@/services/data/DemoMarketDataProvider';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { LiveSignalEngine } from '@/services/signals/live/LiveSignalEngine';
import { PlanTier, PlanManager } from '@/services/subscription/PlanManager';
import { RealtimeConnectionState, TickerTick } from '@/types/realtime';

import {
  evaluateAll,
  type AlertInputs,
  type TriggeredUserAlert,
  type UserAlertRule,
} from '@/services/alerts/alertEvaluator';
import { AlertDispatcher } from '@/services/alerts/AlertDispatcher';
import {
  ALERT_CHANNELS_STORAGE_KEY,
  parseChannelsConfig,
  type AlertChannelsConfig,
  type DeliveryRecord,
} from '@/services/alerts/deliveryChannels';

export type UserAlert = UserAlertRule;
export type { TriggeredUserAlert, AlertChannelsConfig, DeliveryRecord };

const ALERT_HISTORY_KEY = 'cryptora_alert_history';
const ALERT_HISTORY_MAX = 100;
/** Период опроса фандинга для FUNDING_EXTREME (REST premiumIndex, кэш провайдера 60с). */
const FUNDING_POLL_MS = 60_000;

import { resolveInitialDataMode, QA_FIXTURE_ALLOWED, type DataMode } from '@/config/dataModePolicy';

export type { DataMode };

interface MarketDataContextType {
  provider: MarketDataProvider;
  isDemo: boolean;
  dataMode: DataMode;
  realtimeStatus: RealtimeConnectionState;
  livePrices: Record<string, number>;
  subscribeSymbol: (symbol: string) => void;
  watchlist: string[];
  toggleWatchlist: (symbol: string) => void;
  isWatchlisted: (symbol: string) => boolean;
  alerts: UserAlert[];
  /** Возвращает false, если достигнут лимит тарифа. */
  addAlert: (alert: Omit<UserAlert, 'id' | 'createdAt'>) => boolean;
  removeAlert: (id: string) => void;
  toggleAlertPaused: (id: string) => void;
  alertHistory: TriggeredUserAlert[];
  clearAlertHistory: () => void;
  unreadAlertCount: number;
  markAlertsRead: () => void;
  alertChannels: AlertChannelsConfig;
  setAlertChannels: (cfg: AlertChannelsConfig) => void;
  deliveryLog: DeliveryRecord[];
  /** Последняя известная ставка фандинга (8ч, %) по каноническому символу. */
  liveFunding: Record<string, number>;
  isWatchlistOpen: boolean;
  openWatchlist: () => void;
  closeWatchlist: () => void;
  isAlertsModalOpen: boolean;
  openAlertsModal: () => void;
  closeAlertsModal: () => void;
  userPlan: PlanTier;
  setUserPlan: (tier: PlanTier) => void;
  isPlanModalOpen: boolean;
  openPlanModal: () => void;
  closePlanModal: () => void;
}

const MarketDataContext = createContext<MarketDataContextType | null>(null);

const singletonDemoProvider = new DemoMarketDataProvider();
const singletonLiveProvider = new LiveMarketDataProvider({
  anomalyEngine: RealtimeFeedManager.getInstance().anomalyEngine,
});

export const MarketDataProviderComponent: React.FC<{
  children: React.ReactNode;
  customProvider?: MarketDataProvider;
  /**
   * Переопределение политики QA-фикстуры (только для тестов): `false` эмулирует
   * production runtime, где DEMO недоступен ни при каких условиях.
   */
  qaFixtureAllowed?: boolean;
}> = ({ children, customProvider, qaFixtureAllowed = QA_FIXTURE_ALLOWED }) => {
  // PRODUCTION = ТОЛЬКО LIVE (решение владельца). Режим фиксируется один раз при
  // старте и не переключается в runtime: пользовательского DEMO-режима нет.
  // QA-датасет доступен только в dev/test через явный ключ `cryptora_qa_fixture=1`
  // (см. src/config/dataModePolicy.ts) и никогда не подменяет собой недоступные
  // фактические данные.
  const [dataMode] = useState<DataMode>(() =>
    resolveInitialDataMode(typeof localStorage !== 'undefined' ? localStorage : null, qaFixtureAllowed)
  );

  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionState>('idle');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cryptora_watchlist');
      return saved ? JSON.parse(saved) : ['BTC', 'ETH', 'SOL'];
    } catch {
      return ['BTC', 'ETH', 'SOL'];
    }
  });

  const [alerts, setAlerts] = useState<UserAlert[]>(() => {
    try {
      const saved = localStorage.getItem('cryptora_alerts');
      if (!saved) return [];
      const parsed = JSON.parse(saved) as UserAlert[];
      // Ранее (≤ v0.8.22) в хранилище мог лежать демонстрационный алерт — он не является пользовательским.
      return Array.isArray(parsed) ? parsed.filter((a) => a && a.id !== 'alert-sample-1') : [];
    } catch {
      return [];
    }
  });
  const [alertHistory, setAlertHistory] = useState<TriggeredUserAlert[]>(() => {
    try {
      const saved = localStorage.getItem(ALERT_HISTORY_KEY);
      return saved ? (JSON.parse(saved) as TriggeredUserAlert[]) : [];
    } catch {
      return [];
    }
  });
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [alertChannels, setAlertChannelsState] = useState<AlertChannelsConfig>(() => {
    try {
      return parseChannelsConfig(localStorage.getItem(ALERT_CHANNELS_STORAGE_KEY));
    } catch {
      return parseChannelsConfig(null);
    }
  });
  const dispatcher = useMemo(() => new AlertDispatcher(), []);
  const [deliveryLog, setDeliveryLog] = useState<DeliveryRecord[]>(() => dispatcher.getLog());
  const [liveFunding, setLiveFunding] = useState<Record<string, number>>({});
  const alertsRef = React.useRef(alerts);
  alertsRef.current = alerts;
  const channelsRef = React.useRef(alertChannels);
  channelsRef.current = alertChannels;

  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState(false);
  const [userPlan, setUserPlan] = useState<PlanTier>(() => PlanManager.getCurrentPlan());
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  // Manage Realtime WebSocket Lifecycle
  useEffect(() => {
    const feedManager = RealtimeFeedManager.getInstance();

    const unsubscribeConnection = feedManager.eventBus.subscribe<RealtimeConnectionState>(
      'connection',
      (state) => {
        setRealtimeStatus(state);
      }
    );

    const unsubscribeTickers = feedManager.eventBus.subscribe<TickerTick>(
      'ticker:*',
      (tick) => {
        setLivePrices((prev) => ({
          ...prev,
          [tick.symbol]: tick.price,
        }));
      }
    );

    if (dataMode === 'live') {
      feedManager.connect();
      // Subscribe watchlisted symbols
      for (const sym of watchlist) {
        feedManager.subscribeSymbol(sym);
      }

      // Start live signal engine (V3.0 strategy on 6 symbols)
      try {
        const signalEngine = LiveSignalEngine.getInstance({ provider: singletonLiveProvider });
        signalEngine?.start();
      } catch { /* non-fatal */ }
    } else {
      feedManager.disconnect();
      setRealtimeStatus('idle');
      LiveSignalEngine.resetInstance();
    }

    return () => {
      unsubscribeConnection();
      unsubscribeTickers();
    };
  }, [dataMode]);

  const subscribeSymbol = useCallback((symbol: string) => {
    if (dataMode === 'live') {
      RealtimeFeedManager.getInstance().subscribeSymbol(symbol);
    }
  }, [dataMode]);

  useEffect(() => {
    try {
      localStorage.setItem('cryptora_watchlist', JSON.stringify(watchlist));
    } catch {
      // ignore
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem('cryptora_alerts', JSON.stringify(alerts));
    } catch {
      // ignore
    }
  }, [alerts]);

  useEffect(() => {
    try {
      localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(alertHistory.slice(0, ALERT_HISTORY_MAX)));
    } catch {
      // ignore
    }
  }, [alertHistory]);

  /**
   * Оценка алертов по фактическим входам. Единая точка: сюда приходят и тики цены (WS),
   * и фандинг (REST-опрос). Cooldown и lastTriggeredAt обновляются в самом правиле.
   */
  const runEvaluation = useCallback(
    (inputsBySymbol: Record<string, AlertInputs>) => {
      const current = alertsRef.current;
      if (current.length === 0) return;
      const { events, rules } = evaluateAll(current, inputsBySymbol);
      if (events.length === 0) return;
      alertsRef.current = rules;
      setAlerts(rules);
      setAlertHistory((prev) => [...events, ...prev].slice(0, ALERT_HISTORY_MAX));
      setUnreadAlertCount((n) => n + events.length);
      const cfg = channelsRef.current;
      for (const ev of events) {
        const rule = rules.find((r) => r.id === ev.ruleId);
        const channels = rule?.channels && rule.channels.length > 0 ? rule.channels : ['IN_APP' as const];
        void dispatcher.dispatch(ev, channels, cfg).then(() => setDeliveryLog(dispatcher.getLog()));
      }
    },
    [dispatcher],
  );

  // Цена: каждый тик по подписанному символу
  useEffect(() => {
    if (dataMode !== 'live') return;
    const feedManager = RealtimeFeedManager.getInstance();
    const unsub = feedManager.eventBus.subscribe<TickerTick>('ticker:*', (tick) => {
      const sym = tick.symbol.toUpperCase();
      if (!alertsRef.current.some((a) => a.symbol.toUpperCase() === sym && (a.condition === 'ABOVE' || a.condition === 'BELOW'))) return;
      runEvaluation({ [sym]: { price: tick.price, source: `${tick.provenance?.exchange ?? 'binance'} spot ticker (WS)` } });
    });
    return unsub;
  }, [dataMode, runEvaluation]);

  // Символы алертов должны быть подписаны на WS, иначе цена не придёт
  useEffect(() => {
    if (dataMode !== 'live') return;
    const feedManager = RealtimeFeedManager.getInstance();
    for (const a of alerts) {
      if (a.condition === 'ABOVE' || a.condition === 'BELOW') feedManager.subscribeSymbol(a.symbol);
    }
  }, [alerts, dataMode]);

  // Фандинг / OI: REST-опрос только при наличии FUNDING_EXTREME- или OI_SPIKE-алертов; демо-фолбэк провайдера игнорируется.
  const hasFundingAlerts = alerts.some((a) => (a.condition === 'FUNDING_EXTREME' || a.condition === 'OI_SPIKE') && !a.paused);
  useEffect(() => {
    if (dataMode !== 'live' || !hasFundingAlerts) return;
    let cancelled = false;
    const provider = customProvider ?? singletonLiveProvider;
    const poll = async () => {
      try {
        const list = await provider.getFuturesList();
        if (cancelled) return;
        const inputs: Record<string, AlertInputs> = {};
        const funding: Record<string, number> = {};
        for (const f of list) {
          if (f.isDemo) continue;
          const sym = f.symbol.split('/')[0].toUpperCase();
          funding[sym] = f.fundingRate;
          inputs[sym] = {
            fundingRatePct: f.fundingRate,
            // OI_SPIKE оценивается ТОЛЬКО по фактическому ряду OI; UNAVAILABLE в алерты не подаётся.
            oiChange1hPct: f.openInterestChangeSource === 'ACTUAL' && f.openInterestChange1h != null ? f.openInterestChange1h : undefined,
            source: `${f.provenance?.exchange ?? 'binance'} futures premiumIndex + openInterestHist (REST)`,
          };
        }
        setLiveFunding(funding);
        runEvaluation(inputs);
      } catch {
        // сеть недоступна — алерт остаётся не оценённым, без имитации
      }
    };
    void poll();
    const t = setInterval(() => void poll(), FUNDING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [dataMode, hasFundingAlerts, customProvider, runEvaluation]);

  const activeProvider = useMemo<MarketDataProvider>(() => {
    if (customProvider) return customProvider;
    return dataMode === 'live' ? singletonLiveProvider : singletonDemoProvider;
  }, [customProvider, dataMode]);

  const toggleWatchlist = (symbol: string) => {
    const s = symbol.toUpperCase();
    setWatchlist((prev) => (prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]));
  };

  const isWatchlisted = (symbol: string) => {
    return watchlist.includes(symbol.toUpperCase());
  };

  const addAlert = (alertData: Omit<UserAlert, 'id' | 'createdAt'>): boolean => {
    if (alertsRef.current.length >= PlanManager.getMaxAlerts(userPlan)) return false;
    const newAlert: UserAlert = {
      ...alertData,
      symbol: alertData.symbol.toUpperCase(),
      id: `alert-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setAlerts((prev) => [newAlert, ...prev]);
    return true;
  };

  const removeAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const toggleAlertPaused = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, paused: !a.paused } : a)));
  };

  const setAlertChannels = (cfg: AlertChannelsConfig) => {
    setAlertChannelsState(cfg);
    try {
      localStorage.setItem(ALERT_CHANNELS_STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // ignore
    }
  };

  return (
    <MarketDataContext.Provider
      value={{
        provider: activeProvider,
        isDemo: activeProvider.isDemo,
        dataMode,
        realtimeStatus,
        livePrices,
        subscribeSymbol,
        watchlist,
        toggleWatchlist,
        isWatchlisted,
        alerts,
        addAlert,
        removeAlert,
        toggleAlertPaused,
        alertHistory,
        clearAlertHistory: () => setAlertHistory([]),
        unreadAlertCount,
        markAlertsRead: () => setUnreadAlertCount(0),
        alertChannels,
        setAlertChannels,
        deliveryLog,
        liveFunding,
        isWatchlistOpen,
        openWatchlist: () => setIsWatchlistOpen(true),
        closeWatchlist: () => setIsWatchlistOpen(false),
        isAlertsModalOpen,
        openAlertsModal: () => setIsAlertsModalOpen(true),
        closeAlertsModal: () => setIsAlertsModalOpen(false),
        userPlan,
        setUserPlan,
        isPlanModalOpen,
        openPlanModal: () => setIsPlanModalOpen(true),
        closePlanModal: () => setIsPlanModalOpen(false),
      }}
    >
      {children}
    </MarketDataContext.Provider>
  );
};

export const useMarketData = () => {
  const context = useContext(MarketDataContext);
  if (!context) {
    throw new Error('useMarketData must be used within a MarketDataProviderComponent');
  }
  return context;
};
