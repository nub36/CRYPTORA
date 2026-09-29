/**
 * CRYPTORA — RegisterPage 2-step flow (frontend).
 *
 * Step 1 (email + password + confirmation) → step 2 (6-digit code entry with
 * paste support, resend cooldown, precise error states). fetch is mocked;
 * the real AuthContext + RegisterPage components run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { RegisterPage } from '@/pages/RegisterPage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const EMAIL = 'alice@example.com';
const PASSWORD = 'password1234';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Default route handlers; individual tests override verify/resend behaviour. */
function installFetch(overrides: Record<string, (init?: RequestInit) => unknown> = {}) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (overrides[path]) return overrides[path](init);
    if (path === '/api/auth/session') return jsonResponse(401, { error: 'guest' });
    if (path === '/api/auth/registration-status') return jsonResponse(200, { registrationOpen: true });
    if (path === '/api/auth/register') {
      return jsonResponse(201, {
        user: { id: 'u1', email: EMAIL, displayName: 'alice', role: 'user', emailVerified: false },
        verification: { required: true, method: 'code', emailMasked: 'a***@example.com', delivery: 'sent', ttlMinutes: 10, resendCooldownSeconds: 60 },
      });
    }
    if (path === '/api/auth/verify-code') return jsonResponse(200, { status: 'ok' });
    if (path === '/api/auth/resend-verification') return jsonResponse(200, { status: 'ok' });
    return jsonResponse(404, { error: 'not found' });
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>
    </MemoryRouter>
  );
}

async function fillStep1AndSubmit(password = PASSWORD, confirm = password) {
  await userEvent.type(screen.getByLabelText('Email'), EMAIL);
  await userEvent.type(screen.getByLabelText('Пароль'), password);
  await userEvent.type(screen.getByLabelText('Повторите пароль'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
}

beforeEach(() => {
  mockFetch.mockReset();
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('step 1 — registration form', () => {
  it('renders email, password and confirmation — and NO name field', async () => {
    renderPage();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByLabelText('Повторите пароль')).toBeInTheDocument();
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument();
  });

  it('refuses mismatched passwords locally (no network call)', async () => {
    renderPage();
    await fillStep1AndSubmit(PASSWORD, 'different-pass');
    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith('/api/auth/register', expect.anything());
  });

  it('successful registration switches to the code step with a masked email', async () => {
    renderPage();
    await fillStep1AndSubmit();

    expect(await screen.findByText('Подтвердите email')).toBeInTheDocument();
    expect(screen.getByText('a****@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('code-digit-0')).toBeInTheDocument();
    // Password is not persisted anywhere.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not send displayName and never persists the password', async () => {
    renderPage();
    await fillStep1AndSubmit();
    await screen.findByText('Подтвердите email');

    const registerCall = mockFetch.mock.calls.find(([u]) => u === '/api/auth/register')!;
    const body = JSON.parse((registerCall[1] as RequestInit).body as string);
    expect(body).toEqual({ email: EMAIL, password: PASSWORD });
    expect(localStorage.getItem('password')).toBeNull();
  });

  it('shows the server error on failure', async () => {
    installFetch({
      '/api/auth/register': () => jsonResponse(409, { error: 'Email уже зарегистрирован' }),
    });
    renderPage();
    await fillStep1AndSubmit();
    expect(await screen.findByText('Email уже зарегистрирован')).toBeInTheDocument();
  });
});

describe('step 2 — code entry', () => {
  async function toStep2() {
    renderPage();
    await fillStep1AndSubmit();
    await screen.findByText('Подтвердите email');
  }

  it('pasting the full 6-digit code fills every box and auto-submits', async () => {
    await toStep2();

    const first = screen.getByTestId('code-digit-0');
    await act(async () => {
      fireEvent.paste(first, { clipboardData: { getData: () => '381742' } });
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/verify-code',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: EMAIL, code: '381742' }),
        })
      );
    });
  });

  it('typing digits advances focus; submit enables at 6 digits', async () => {
    await toStep2();
    const submit = screen.getByRole('button', { name: 'Подтвердить' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId('code-digit-0'), '123456');
    await waitFor(() => {
      // onComplete fires automatically; the code inputs carry the digits.
      expect((screen.getByTestId('code-digit-5') as HTMLInputElement).value).toBe('6');
    });
  });

  it('inputs use the mobile numeric keyboard', async () => {
    await toStep2();
    const input = screen.getByTestId('code-digit-0');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('pattern', '[0-9]*');
  });

  it('an invalid code shows the precise error state', async () => {
    installFetch({
      '/api/auth/verify-code': () => jsonResponse(400, { error: 'INVALID', message: 'Неверный код' }),
    });
    await toStep2();
    await act(async () => {
      fireEvent.paste(screen.getByTestId('code-digit-0'), { clipboardData: { getData: () => '000000' } });
    });
    expect(await screen.findByText(/Неверный код/)).toBeInTheDocument();
  });

  it('an expired code prompts for a new one and disables further entry', async () => {
    installFetch({
      '/api/auth/verify-code': () => jsonResponse(410, { error: 'EXPIRED', message: 'истёк' }),
    });
    await toStep2();
    await act(async () => {
      fireEvent.paste(screen.getByTestId('code-digit-0'), { clipboardData: { getData: () => '111111' } });
    });
    expect(await screen.findByText(/Срок действия кода истёк/)).toBeInTheDocument();
    expect(screen.getByTestId('code-digit-0')).toBeDisabled();
  });

  it('too many attempts shows the lockout error', async () => {
    installFetch({
      '/api/auth/verify-code': () => jsonResponse(429, { error: 'TOO_MANY_ATTEMPTS', message: 'много' }),
    });
    await toStep2();
    await act(async () => {
      fireEvent.paste(screen.getByTestId('code-digit-0'), { clipboardData: { getData: () => '222222' } });
    });
    expect(await screen.findByText(/Слишком много попыток. Запросите новый код./)).toBeInTheDocument();
  });

  it('shows the resend cooldown as mm:ss and unlocks the resend button afterwards', async () => {
    await toStep2();

    // Cooldown starts at 60s → "01:00" then a "00:59"-style countdown.
    expect(screen.getByTestId('resend-block').textContent).toMatch(/Отправить код повторно через \d{2}:\d{2}/);
    await waitFor(
      () => {
        expect(screen.getByTestId('resend-block').textContent).toMatch(/00:5\d/);
      },
      { timeout: 3000 }
    );
    expect(screen.queryByRole('button', { name: 'Отправить новый код' })).not.toBeInTheDocument();
  });

  it('"Изменить email" returns to step 1 with the email prefilled', async () => {
    await toStep2();
    await userEvent.click(screen.getByRole('button', { name: /Изменить email/ }));
    const emailInput = (await screen.findByLabelText('Email')) as HTMLInputElement;
    expect(emailInput.value).toBe(EMAIL);
    // The password fields are cleared — never carried across steps.
    expect((screen.getByLabelText('Пароль') as HTMLInputElement).value).toBe('');
  });
});

describe('closed registration', () => {
  it('renders the closed state when the backend says so', async () => {
    installFetch({
      '/api/auth/registration-status': () => jsonResponse(200, { registrationOpen: false }),
    });
    renderPage();
    expect(await screen.findByText('Регистрация временно закрыта')).toBeInTheDocument();
  });
});
