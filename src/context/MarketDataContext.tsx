import React, { createContext, useContext, useState, useEffect } from 'react';
import { MarketDataProvider } from '@/services/data/MarketDataProvider';
import { defaultMarketDataProvider } from '@/services/data';

export interface UserAlert {
  id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'OI_SPIKE' | 'FUNDING_EXTREME';
  targetValue: number | string;
  createdAt: string;
}

interface MarketDataContextType {
  provider: MarketDataProvider;
  isDemo: boolean;
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
}

const MarketDataContext = createContext<MarketDataContextType | null>(null);

export const MarketDataProviderComponent: React.FC<{
  children: React.ReactNode;
  customProvider?: MarketDataProvider;
}> = ({ children, customProvider = defaultMarketDataProvider }) => {
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
        provider: customProvider,
        isDemo: customProvider.isDemo,
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
