/**
 * CRYPTORA — Auth Context Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import React from 'react';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const TestComponent: React.FC = () => {
  const { user, isAuthenticated, isAdmin, isLoading } = useAuth();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'loaded'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'yes' : 'no'}</div>
      <div data-testid="admin">{isAdmin ? 'yes' : 'no'}</div>
      <div data-testid="user">{user?.displayName || 'none'}</div>
    </div>
  );
};

const renderWithProviders = () => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    </BrowserRouter>
  );
};

describe('AuthContext', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
    renderWithProviders();
    expect(screen.getByTestId('loading').textContent).toBe('loading');
  });

  it('handles unauthenticated state (401)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Not authenticated' }),
    });

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    expect(screen.getByTestId('authenticated').textContent).toBe('no');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('handles authenticated user', async () => {
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

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('yes');
    });

    expect(screen.getByTestId('user').textContent).toBe('Test User');
    expect(screen.getByTestId('admin').textContent).toBe('no');
  });

  it('identifies admin user', async () => {
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

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('admin').textContent).toBe('yes');
    });
  });

  it('handles network error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('loaded');
    });

    // Should not crash, just show as unauthenticated
    expect(screen.getByTestId('authenticated').textContent).toBe('no');
  });
});