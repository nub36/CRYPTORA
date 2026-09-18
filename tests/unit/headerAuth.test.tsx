/**
 * CRYPTORA — Header Auth UI Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { MarketDataProviderComponent } from '@/context/MarketDataContext';

// Mock fetch
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

describe('Header Auth UI', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('shows login/register buttons for guests', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Not authenticated' }),
    });

    renderHeader();

    // Wait for auth to resolve
    await vi.waitFor(() => {
      expect(screen.getByText('Войти')).toBeInTheDocument();
    });

    expect(screen.getByText('Регистрация')).toBeInTheDocument();
  });

  it('shows user menu for authenticated users', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: '123',
          email: 'test@example.com',
          displayName: 'Test User',
          role: 'user',
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z',
          lastLoginAt: null,
        },
      }),
    });

    renderHeader();

    // Wait for auth to resolve
    await vi.waitFor(() => {
      expect(screen.queryByText('Войти')).not.toBeInTheDocument();
    });

    // User menu button should be present (with user icon)
    const userMenuButton = screen.getByLabelText('Меню пользователя');
    expect(userMenuButton).toBeInTheDocument();
  });

  it('shows admin link for admin users', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: '123',
          email: 'admin@example.com',
          displayName: 'Admin User',
          role: 'admin',
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z',
          lastLoginAt: null,
        },
      }),
    });

    renderHeader();

    // Wait for auth to resolve
    await vi.waitFor(() => {
      expect(screen.queryByText('Войти')).not.toBeInTheDocument();
    });

    // Click user menu to open it
    const userMenuButton = screen.getByLabelText('Меню пользователя');
    userMenuButton.click();

    // Wait for menu to open and check for admin link
    await vi.waitFor(() => {
      expect(screen.getByText('Админка')).toBeInTheDocument();
    });
  });
});