import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import { ThemeProvider } from '@/context/ThemeContext';
import App from './App';

// Self-hosted fonts (Д1: CSP-safe, no Google Fonts dependency)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource-variable/jetbrains-mono';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <MarketDataProviderComponent>
          <App />
        </MarketDataProviderComponent>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
