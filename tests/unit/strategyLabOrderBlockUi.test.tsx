import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabIndicatorsPanel } from '@/components/strategyLab/LabIndicatorsPanel';
import type { IndicatorDefinition } from '@/services/strategyLab/types';

function Harness({ initial }: { initial: IndicatorDefinition[] }) {
  const [indicators, setIndicators] = useState(initial);
  return <LabIndicatorsPanel name="OB UI" indicators={indicators} onNameChange={() => undefined} onChange={setIndicators} />;
}

afterEach(cleanup);

describe('Strategy Lab Order Block settings UI', () => {
  it('requires an ATR before creating an Order Block', () => {
    render(<Harness initial={[{ id: 'ema-main', type: 'EMA', name: 'EMA 20', period: 20, source: 'close', visible: true }]} />);
    const add = document.querySelector<HTMLButtonElement>('[data-qa="lab-add-order-block"]')!;
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'Для Order Block сначала добавьте индикатор ATR.');
    expect(screen.getByText('Для Order Block сначала добавьте индикатор ATR.')).toBeVisible();
  });

  it('creates ORDER_BLOCK_MAIN with frozen defaults, controls, Russian help, and ATR removal protection', () => {
    render(<Harness initial={[{ id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false }]} />);
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-qa="lab-add-order-block"]')!);

    expect(screen.getByText('ORDER BLOCK')).toBeVisible();
    expect(screen.getByText('ORDER_BLOCK_MAIN')).toBeVisible();
    expect(screen.getByLabelText('Lookback индикатора ORDER_BLOCK_MAIN')).toHaveValue('5');
    expect(screen.getByLabelText('Displacement ATR индикатора ORDER_BLOCK_MAIN')).toHaveValue('1');
    expect(screen.getByLabelText('ATR для импульса ORDER_BLOCK_MAIN')).toHaveValue('atr-main');
    expect(screen.getByText('Order Block подтверждается сильным импульсом после противоположной свечи.')).toBeVisible();
    expect(screen.getByText('Скрывает зоны только на графике. Расчёт стратегии не меняется.')).toBeVisible();

    const removeAtr = screen.getByLabelText('Удалить индикатор ATR Main');
    expect(removeAtr).toBeDisabled();
    expect(removeAtr).toHaveAttribute('title', 'ATR используется в настройках Order Block.');
  });
});
