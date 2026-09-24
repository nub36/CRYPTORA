import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';

import { SponsorSlot } from '@/components/ads/SponsorSlot';
import { activePlacements } from '@/services/ads/SponsorSlots';

const ROOT = path.resolve(__dirname, '../..');
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

const OVERVIEW = 'src/pages/OverviewPage.tsx';
const CANDLE = 'src/components/common/CandleChart.tsx';
const REGISTER = 'src/pages/RegisterPage.tsx';

describe('§4 — «перпов» не встречается в пользовательском интерфейсе', () => {
  it('в UI-строках нет словоформы «перп»', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        lines.forEach((l, i) => {
          if (!/перп/i.test(l)) return;
          // допустимо только в комментариях
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
          offenders.push(`${path.relative(ROOT, full)}:${i + 1}  ${l.trim()}`);
        });
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('§5 — карточка «Data Mode» удалена с Overview', () => {
  it('в KPI-ряду ровно 5 карточек, колонка — lg:grid-cols-5 (без пустой 6-й)', () => {
    const s = src(OVERVIEW);
    expect(s).toMatch(/grid-cols-2 md:grid-cols-3 lg:grid-cols-5/);
    const cards = [
      'Total Market Cap', '24h Volume', 'BTC Dominance',
      'Fear & Greed Index', 'Market Breadth',
    ];
    for (const c of cards) expect(s).toContain(`/* ${c} */`);
  });

  it('карточки «Data Mode» в интерфейсе нет', () => {
    const s = src(OVERVIEW);
    // как подпись карточки / заголовок блока
    expect(s).not.toMatch(/\{\/\* Data Mode \*\/\}/);
    expect(s).not.toMatch(/Data Mode<\/(span|div|h\d)>/);
  });
});

describe('§6 — компактный баннер источника данных, по умолчанию свёрнут', () => {
  it('баннер собран из Collapsible без defaultOpen и содержит расшифровку', () => {
    const s = src(OVERVIEW);
    expect(s).toContain('testId="overview-source-collapsible"');
    const block = s.slice(s.indexOf('testId="overview-source-collapsible"') - 400);
    const collapsible = block.slice(0, block.indexOf('</Collapsible>'));
    expect(collapsible).not.toMatch(/defaultOpen/);
    expect(collapsible).toContain('LIVE Data · Binance / KuCoin');
  });
});

describe('§10 — текущая цена отображается один раз', () => {
  it('серия свечей не рисует собственные last-value и price line', () => {
    const s = src(CANDLE);
    const start = s.indexOf('addCandlestickSeries({');
    expect(start).toBeGreaterThan(0);
    const block = s.slice(start, s.indexOf('});', start));
    expect(block).toMatch(/lastValueVisible:\s*false/);
    expect(block).toMatch(/priceLineVisible:\s*false/);
  });

  it('осознанная линия текущей цены остаётся единственной', () => {
    const s = src(CANDLE);
    // createPriceLine используется и для уровней сигналов (аддитивный проп
    // `levelLines`), поэтому считаем только линии ТЕКУЩЕЙ ЦЕНЫ — они строятся от
    // `.close` последней свечи (путь setData + realtime update) и должны
    // оставаться ровно двумя, без дублей.
    const calls = s.split('createPriceLine(').slice(1);
    const currentPriceLines = calls.filter((c) => c.slice(0, 200).includes('.close'));
    expect(currentPriceLines.length).toBe(2); // setData + realtime update
  });
});

describe('§23 — пустой рекламный слот не занимает места', () => {
  it('placements пуст — activePlacements возвращает []', () => {
    const cfg = JSON.parse(src('content/sponsor-slots.json'));
    expect(cfg.placements).toEqual([]);
    expect(activePlacements('overview-sidebar')).toEqual([]);
  });

  it('SponsorSlot возвращает null — ни контейнера, ни зазора', () => {
    const { container } = render(
      React.createElement(SponsorSlot, { slot: 'overview-sidebar' }),
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('sponsor-slot')).toBeNull();
  });
});

describe('§22 — закрытая регистрация не показывает форму', () => {
  it('экран зависит от статуса бэкенда, а не от ошибки формы', () => {
    const s = src(REGISTER);
    expect(s).toMatch(/registrationOpen === false/);
    expect(s).toContain('Регистрация временно закрыта');
    // статус берётся из API
    expect(s).toMatch(/body\.registrationOpen/);
  });
});
