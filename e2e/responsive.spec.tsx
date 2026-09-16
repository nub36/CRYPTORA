import './setup-dom';
import { resetBrowserStorage } from './setup-dom';
import { test, expect } from '@playwright/test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import App from '@/App';

// Контрольные брейкпоинты терминала. 1280 и 1366 добавлены после реального
// UI-регресса в шапке (переполнение правой части), который прежний набор не ловил.
const VIEWPORTS = [
  { width: 390, height: 844, name: 'Mobile (390px)' },
  { width: 768, height: 1024, name: 'Tablet (768px)' },
  { width: 1024, height: 768, name: 'Laptop (1024px)' },
  { width: 1280, height: 800, name: 'Desktop (1280px)' },
  { width: 1366, height: 768, name: 'Desktop (1366px)' },
  { width: 1440, height: 900, name: 'Desktop (1440px)' },
  { width: 1920, height: 1080, name: 'Wide Desktop (1920px)' },
];

function setWindowDimensions(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

// QA-фикстура: сброс localStorage переводит прогон на детерминированный датасет
// и исключает реальные сетевые вызовы к биржам из E2E-прогона.
test.beforeEach(() => {
  resetBrowserStorage();
});

test.describe('Responsive Layout & Smoke Tests across Viewports', () => {
  test.afterEach(() => {
    cleanup();
  });

  for (const vp of VIEWPORTS) {
    test(`renders terminal correctly on ${vp.name} (${vp.width}x${vp.height}) without layout breaking`, async () => {
      setWindowDimensions(vp.width, vp.height);

      const { container } = render(
        <MemoryRouter initialEntries={['/']}>
          <MarketDataProviderComponent>
            <App />
          </MarketDataProviderComponent>
        </MemoryRouter>
      );

      // Shell verification
      expect(screen.getAllByText(/CRYPTORA/i).length).toBeGreaterThan(0);
      expect(screen.getByText('QA-ТИКЕР')).toBeInTheDocument();

      // Check root container exists
      const main = container.querySelector('main');
      expect(main).not.toBeNull();

      // Check that navigation controls exist for this viewport
      if (vp.width < 1024) {
        // Mobile / Tablet: hamburger menu toggle exists
        const menuBtn = screen.getByLabelText(/Меню/i);
        expect(menuBtn).toBeInTheDocument();
      } else {
        // Desktop: полная прямая навигация из 6 разделов без переносов
        for (const label of ['Обзор', 'Рынок', 'Фьючерсы', 'Ликвидации', 'Скринер', 'Радар']) {
          const links = screen.getAllByRole('link', { name: new RegExp(label, 'i') });
          expect(links.length).toBeGreaterThan(0);
          expect(links[0].className).toContain('whitespace-nowrap');
        }
      }
    });
  }

  test('Mobile (390px): interaction with mobile navigation menu and drawer', async () => {
    setWindowDimensions(390, 844);

    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketDataProviderComponent>
          <App />
        </MarketDataProviderComponent>
      </MemoryRouter>
    );

    // Open mobile menu
    const menuBtn = screen.getByLabelText(/Меню/i);
    fireEvent.click(menuBtn);

    // Verify mobile menu items are displayed
    expect(screen.getAllByText(/QA-ДАТАСЕТ/i).length).toBeGreaterThan(0);

    // Close mobile menu
    fireEvent.click(menuBtn);
  });
});
