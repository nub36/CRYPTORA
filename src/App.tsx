import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { MarketTicker } from '@/components/layout/MarketTicker';
import { Footer } from '@/components/layout/Footer';
import { DemoModal } from '@/components/layout/DemoModal';
import { WatchlistDrawer } from '@/components/layout/WatchlistDrawer';
import { AlertsModal } from '@/components/layout/AlertsModal';
import { PlanModal } from '@/components/layout/PlanModal';

import { OverviewPage } from '@/pages/OverviewPage';
import { MarketPage } from '@/pages/MarketPage';
import { CoinDetailPage } from '@/pages/CoinDetailPage';
import { FuturesPage } from '@/pages/FuturesPage';
import { LiquidationsPage } from '@/pages/LiquidationsPage';
import { ScreenerPage } from '@/pages/ScreenerPage';
import { RadarPage } from '@/pages/RadarPage';
import { HeatmapsPage } from '@/pages/HeatmapsPage';
import { ToolsPage } from '@/pages/ToolsPage';
import { StrategiesPage } from '@/pages/StrategiesPage';
import { SignalsPage } from '@/pages/SignalsPage';
import { CorrelationsPage } from '@/pages/CorrelationsPage';
import { OnChainPage } from '@/pages/OnChainPage';
import { JournalPage } from '@/pages/JournalPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { EcosystemPage } from '@/pages/EcosystemPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-root text-slate-200 flex flex-col font-sans">
      {/* Top Main Navigation Header */}
      <Header />

      {/* Global Compact Market Ticker Strip */}
      <MarketTicker />

      {/* Main Terminal Viewport */}
      <main className="flex-1 w-full">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/coin/:symbol" element={<CoinDetailPage />} />
          <Route path="/futures" element={<FuturesPage />} />
          <Route path="/liquidations" element={<LiquidationsPage />} />
          <Route path="/screener" element={<ScreenerPage />} />
          <Route path="/radar" element={<RadarPage />} />
          <Route path="/heatmaps" element={<HeatmapsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/signals" element={<SignalsPage />} />
          <Route path="/correlations" element={<CorrelationsPage />} />
          <Route path="/onchain" element={<OnChainPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/ecosystem" element={<EcosystemPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {/* Global Footer */}
      <Footer />

      {/* Modals & Drawers */}
      <DemoModal />
      <WatchlistDrawer />
      <AlertsModal />
      <PlanModal />
    </div>
  );
};

export default App;
