import './setup-dom';
import { test, expect } from '@playwright/test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import App from '@/App';

function setWindowDimensions(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

test.describe('UI/UX Premium Redesign Regression Suite', () => {
  test.afterEach(() => {
    cleanup();
  });

  test('Header at 1280px: fits without text wrapping and displays primary nav + dropdowns', async () => {
    setWindowDimensions(1280, 800);

    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketDataProviderComponent>
          <App />
        </MarketDataProviderComponent>
      </MemoryRouter>
    );

    // Verify Brand
    expect(screen.getAllByText(/CRYPTORA/i).length).toBeGreaterThan(0);

    // Primary visible links exist with whitespace-nowrap styling
    const overviewLink = screen.getAllByRole('link', { name: /Обзор/i })[0];
    expect(overviewLink).toBeInTheDocument();
    expect(overviewLink.className).toContain('whitespace-nowrap');

    const marketLink = screen.getAllByRole('link', { name: /Рынок/i })[0];
    expect(marketLink).toBeInTheDocument();
    expect(marketLink.className).toContain('whitespace-nowrap');

    const futuresLink = screen.getAllByRole('link', { name: /Фьючерсы/i })[0];
    expect(futuresLink).toBeInTheDocument();

    const liquidationsLink = screen.getAllByRole('link', { name: /Ликвидации/i })[0];
    expect(liquidationsLink).toBeInTheDocument();

    const screenerLink = screen.getAllByRole('link', { name: /Скринер/i })[0];
    expect(screenerLink).toBeInTheDocument();

    const radarLink = screen.getAllByRole('link', { name: /Радар/i })[0];
    expect(radarLink).toBeInTheDocument();

    // Secondary navigation dropdown triggers exist
    const analyticsBtn = screen.getByRole('button', { name: /Аналитика/i });
    expect(analyticsBtn).toBeInTheDocument();
    expect(analyticsBtn.className).toContain('whitespace-nowrap');

    const toolsBtn = screen.getByRole('button', { name: /Инструменты/i });
    expect(toolsBtn).toBeInTheDocument();
    expect(toolsBtn.className).toContain('whitespace-nowrap');
  });

  test('Dropdown Navigation: opens on click, renders items, and closes on Escape', async () => {
    setWindowDimensions(1440, 900);

    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketDataProviderComponent>
          <App />
        </MarketDataProviderComponent>
      </MemoryRouter>
    );

    const analyticsBtn = screen.getByRole('button', { name: /Аналитика/i });

    // Click to open
    fireEvent.click(analyticsBtn);

    // Verify sub-items inside dropdown menu
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Карта рынка')).toBeInTheDocument();
    expect(screen.getByText('Корреляции')).toBeInTheDocument();
    expect(screen.getByText('Он-чейн')).toBeInTheDocument();
    expect(screen.getByText('Экосистемы')).toBeInTheDocument();
    expect(screen.getByText('Календарь')).toBeInTheDocument();

    // Close with Escape key
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    // Tools dropdown test
    const toolsBtn = screen.getByRole('button', { name: /Инструменты/i });
    fireEvent.click(toolsBtn);

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Портфель')).toBeInTheDocument();
    expect(screen.getByText('Журнал')).toBeInTheDocument();
    expect(screen.getByText('Стратегии')).toBeInTheDocument();
    expect(screen.getByText('Сигналы')).toBeInTheDocument();

    // Close tools dropdown
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Mobile navigation (< 1024px): toggle button displays menu with categorized sections', async () => {
    setWindowDimensions(390, 844);

    render(
      <MemoryRouter initialEntries={['/']}>
        <MarketDataProviderComponent>
          <App />
        </MarketDataProviderComponent>
      </MemoryRouter>
    );

    const menuBtn = screen.getByLabelText(/Меню/i);
    expect(menuBtn).toBeInTheDocument();

    // Open mobile menu
    fireEvent.click(menuBtn);

    expect(screen.getByText('Основные разделы')).toBeInTheDocument();
    expect(screen.getAllByText('Аналитика').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Инструменты').length).toBeGreaterThan(0);

    // Close mobile menu
    fireEvent.click(menuBtn);
  });

  test('Viewports layout smoke check: 390, 768, 1024, 1280, 1440, 1920', async () => {
    const viewports = [390, 768, 1024, 1280, 1440, 1920];

    for (const w of viewports) {
      setWindowDimensions(w, 800);
      const { container } = render(
        <MemoryRouter initialEntries={['/']}>
          <MarketDataProviderComponent>
            <App />
          </MarketDataProviderComponent>
        </MemoryRouter>
      );

      expect(container.querySelector('header')).not.toBeNull();
      expect(container.querySelector('main')).not.toBeNull();
      expect(container.querySelector('footer')).not.toBeNull();
      cleanup();
    }
  });
});
