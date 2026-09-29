/**
 * CRYPTORA — LoginPage social buttons follow the provider config (frontend).
 *
 * Buttons are rendered ONLY for providers /api/auth/providers reports as
 * configured; the email+password form is always present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { LoginPage } from '@/pages/LoginPage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function installFetch(providers: Record<string, unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path === '/api/auth/session') return jsonResponse(401, { error: 'guest' });
    if (path === '/api/auth/providers') return jsonResponse(200, providers);
    return jsonResponse(404, { error: 'not found' });
  });
}

function renderLogin(entry = '/login') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('LoginPage social buttons', () => {
  it('renders every configured provider with the divider', async () => {
    installFetch({
      emailPassword: true,
      emailVerification: true,
      google: true,
      telegram: true,
      yandex: true,
      vk: true,
      telegramBotName: 'cryptora_bot',
    });
    renderLogin();

    expect(await screen.findByTestId('social-google')).toHaveAttribute(
      'href',
      expect.stringContaining('/api/auth/oauth/google/start')
    );
    expect(screen.getByTestId('social-yandex')).toBeInTheDocument();
    expect(screen.getByTestId('social-vk')).toBeInTheDocument();
    expect(screen.getByTestId('telegram-widget')).toBeInTheDocument();
    expect(screen.getByText('или')).toBeInTheDocument();
  });

  it('renders only the configured subset', async () => {
    installFetch({
      emailPassword: true,
      emailVerification: true,
      google: true,
      telegram: false,
      yandex: false,
      vk: false,
      telegramBotName: null,
    });
    renderLogin();

    expect(await screen.findByTestId('social-google')).toBeInTheDocument();
    expect(screen.queryByTestId('social-yandex')).not.toBeInTheDocument();
    expect(screen.queryByTestId('social-vk')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telegram-widget')).not.toBeInTheDocument();
  });

  it('renders NO social section when nothing is configured (and the form still works)', async () => {
    installFetch({
      emailPassword: true,
      emailVerification: true,
      google: false,
      telegram: false,
      yandex: false,
      vk: false,
      telegramBotName: null,
    });
    renderLogin();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/providers', expect.anything());
    });
    expect(screen.queryByText('или')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
  });

  it('shows the post-verification notice from /login?verified=1', async () => {
    installFetch({
      emailPassword: true,
      emailVerification: true,
      google: false,
      telegram: false,
      yandex: false,
      vk: false,
      telegramBotName: null,
    });
    renderLogin('/login?verified=1');
    expect(await screen.findByText('Email подтверждён — теперь войдите')).toBeInTheDocument();
  });

  it('maps oauth_error codes to human-readable messages', async () => {
    installFetch({
      emailPassword: true,
      emailVerification: true,
      google: true,
      telegram: false,
      yandex: false,
      vk: false,
      telegramBotName: null,
    });
    renderLogin('/login?oauth_error=email_exists');
    expect(
      await screen.findByText(/Аккаунт с таким email уже существует/)
    ).toBeInTheDocument();
  });

  it('registration link is present', async () => {
    installFetch({
      emailPassword: true,
      emailVerification: true,
      google: false,
      telegram: false,
      yandex: false,
      vk: false,
      telegramBotName: null,
    });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Регистрация' });
    expect(link).toHaveAttribute('href', '/register');
  });
});
