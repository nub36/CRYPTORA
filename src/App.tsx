import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { MarketTicker } from '@/components/layout/MarketTicker';
import { Footer } from '@/components/layout/Footer';
import { WatchlistDrawer } from '@/components/layout/WatchlistDrawer';
import { AlertsModal } from '@/components/layout/AlertsModal';
import { PlanModal } from '@/components/layout/PlanModal';
import { Activity } from 'lucide-react';

// Eager: landing page (first paint)
import { OverviewPage } from '@/pages/OverviewPage';

// P3: lazy-loaded routes — each becomes a separate chunk
const MarketPage = React.lazy(() => import('@/pages/MarketPage').then(m => ({ default: m.MarketPage })));
const CoinDetailPage = React.lazy(() => import('@/pages/CoinDetailPage').then(m => ({ default: m.CoinDetailPage })));
const FuturesPage = React.lazy(() => import('@/pages/FuturesPage').then(m => ({ default: m.FuturesPage })));
const LiquidationsPage = React.lazy(() => import('@/pages/LiquidationsPage').then(m => ({ default: m.LiquidationsPage })));
const ScreenerPage = React.lazy(() => import('@/pages/ScreenerPage').then(m => ({ default: m.ScreenerPage })));
const RadarPage = React.lazy(() => import('@/pages/RadarPage').then(m => ({ default: m.RadarPage })));
const HeatmapsPage = React.lazy(() => import('@/pages/HeatmapsPage').then(m => ({ default: m.HeatmapsPage })));
const ToolsPage = React.lazy(() => import('@/pages/ToolsPage').then(m => ({ default: m.ToolsPage })));
const StrategiesPage = React.lazy(() => import('@/pages/StrategiesPage').then(m => ({ default: m.StrategiesPage })));
const SignalsPage = React.lazy(() => import('@/pages/SignalsPage').then(m => ({ default: m.SignalsPage })));
const CorrelationsPage = React.lazy(() => import('@/pages/CorrelationsPage').then(m => ({ default: m.CorrelationsPage })));
const OnChainPage = React.lazy(() => import('@/pages/OnChainPage').then(m => ({ default: m.OnChainPage })));
const JournalPage = React.lazy(() => import('@/pages/JournalPage').then(m => ({ default: m.JournalPage })));
const CalendarPage = React.lazy(() => import('@/pages/CalendarPage').then(m => ({ default: m.CalendarPage })));
const EcosystemPage = React.lazy(() => import('@/pages/EcosystemPage').then(m => ({ default: m.EcosystemPage })));
const PortfolioRiskPage = React.lazy(() => import('@/pages/PortfolioRiskPage').then(m => ({ default: m.PortfolioRiskPage })));
const ArticlesPage = React.lazy(() => import('@/pages/ArticlesPage').then(m => ({ default: m.ArticlesPage })));
const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const LoginPage = React.lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = React.lazy(() => import('@/pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const VerifyEmailPage = React.lazy(() => import('@/pages/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })));
const ProfilePage = React.lazy(() => import('@/pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const AdminPage = React.lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })));

const PageLoader: React.FC = () => (
  <div className="flex items-center justify-center min-h-[50vh] text-slate-400 font-sans text-sm">
    <Activity className="w-5 h-5 animate-spin mr-2 text-brand-cyan" />
    Загрузка…
  </div>
);

export const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-root text-slate-200 flex flex-col font-sans">
      <Header />
      <MarketTicker />
      <main className="flex-1 w-full">
        <Suspense fallback={<PageLoader />}>
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
            <Route path="/portfolio" element={<PortfolioRiskPage />} />
            <Route path="/articles" element={<ArticlesPage />} />
            <Route path="/articles/:slug" element={<ArticlesPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <WatchlistDrawer />
      <AlertsModal />
      <PlanModal />
    </div>
  );
};

export default App;
