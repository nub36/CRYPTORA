import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const save = vi.fn();
const testTelegram = vi.fn();
const setAlertChannels = vi.fn();
let canonical = {
  browser: { enabled: false },
  telegram: { enabled: false, botToken: '', chatId: '', tokenConfigured: false },
  webhook: { enabled: false, url: '' },
};

vi.mock('@/services/alerts/notificationSettingsApi', () => ({
  saveNotificationChannels: (...args: unknown[]) => save(...args),
  testTelegramChannel: (...args: unknown[]) => testTelegram(...args),
}));

vi.mock('@/context/MarketDataContext', () => ({
  useMarketData: () => ({
    isAlertsModalOpen: true,
    closeAlertsModal: vi.fn(),
    alerts: [], addAlert: vi.fn(), removeAlert: vi.fn(), toggleAlertPaused: vi.fn(),
    alertHistory: [], clearAlertHistory: vi.fn(), markAlertsRead: vi.fn(), unreadAlertCount: 0,
    signalNotifications: [], signalUnreadCount: 0,
    signalNotificationsAudit: { excludedMismatch: 0, excludedUnknown: 0, lastError: null },
    markSignalsRead: vi.fn(), clearSignalNotifications: vi.fn(),
    localAuditNotifications: [], localAuditUnreadCount: 0, markLocalAuditRead: vi.fn(), clearLocalAuditNotifications: vi.fn(),
    alertChannels: canonical, setAlertChannels, deliveryLog: [],
    userPlan: 'PRO', dataMode: 'live', liveFunding: {},
  }),
}));
vi.mock('@/hooks/useLivePrices', () => ({ useLivePriceMap: () => ({}) }));

const { AlertsModal } = await import('@/components/layout/AlertsModal');

function renderModal() {
  return render(<MemoryRouter><AlertsModal /></MemoryRouter>);
}

function byQa<T extends Element = HTMLElement>(value: string): T {
  const element = document.querySelector(`[data-qa="${value}"]`);
  if (!element) throw new Error(`Missing data-qa=${value}`);
  return element as T;
}

async function openChannels() {
  await userEvent.click(screen.getByRole('button', { name: 'Каналы' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  canonical = {
    browser: { enabled: false },
    telegram: { enabled: false, botToken: '', chatId: '', tokenConfigured: false },
    webhook: { enabled: false, url: '' },
  };
  save.mockImplementation(async (value) => ({ ...value, telegram: { ...value.telegram, botToken: '', tokenConfigured: true } }));
  testTelegram.mockResolvedValue('Уведомление отправлено');
});

describe('notification channels modal', () => {
  it('saves enabled Telegram including a valid negative group chat ID and shows feedback', async () => {
    renderModal();
    await openChannels();
    await userEvent.click(screen.getAllByLabelText('Включить')[1]);
    await userEvent.type(byQa<HTMLInputElement>('tg-token'), '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0');
    await userEvent.type(byQa<HTMLInputElement>('tg-chat'), '-1001234567890');
    await userEvent.click(byQa<HTMLButtonElement>('channels-save'));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].telegram.chatId).toBe('-1001234567890');
    expect(setAlertChannels).toHaveBeenCalledWith(expect.objectContaining({ telegram: expect.objectContaining({ tokenConfigured: true, botToken: '' }) }));
    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
  });

  it('saves then tests Telegram, with an accessible mobile-width button', async () => {
    canonical = {
      ...canonical,
      telegram: { enabled: true, botToken: '', chatId: '42', tokenConfigured: true },
    };
    renderModal();
    await openChannels();
    const button = byQa<HTMLButtonElement>('telegram-test');
    expect(button.className).toContain('w-full');
    await userEvent.click(button);
    await waitFor(() => expect(testTelegram).toHaveBeenCalledTimes(1));
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(testTelegram.mock.invocationCallOrder[0]);
    expect(await screen.findByText('Уведомление отправлено')).toBeInTheDocument();
  });

  it('does not let an invalid disabled channel block another settings save', async () => {
    renderModal();
    await openChannels();
    await userEvent.type(byQa<HTMLInputElement>('wh-url'), 'bad-url');
    await userEvent.click(byQa<HTMLButtonElement>('channels-save'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
