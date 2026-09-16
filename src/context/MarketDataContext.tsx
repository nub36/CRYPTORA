import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { DemoMarketDataProvider } from '@/services/data/DemoMarketDataProvider';
import { LiveMarketDataProvider } from '@/services/data/LiveMarketDataProvider';
import { RealtimeFeedManager } from '@/services/realtime/RealtimeFeedManager';
import { PlanTier, PlanManager } from '@/services/subscription/PlanManager';
import { RealtimeConnectionState, TickerTick } from '@/types/realtime';

export interface UserAlert {
  id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'OI_SPIKE' | 'FUNDING_EXTREME';
  targetValue: number | string;
  createdAt: string;
}

export type DataMode = 'demo' | 'live';

interface MarketDataContextType {
  provider: MarketDataProvider;
  isDemo: boolean;
  dataMode: DataMode;
  setDataMode: (mode: DataMode) => void;
  realtimeStatus: RealtimeConnectionState;
  livePrices: Record<string, number>;
  subscribeSymbol: (symbol: string) => void;
  watchlist: string[];
  toggleWatchlist: (symbol: string) => void;
  isWatchlisted: (symbol: string) => boolean;
  alerts: UserAlert[];
  addAlert: (alert: Omit<UserAlert, 'id' | 'createdAt'>) => void;
  removeAlert: (id: string) => void;
  isDemoModalOpen: boolean;
  openDemoModal: () => void;
  closeDemoModal: () => void;
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
}> = ({ children, customProvider }) => {
  const [dataMode, setDataMode] = useState<DataMode>(() => {
    try {
      const saved = localStorage.getItem('cryptora_data_mode');
      return saved === 'live' ? 'live' : 'demo';
    } catch {
      return 'demo';
    }
  });

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
      return saved
        ? JSON.parse(saved)
        : [
            {
              id: 'alert-sample-1',
              symbol: 'BTC',
              condition: 'ABOVE',
              targetValue: 66000,
              createdAt: '2026-09-15T09:00:00Z',
            },
          ];
    } catch {
      return [];
    }
  });

  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
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
    } else {
      feedManager.disconnect();
      setRealtimeStatus('idle');
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
      localStorage.setItem('cryptora_data_mode', dataMode);
    } catch {
      // ignore
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

  const addAlert = (alertData: Omit<UserAlert, 'id' | 'createdAt'>) => {
    const newAlert: UserAlert = {
      ...alertData,
      id: `alert-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setAlerts((prev) => [newAlert, ...prev]);
  };

  const removeAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <MarketDataContext.Provider
      value={{
        provider: activeProvider,
        isDemo: activeProvider.isDemo,
        dataMode,
        setDataMode,
        realtimeStatus,
        livePrices,
        subscribeSymbol,
        watchlist,
        toggleWatchlist,
        isWatchlisted,
        alerts,
        addAlert,
        removeAlert,
        isDemoModalOpen,
        openDemoModal: () => setIsDemoModalOpen(true),
        closeDemoModal: () => setIsDemoModalOpen(false),
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
