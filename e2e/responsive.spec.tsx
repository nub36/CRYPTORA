import './setup-dom';
import { test, expect } from '@playwright/test';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';
import App from '@/App';

const VIEWPORTS = [
  { width: 390, height: 844, name: 'Mobile (390px)' },
  { width: 768, height: 1024, name: 'Tablet (768px)' },
  { width: 1024, height: 768, name: 'Laptop (1024px)' },
  { width: 1440, height: 900, name: 'Desktop (1440px)' },
  { width: 1920, height: 1080, name: 'Wide Desktop (1920px)' },
];

function setWindowDimensions(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

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
      expect(screen.getByText('DEMO TICKER')).toBeInTheDocument();

      // Check root container exists
      const main = container.querySelector('main');
      expect(main).not.toBeNull();

      // Check that navigation controls exist for this viewport
      if (vp.width < 1024) {
        // Mobile / Tablet: hamburger menu toggle exists
        const menuBtn = screen.getByLabelText(/Меню/i);
        expect(menuBtn).toBeInTheDocument();
      } else {
        // Desktop: navigation links exist
        const overviewLinks = screen.getAllByRole('link', { name: /Обзор/i });
        expect(overviewLinks.length).toBeGreaterThan(0);
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
    expect(screen.getByText(/ДЕМОНСТРАЦИОННЫЙ РЕЖИМ/i)).toBeInTheDocument();

    // Close mobile menu
    fireEvent.click(menuBtn);
  });
});
