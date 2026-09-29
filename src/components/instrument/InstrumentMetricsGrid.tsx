import React, { Children, cloneElement, isValidElement } from 'react';

/**
 * ОБЩАЯ сетка метрик инструмента для Spot и Futures (UI-cleanup после PR #37, §3/§4/§6).
 *
 * КОРНЕВАЯ ПРОБЛЕМА: страницы рендерили четыре карточки («Рыночная
 * статистика», «Деривативы», «Технические индикаторы», «Корреляция с BTC»)
 * в фиксированный `grid-cols-3`. Четвёртая карточка попадала в ПЕРВУЮ ячейку
 * второй строки, а две оставшиеся ячейки оставались ПУСТЫМИ — на desktop
 * ниже трёх карточек висела «дырка» шириной в 2/3 страницы, из-за которой
 * секция «Книга заявок и аномалии» начиналась только после большой пустой
 * области.
 *
 * КОНТРАКТ ЗАПОЛНЕНИЯ (один на оба рынка, без per-page хаков):
 *  • mobile (<768px)  — 1 колонка, карточки стопкой;
 *  • tablet (768px+)  — 2 колонки;
 *  • desktop (1024px+) — 3 колонки: статистика / деривативы / индикаторы
 *    в первой строке, «Корреляция с BTC» — на всю ширину второй строки
 *    (`lg:col-span-3`), с горизонтальным inline-контентом внутри
 *    (`InstrumentMetricsCard variant="inline"`), чтобы строки текста не
 *    растягивались на всю ширину;
 *  • ПОСЛЕДНЯЯ карточка поглощает «хвостовые» пустые ячейки на каждом
 *    breakpoint: нечётное количество на tablet → последняя занимает оба
 *    столбца (`md:col-span-2 lg:col-span-1`), больше трёх на desktop →
 *    последняя занимает всю строку (`lg:col-span-3`). Сетка никогда не
 *    резервирует пустые ячейки — правило выведено из числа карточек, а не
 *    из `:nth-child`/отрицательных margin.
 *
 * Инвариант закреплён тестом `tests/unit/instrumentMetricsGrid.test.tsx`.
 */

const DESKTOP_COLUMNS = 3;
const TABLET_COLUMNS = 2;

export interface InstrumentMetricsGridProps {
  /** Карточки `InstrumentMetricsCard` (null/undefined-дети отфильтровываются). */
  children: React.ReactNode;
  /** Стабильный хук для тестов/QA. */
  qa?: string;
}

/** Классы «поглощения» хвостовых ячеек для последней карточки. */
export function trailingFillClasses(count: number): string[] {
  const classes: string[] = [];
  if (count > 1 && count % TABLET_COLUMNS !== 0) {
    classes.push('md:col-span-2');
    // На desktop span сбрасывается, если там действует своё правило.
    if (!(count > DESKTOP_COLUMNS && count % DESKTOP_COLUMNS !== 0)) {
      classes.push('lg:col-span-1');
    }
  }
  if (count > DESKTOP_COLUMNS && count % DESKTOP_COLUMNS !== 0) {
    classes.push('lg:col-span-3');
  }
  return classes;
}

export const InstrumentMetricsGrid: React.FC<InstrumentMetricsGridProps> = ({
  children,
  qa = 'instrument-metrics-grid',
}) => {
  const cards = Children.toArray(children).filter(
    (child): child is React.ReactElement<React.Attributes & { className?: string }> => isValidElement(child),
  );
  const trailing = trailingFillClasses(cards.length);
  const last = cards.length - 1;

  return (
    <div
      data-qa={qa}
      data-count={cards.length}
      data-fill-contract="last-card-absorbs-trailing-cells"
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      {cards.map((card, index) => {
        if (index !== last || trailing.length === 0) return card;
        const props = card.props as { className?: string };
        return cloneElement(card, {
          className: [props.className, ...trailing].filter(Boolean).join(' '),
        });
      })}
    </div>
  );
};
