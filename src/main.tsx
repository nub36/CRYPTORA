import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import App from './App';

// Self-hosted fonts (Д1: CSP-safe, no Google Fonts dependency)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource-variable/jetbrains-mono';

import './index.css';

// basename синхронизирован с vite.config.ts `base` (/CRYPTORA/ для Project Pages, "/" для custom domain / dev).
// Vite подставляет import.meta.env.BASE_URL = base из конфига.
const _baseUrl = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
const routerBasename = _baseUrl === '/' ? '/' : _baseUrl.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <ThemeProvider>
        <AuthProvider>
          <MarketDataProviderComponent>
            <App />
          </MarketDataProviderComponent>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
