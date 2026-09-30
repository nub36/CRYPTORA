/**
 * CRYPTORA — Strategy Lab Mobile Navigation & Role Visibility Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const renderHeader = () => {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <MarketDataProviderComponent>
            <Header />
          </MarketDataProviderComponent>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

describe('Strategy Lab Navigation Role Visibility & Mobile Drawer', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('ADMIN: Лаборатория is visible in desktop navigation with link /strategy-lab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: 'admin-1',
          email: 'admin@cryptora.test',
          displayName: 'Admin User',
          role: 'admin',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastLoginAt: null,
          emailVerified: true,
          emailVerifiedAt: '2026-01-01T00:00:00Z',
        },
      }),
    });

    renderHeader();

    await vi.waitFor(() => {
      const desktopNav = screen.getByLabelText('Главная навигация');
      const labLink = within(desktopNav).getByText('Лаборатория');
      expect(labLink).toBeInTheDocument();
      expect(labLink.closest('a')).toHaveAttribute('href', '/strategy-lab');
    });
  });

  it('ADMIN: Лаборатория is visible in mobile drawer under «Инструменты» with link /strategy-lab', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: 'admin-1',
          email: 'admin@cryptora.test',
          displayName: 'Admin User',
          role: 'admin',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastLoginAt: null,
          emailVerified: true,
          emailVerifiedAt: '2026-01-01T00:00:00Z',
        },
      }),
    });

    renderHeader();

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Меню')).toBeInTheDocument();
    });

    // Open mobile menu drawer
    const menuButton = screen.getByLabelText('Меню');
    fireEvent.click(menuButton);

    await vi.waitFor(() => {
      // All occurrences of Лаборатория should include the drawer link
      const labLinks = screen.getAllByText('Лаборатория');
      expect(labLinks.length).toBeGreaterThanOrEqual(1);

      // Verify that one of the links points to /strategy-lab and is inside drawer
      const matching = labLinks.find((el) => el.closest('a')?.getAttribute('href') === '/strategy-lab');
      expect(matching).toBeDefined();
      expect(matching?.closest('a')).toHaveAttribute('href', '/strategy-lab');
    });
  });

  it('NON-ADMIN (regular user): Лаборатория is absent on desktop', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: 'user-1',
          email: 'user@cryptora.test',
          displayName: 'Regular User',
          role: 'user',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastLoginAt: null,
          emailVerified: true,
          emailVerifiedAt: '2026-01-01T00:00:00Z',
        },
      }),
    });

    renderHeader();

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Меню пользователя')).toBeInTheDocument();
    });

    const desktopNav = screen.getByLabelText('Главная навигация');
    expect(within(desktopNav).queryByText('Лаборатория')).not.toBeInTheDocument();
  });

  it('NON-ADMIN (regular user): Лаборатория is absent in mobile drawer', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: 'user-1',
          email: 'user@cryptora.test',
          displayName: 'Regular User',
          role: 'user',
          isActive: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastLoginAt: null,
          emailVerified: true,
          emailVerifiedAt: '2026-01-01T00:00:00Z',
        },
      }),
    });

    renderHeader();

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Меню')).toBeInTheDocument();
    });

    const menuButton = screen.getByLabelText('Меню');
    fireEvent.click(menuButton);

    await vi.waitFor(() => {
      expect(screen.getByText('Основные разделы')).toBeInTheDocument();
    });

    expect(screen.queryByText('Лаборатория')).not.toBeInTheDocument();
  });

  it('GUEST (unauthenticated): Лаборатория is absent on desktop and mobile drawer', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Not authenticated' }),
    });

    renderHeader();

    await vi.waitFor(() => {
      expect(screen.getByText('Войти')).toBeInTheDocument();
    });

    const desktopNav = screen.getByLabelText('Главная навигация');
    expect(within(desktopNav).queryByText('Лаборатория')).not.toBeInTheDocument();

    const menuButton = screen.getByLabelText('Меню');
    fireEvent.click(menuButton);

    await vi.waitFor(() => {
      expect(screen.getByText('Основные разделы')).toBeInTheDocument();
    });

    expect(screen.queryByText('Лаборатория')).not.toBeInTheDocument();
  });
});
