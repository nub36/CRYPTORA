/**
 * useServerSignalNotifications — питание продакшн-колокольчика серверной лентой.
 *
 * Проверяется поведение, которое легко сломать:
 *   • РОВНО ОДИН ограниченный запрос за цикл (нет веера по вселенной);
 *   • первая синхронизация «сеет базу» и не звонит по уже существующим сигналам;
 *   • появление/переход статуса на сервере даёт ровно одно событие;
 *   • отказ источника — честная ошибка в аудите, уже показанные события целы;
 *   • карантинные строки в ленту не попадают (проверено на уровне хука тоже).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { SignalDto, SignalFilters, SignalsPageDto } from '@/services/strategyOps';
import { useServerSignalNotifications } from '@/hooks/useServerSignalNotifications';
import {
  ServerSignalNotificationCenter,
} from '@/services/signals/serverSignalNotifications';

function serverSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: '9d1e2f30-1111-4222-8333-444455556666',
    strategyId: 'V3_3_HTF_ZONE_MITIGATION',
    strategyVersion: '3.3',
    engineSetupId: null,
    symbol: 'RUNE/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-24T15:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: null,
    entryMin: 0.6312,
    entryMax: 0.6418,
    stopLoss: 0.6104,
    targets: [0.6552],
    tp1: 0.6552,
    tp2: null,
    status: 'ACTIVE',
    createdAt: '2026-09-24T15:01:10.361Z',
    updatedAt: '2026-09-24T15:01:10.361Z',
    fillPrice: null,
    filledAt: null,
    fillStop: null,
    fillTargets: null,
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    metadata: null,
    hash: 'h'.repeat(64),
    previousHash: 'p'.repeat(64),
    outcomeHash: null,
    chainVersion: 2,
    provenanceStatus: 'VERIFIED',
    ...overrides,
  };
}

function page(signals: SignalDto[]): SignalsPageDto {
  return {
    signals,
    count: signals.length,
    total: signals.length,
    limit: 50,
    offset: 0,
    maxLimit: 200,
    ordering: 'created_at_desc',
    appliedFilters: { strategyId: null, status: null, open: null, symbol: null, direction: null },
    statuses: ['ACTIVE', 'FILLED', 'TARGET_REACHED', 'INVALIDATED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNRESOLVED'],
    openStatuses: ['ACTIVE', 'FILLED'],
    source: 'server',
  };
}

let center: ServerSignalNotificationCenter;

beforeEach(() => {
  // Изоляция: jsdom-localStorage общий на файл, а продакшн-лента версионируется.
  localStorage.clear();
  center = new ServerSignalNotificationCenter('cryptora_signal_notifications_v2_test');
  center.start(null);
});

afterEach(() => {
  cleanup();
  center.resetForTests();
});

describe('useServerSignalNotifications: серверная лента → колокольчик', () => {
  it('первая синхронизация не создаёт событий по существующим сигналам', async () => {
    const fetchPage = vi.fn<(filters?: SignalFilters, init?: RequestInit) => Promise<SignalsPageDto>>(
      async () => page([serverSignal()])
    );
    const { result } = renderHook(() =>
      useServerSignalNotifications({ center, fetchPage, pollMs: 0 })
    );

    await waitFor(() => expect(result.current.requestCount).toBe(1));
    await waitFor(() => expect(result.current.audit.considered).toBe(1));
    expect(result.current.notifications).toEqual([]);
    // Один запрос — одна страница, никакого веера.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]![0]?.limit).toBe(50);
  });

  it('переход ACTIVE → FILLED даёт одно событие с серверным id', async () => {
    let status: SignalDto['status'] = 'ACTIVE';
    const fetchPage = vi.fn(async () =>
      page([
        serverSignal(
          status === 'FILLED'
            ? { status: 'FILLED', fillPrice: 0.6321, filledAt: '2026-09-24T16:02:00.000Z' }
            : {}
        ),
      ])
    );

    const { result } = renderHook(() =>
      useServerSignalNotifications({ center, fetchPage, pollMs: 0 })
    );
    await waitFor(() => expect(result.current.audit.considered).toBe(1));
    expect(result.current.notifications).toEqual([]);

    status = 'FILLED';
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    const notification = result.current.notifications[0]!;
    expect(notification.kind).toBe('FILL');
    expect(notification.signalId).toBe('9d1e2f30-1111-4222-8333-444455556666');
    expect(notification.detail).toContain('RUNE/USDT');
    expect(result.current.unreadCount).toBe(1);
  });

  it('карантинные строки серверной ленты в колокольчик не попадают', async () => {
    const fetchPage = vi.fn(async () =>
      page([
        serverSignal({ id: 'mismatch-id', provenanceStatus: 'MISMATCH' }),
        serverSignal({ id: 'unknown-id', provenanceStatus: 'UNKNOWN' }),
      ])
    );
    const { result } = renderHook(() =>
      useServerSignalNotifications({ center, fetchPage, pollMs: 0 })
    );

    await waitFor(() => expect(result.current.audit.considered).toBe(2));
    expect(result.current.notifications).toEqual([]);
    expect(result.current.audit.excludedMismatch).toBe(1);
    expect(result.current.audit.excludedUnknown).toBe(1);
  });

  it('отказ источника честен: ошибка в аудите, показанные события не удалены', async () => {
    let fail = false;
    const fetchPage = vi.fn(async () => {
      if (fail) {
        const error = new Error('DB_UNAVAILABLE') as Error & { status?: number };
        error.status = 500;
        throw error;
      }
      return page([serverSignal()]);
    });

    const { result } = renderHook(() =>
      useServerSignalNotifications({ center, fetchPage, pollMs: 0 })
    );
    await waitFor(() => expect(result.current.audit.considered).toBe(1));

    // Событие приходит до отказа, чтобы проверить, что оно не исчезнет.
    act(() => {
      center.ingest([serverSignal({ status: 'FILLED', fillPrice: 0.6321, filledAt: '2026-09-24T16:02:00.000Z' })]);
    });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    fail = true;
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.audit.lastError).toBe('DB_UNAVAILABLE'));
    expect(result.current.notifications).toHaveLength(1);
  });

  it('отключённая лента не делает запросов', async () => {
    const fetchPage = vi.fn(async () => page([]));
    renderHook(() => useServerSignalNotifications({ center, fetchPage, pollMs: 0, enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('markAllRead и clear управляют лентой, не порождая новых событий', async () => {
    const fetchPage = vi.fn(async () => page([serverSignal()]));
    const { result } = renderHook(() =>
      useServerSignalNotifications({ center, fetchPage, pollMs: 0 })
    );
    await waitFor(() => expect(result.current.audit.considered).toBe(1));

    act(() => {
      center.ingest([serverSignal({ status: 'FILLED', fillPrice: 0.6321, filledAt: '2026-09-24T16:02:00.000Z' })]);
    });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      result.current.markAllRead();
    });
    expect(result.current.unreadCount).toBe(0);

    await act(async () => {
      result.current.clear();
    });
    expect(result.current.notifications).toEqual([]);
    // Повторная синхронизация той же ленты ничего не «вспоминает» заново.
    act(() => {
      center.ingest([serverSignal({ status: 'FILLED', fillPrice: 0.6321 })]);
    });
    expect(result.current.notifications).toEqual([]);
  });
});
