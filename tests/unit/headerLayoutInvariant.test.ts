/**
 * CRYPTORA — структурные инварианты шапки.
 *
 * БАГ: на production desktop ~1280px логотип CRYPTORA и пункт «Обзор»
 * nalезали друг на друга.
 *
 * МЕХАНИЗМ (root cause), а не «не хватило места»:
 *   контейнер nav — `flex-1 justify-center`, а каждый пункт внутри был
 *   `shrink-0 whitespace-nowrap` БЕЗ усечения. Такой пункт не может сжаться,
 *   поэтому при нехватке ширины содержимое nav выходит за границы контейнера.
 *   Из-за `justify-center` выход идёт симметрично в обе стороны — поверх brand
 *   слева и поверх сервисных контролов справа. `overflow-hidden` на nav
 *   поставить нельзя: там живут выпадающие меню.
 *
 * ФИКС: пункты стали `min-w-0 shrink` с `truncate` на подписи. Теперь flexbox
 * сжимает их вместо выхода за контейнер, и наложение невозможно при любой
 * ширине. Это архитектурное свойство, а не margin под конкретный экран.
 *
 * Тест проверяет инварианты по исходнику: они машинно проверяемы и ломаются
 * ровно тогда, когда кто-то вернёт shrink-0 без усечения.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PRIMARY_NAV_ITEMS,
  PRIMARY_NAV_CAPACITY,
  ANALYTICS_NAV_ITEMS,
  TOOLS_NAV_ITEMS,
  ALL_NAV_PATHS,
} from '@/components/layout/navigation';

const ROOT = path.resolve(__dirname, '../..');
const header = fs.readFileSync(path.join(ROOT, 'src/components/layout/Header.tsx'), 'utf8');
const navigation = fs.readFileSync(path.join(ROOT, 'src/components/layout/navigation.ts'), 'utf8');

describe('Header — brand не может быть вытеснен навигацией', () => {
  it('brand-секция не сжимается (shrink-0)', () => {
    const brand = header.match(/order-1 flex h-14[^"`]*/)?.[0] ?? '';
    expect(brand, 'не найден brand-контейнер').toBeTruthy();
    expect(brand).toContain('shrink-0');
  });

  it('сервисные контролы не сжимаются и прижаты вправо', () => {
    const controls = header.match(/order-2 ml-auto flex h-14[^"`]*/)?.[0] ?? '';
    expect(controls, 'не найден блок контролов').toBeTruthy();
    expect(controls).toContain('shrink-0');
    expect(controls).toContain('ml-auto');
  });

  it('строка шапки допускает перенос и не выходит за контейнер', () => {
    const row = header.match(/mx-auto flex min-w-0 max-w-\[1920px\][^"`]*/)?.[0] ?? '';
    expect(row).toContain('flex-wrap');
    expect(row).toContain('min-w-0');
  });
});

describe('Header — навигация не выходит за свой контейнер', () => {
  /** Все className-строки nav-пунктов (ссылки и dropdown-триггеры). */
  const navItemClasses = () => {
    const out: string[] = [];
    for (const m of header.matchAll(/`relative flex ([^`]*)`/g)) out.push(m[1]!);
    return out;
  };

  it('ни один nav-пункт не помечен shrink-0 без усечения', () => {
    for (const cls of navItemClasses()) {
      if (cls.includes('whitespace-nowrap')) {
        expect(
          cls,
          'whitespace-nowrap + shrink-0 = гарантированный выход за контейнер'
        ).not.toContain('shrink-0');
      }
    }
  });

  it('каждый сжимаемый nav-пункт имеет min-w-0', () => {
    const classes = navItemClasses();
    expect(classes.length).toBeGreaterThan(0);
    for (const cls of classes) {
      expect(cls, `нет min-w-0 в «${cls}»`).toContain('min-w-0');
    }
  });

  it('подписи пунктов усечены (truncate), а не обрезают соседей', () => {
    // Подпись обычного пункта и подпись dropdown-триггера.
    expect(header).toMatch(/<span className=\{inDrawer \? 'truncate' : 'truncate'\}>\{item\.label\}<\/span>/);
    expect(header).toMatch(/<span className="truncate">\{label\}<\/span>/);
  });

  it('nav-контейнер занимает свободное место и центрируется, не вытесняя brand', () => {
    const nav = header.match(/<nav\s+className="([^"]*)"/)?.[1] ?? '';
    expect(nav, 'не найден <nav>').toBeTruthy();
    expect(nav).toContain('min-w-0');
    expect(nav).toContain('xl:flex-1');
    expect(nav).toContain('xl:justify-center');
  });
});

describe('Header — компактный режим вместо наложения', () => {
  it('иконки в nav скрыты до nav2xl (1700px) — экономия ширины на 1280', () => {
    const iconClasses = header.match(/hidden h-3\.5 w-3\.5 nav2xl:block/g) ?? [];
    expect(iconClasses.length).toBeGreaterThanOrEqual(2);
  });

  it('кегль навигации растёт только на широких экранах (13px → 14px)', () => {
    const nav = header.match(/<nav\s+className="([^"]*)"/)?.[1] ?? '';
    expect(nav).toContain('text-[13px]');
    expect(nav).toContain('2xl:text-sm');
  });

  it('поиск и бейдж версии появляются только с navxl (1440px) — на 1280 их нет', () => {
    expect(header).toContain('relative hidden navxl:block'); // inline-поиск
    expect(header).toMatch(/navxl:inline-block[^>]*>\s*\n?\s*v\d+\.\d+\.\d+/);
  });
});

describe('Бюджет ёмкости навигации', () => {
  it('прямых пунктов не больше установленного лимита', () => {
    expect(PRIMARY_NAV_ITEMS.length).toBeLessThanOrEqual(PRIMARY_NAV_CAPACITY);
  });

  /**
   * Оценка ширины nav при 13px: 7.4px на символ кириллицы + паддинги +
   * шеврон у dropdown. Запас проверяется против худшего случая на 1280px.
   */
  it('nav помещается в бюджет 1280px с запасом', () => {
    const PER_CHAR = 7.4; // консервативно для Inter 13px, Cyrillic
    const PAD_XL = 20; // px-2.5 × 2
    const CHEVRON = 16;
    const GAP = 4;

    const items = [
      ...PRIMARY_NAV_ITEMS,
      { label: 'Аналитика', children: ANALYTICS_NAV_ITEMS },
      { label: 'Инструменты', children: TOOLS_NAV_ITEMS },
    ];

    const navWidth =
      items.reduce((acc, it) => acc + it.label.length * PER_CHAR + PAD_XL + ('children' in it ? CHEVRON : 0), 0) +
      (items.length - 1) * GAP;

    const brand = 137; // лого 32 + gap + CRYPTORA + pr-2
    const controls = 240; // LIVE-чип + 3 иконки + меню пользователя (без поиска)
    const rowPadding = 32; // px-4 × 2

    const total = navWidth + brand + controls + rowPadding;
    // 1280 — критичная ширина из задания. Запас обязан быть положительным.
    expect(total, `nav ${Math.round(navWidth)}px + brand ${brand} + controls ${controls} = ${Math.round(total)}px`).toBeLessThan(1280);
  });

  it('«Рынок» — dropdown со Спот/Фьючерсы, отдельного top-level «Фьючерсы» нет', () => {
    const market = PRIMARY_NAV_ITEMS.find((i) => i.path === '/market');
    expect(market?.children?.map((c) => c.path)).toEqual(['/market', '/futures']);
    expect(
      PRIMARY_NAV_ITEMS.filter((i) => i.path === '/futures'),
      '«Фьючерсы» не должен быть отдельным пунктом верхнего уровня'
    ).toHaveLength(0);
    // Роуты сохранены.
    expect(ALL_NAV_PATHS).toContain('/market');
    expect(ALL_NAV_PATHS).toContain('/futures');
    expect(navigation).toContain("path: '/futures'");
  });
});
