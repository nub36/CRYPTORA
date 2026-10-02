/**
 * CRYPTORA — Strategy Lab · Fair Value Gap indicator settings UI (RESEARCH ONLY).
 *
 * The «+ Fair Value Gap» card exposes ONLY Название / Код: FVG_MAIN /
 * «Показывать на графике». There are no calculation parameters: no period,
 * no source, no ATR references. Stable identifiers remain unchanged.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabIndicatorsPanel } from '@/components/strategyLab/LabIndicatorsPanel';
import type { IndicatorDefinition } from '@/services/strategyLab/types';

function Harness({ initial, onChange }: { initial: IndicatorDefinition[]; onChange?: (next: IndicatorDefinition[]) => void }) {
  const [indicators, setIndicators] = useState(initial);
  return (
    <LabIndicatorsPanel
      name="FVG UI"
      indicators={indicators}
      onNameChange={() => undefined}
      onChange={(next) => { setIndicators(next); onChange?.(next); }}
    />
  );
}

afterEach(cleanup);

describe('Strategy Lab Fair Value Gap settings UI', () => {
  it('creates fvg-main / FVG_MAIN with name, visibility — and no calculation parameters', () => {
    let latest: IndicatorDefinition[] = [];
    render(<Harness initial={[{ id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false }]} onChange={(next) => { latest = next; }} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-qa="lab-add-fvg"]')!);

    expect(screen.getByText('FAIR VALUE GAP')).toBeVisible();
    expect(screen.getByText('FVG_MAIN')).toBeVisible();
    expect(screen.getByLabelText('Название индикатора FVG_MAIN')).toHaveValue('Fair Value Gap');
    expect(screen.getByLabelText('Показывать на графике FVG_MAIN')).toBeChecked();
    expect(screen.getByText(/Fair Value Gap — трёхсвечный разрыв/)).toBeVisible();
    expect(screen.getByText('Скрывает зоны только на графике. Расчёт стратегии не меняется.')).toBeVisible();

    // No period / source / ATR controls on the FVG card.
    expect(screen.queryByLabelText('Период индикатора FVG_MAIN')).toBeNull();
    expect(screen.queryByLabelText('Источник индикатора FVG_MAIN')).toBeNull();
    expect(screen.queryByLabelText('ATR для импульса FVG_MAIN')).toBeNull();
    expect(screen.queryByLabelText('Displacement ATR индикатора FVG_MAIN')).toBeNull();

    // The stored definition carries the canonical parameterless shape.
    const fvg = latest.find((indicator) => indicator.type === 'FVG');
    expect(fvg).toEqual({ id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true });
  });

  it('renaming the display name never changes the stable code identifier', () => {
    render(<Harness initial={[{ id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true }]} />);
    fireEvent.change(screen.getByLabelText('Название индикатора FVG_MAIN'), { target: { value: 'Мой имбаланс' } });
    expect(screen.getByLabelText('Название индикатора FVG_MAIN')).toHaveValue('Мой имбаланс');
    expect(screen.getByText('FVG_MAIN')).toBeVisible();
  });

  it('toggling visibility keeps the indicator and its identifier intact', () => {
    let latest: IndicatorDefinition[] = [];
    render(<Harness initial={[{ id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true }]} onChange={(next) => { latest = next; }} />);
    fireEvent.click(screen.getByLabelText('Показывать на графике FVG_MAIN'));
    expect(latest.find((indicator) => indicator.type === 'FVG')).toEqual({ id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: false });
    expect(screen.getByText('FVG_MAIN')).toBeVisible();
  });
});
