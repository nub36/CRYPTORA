import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MarketRadarPreview } from '@/components/market/MarketRadarPreview';
import { AnalyticsSetupsPreview } from '@/components/market/AnalyticsSetupsPreview';
import { mergeRadarEvents } from '@/services/realtime/radarEventFeed';
import type { RadarEvent } from '@/types/market';

const radarEvent = (overrides: Partial<RadarEvent> = {}): RadarEvent => ({
  id: 'radar-live-1',
  timestamp: '2026-09-23T07:00:00.000Z',
  symbol: 'BTC',
  type: 'PRICE_MOVE',
  severity: 'HIGH',
  metricValue: '+2.7%',
  observation: 'Фактический ценовой импульс из потока тикеров.',
  isDemo: false,
  ...overrides,
});

const renderInRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Market Radar preview', () => {
  it('renders real provider/WebSocket events with their type, value and observation', () => {
    renderInRouter(<MarketRadarPreview events={[radarEvent()]} isDemoMode={false} />);

    const card = screen.getByTestId('market-radar-preview');
    expect(within(card).getByText('BTC')).toBeTruthy();
    expect(within(card).getByText('+2.7%')).toBeTruthy();
    expect(within(card).getByText('Фактический ценовой импульс из потока тикеров.')).toBeTruthy();
    const expectedLocalTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date('2026-09-23T07:00:00.000Z'));
    expect(within(card).getByText(expectedLocalTime)).toBeTruthy();
    expect(screen.getByTestId('market-radar-events')).toBeTruthy();
  });

  it('shows a compact explicit empty state and does not stretch an empty list', () => {
    renderInRouter(<MarketRadarPreview events={[]} isDemoMode={false} />);

    expect(screen.getByText('Новых рыночных событий пока нет')).toBeTruthy();
    expect(screen.getByTestId('market-radar-empty')).toBeTruthy();
    expect(screen.queryByTestId('market-radar-events')).toBeNull();
    const card = screen.getByTestId('market-radar-preview');
    expect(card.className).toContain('self-start');
    expect(card.className).not.toContain('flex-1');
    expect(card.innerHTML).not.toContain('max-h-96');
  });

  it('deduplicates and sorts factual events while excluding QA events in live mode', () => {
    const older = radarEvent({ id: 'older', timestamp: '2026-09-23T06:00:00.000Z' });
    const newest = radarEvent({ id: 'newest', timestamp: '2026-09-23T07:10:00.000Z' });
    const qa = radarEvent({ id: 'qa', isDemo: true, timestamp: '2026-09-23T07:20:00.000Z' });
    const malformed = radarEvent({ id: 'bad-time', timestamp: 'not-a-timestamp' });

    expect(mergeRadarEvents([older], [older, newest, qa, malformed]).map((event) => event.id)).toEqual(['newest', 'older']);
    expect(mergeRadarEvents([], [qa], { includeDemo: true }).map((event) => event.id)).toEqual(['qa']);
  });
});

describe('Analytics setup preview provenance', () => {
  const baseProps = {
    btcPrice: null,
    btcPriceSource: null,
    openInterestUsd: null,
    openInterestSource: null,
    openInterestDelta24h: null,
    openInterestDeltaSource: null,
    fundingRate8h: null,
    fundingSource: null,
    rsi14: null,
    rsiSource: null,
    isDemoMode: false,
  };

  it('does not replace missing live inputs with prototype values or imply an entry/invalidation', () => {
    renderInRouter(<AnalyticsSetupsPreview {...baseProps} />);

    const preview = screen.getByTestId('analytics-setups-preview');
    expect(within(preview).getByText('НЕТ SETUP · НЕ СИГНАЛ')).toBeTruthy();
    expect(within(preview).getAllByText('Не рассчитан — нет подключённого алгоритма')).toHaveLength(2);
    expect(within(preview).getAllByTestId('analytics-fact-value').map((node) => node.textContent)).toEqual(['—', '— / —', '—', '—']);
    expect(preview.textContent).not.toContain('$64,200');
    expect(preview.textContent).not.toContain('$64,800');
    expect(preview.textContent).not.toContain('$62,900');
    expect(preview.textContent).not.toContain('7.2%');
    expect(preview.textContent).not.toContain('68.4');
  });

  it('renders available market inputs with their exchange/formula provenance, still not as a signal', () => {
    renderInRouter(
      <AnalyticsSetupsPreview
        {...baseProps}
        btcPrice={67_123.45}
        btcPriceSource="Binance spot ticker через getAssets()"
        openInterestUsd={12_345_678}
        openInterestSource="Binance USD-M /fapi/v1/openInterest × markPrice"
        openInterestDelta24h={2.35}
        openInterestDeltaSource="Binance /futures/data/openInterestHist · hourly series"
        fundingRate8h={0.0123}
        fundingSource="Binance USD-M /fapi/v1/premiumIndex · lastFundingRate × 100"
        rsi14={54.21}
        rsiSource="Binance 1h closes · Wilder RSI-14"
      />,
    );

    const preview = screen.getByTestId('analytics-setups-preview');
    expect(within(preview).getByText('$67,123.45')).toBeTruthy();
    expect(within(preview).getByText('$12.35M / +2.35%')).toBeTruthy();
    expect(within(preview).getByText('+0.0123%')).toBeTruthy();
    expect(within(preview).getByText('54.21')).toBeTruthy();
    expect(preview.textContent).toContain('Wilder RSI-14');
    expect(preview.textContent).toContain('НЕТ SETUP · НЕ СИГНАЛ');
  });

  it('labels QA values as fixtures, not live analytics', () => {
    renderInRouter(
      <AnalyticsSetupsPreview
        {...baseProps}
        btcPrice={65_000}
        btcPriceSource="DemoMarketDataProvider · явный QA fixture"
        isDemoMode
      />,
    );

    const preview = screen.getByTestId('analytics-setups-preview');
    expect(within(preview).getByText('QA · НЕ СИГНАЛ')).toBeTruthy();
    expect(preview.textContent).toContain('QA-данные, не live.');
  });
});
