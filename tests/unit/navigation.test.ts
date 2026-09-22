import { describe, it, expect } from 'vitest';
import {
  PRIMARY_NAV_ITEMS,
  ANALYTICS_NAV_ITEMS,
  TOOLS_NAV_ITEMS,
  ALL_NAV_PATHS,
  PRIMARY_NAV_CAPACITY,
  type SubNavItem,
} from '@/components/layout/navigation';

/**
 * Контракт навигации терминала.
 * Эти тесты защищают архитектурные инварианты шапки, из-за нарушения которых
 * возник UI-регресс: переполнение правой части header на 1280px и «микроскопический»
 * кегль навигации. Ёмкость прямой навигации ограничена, что гарантирует
 * размещение без сжатия текста.
 */
describe('Навигационная модель терминала CRYPTORA', () => {
  it('прямая навигация не превышает бюджет ёмкости (максимум 6 пунктов)', () => {
    // Бюджет — верхняя граница: «Рынок» и «Фьючерсы» объединены в один пункт
    // с dropdown, поэтому занято 5 слотов из 6. Пустой навигации быть не может.
    expect(PRIMARY_NAV_ITEMS.length).toBeLessThanOrEqual(PRIMARY_NAV_CAPACITY);
    expect(PRIMARY_NAV_ITEMS.length).toBeGreaterThanOrEqual(4);
  });

  it('v0.9.3: в прямой навигации — Статьи и Новости, а Ликвидации и Радар — в «Инструментах»', () => {
    // Основной запрос UX-прохода по скриншотам владельца. Порядок закреплён:
    // он определяет визуальную раскладку шапки на 1280px.
    expect(PRIMARY_NAV_ITEMS.map((i) => i.label)).toEqual([
      'Обзор',
      'Рынок',
      'Скринер',
      'Статьи',
      'Новости',
    ]);
    expect(PRIMARY_NAV_ITEMS.map((i) => i.path)).toContain('/news');
    // Перенесённые разделы не потеряны и не задвоены: они только в «Инструментах».
    const toolsPaths = TOOLS_NAV_ITEMS.map((i) => i.path);
    expect(toolsPaths).toContain('/liquidations');
    expect(toolsPaths).toContain('/radar');
    expect(PRIMARY_NAV_ITEMS.map((i) => i.path)).not.toContain('/liquidations');
    expect(PRIMARY_NAV_ITEMS.map((i) => i.path)).not.toContain('/radar');
    expect(toolsPaths).not.toContain('/articles');
  });

  it('все пути уникальны и начинаются со слеша', () => {
    const paths = ALL_NAV_PATHS;
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
    }
    expect(ALL_NAV_PATHS).toContain('/');
  });

  it('группированные разделы содержат обязательные подписи пунктов', () => {
    const analytics: SubNavItem[] = ANALYTICS_NAV_ITEMS;
    const tools: SubNavItem[] = TOOLS_NAV_ITEMS;

    expect(analytics.map((i) => i.label)).toEqual([
      'Карта рынка',
      'Корреляции',
      'Он-чейн',
      'Экосистемы',
      'Календарь',
    ]);
    // v0.9.3: «Ликвидации» и «Радар» перенесены из primary в «Инструменты»,
    // «Статьи» — наоборот, подняты в primary (вместе с новыми «Новостями»).
    expect(tools.map((i) => i.label)).toEqual([
      'Инструменты',
      'Ликвидации',
      'Радар',
      'Портфель',
      'Журнал',
      'Стратегии',
      'Сигналы',
    ]);

    for (const item of [...analytics, ...tools]) {
      expect(item.sublabel.length).toBeGreaterThan(10);
      expect(item.icon).toBeTruthy();
    }
  });

  it('каждый пункт навигации имеет иконку и непустую подпись', () => {
    for (const item of [...PRIMARY_NAV_ITEMS, ...ANALYTICS_NAV_ITEMS, ...TOOLS_NAV_ITEMS]) {
      expect(item.icon).toBeTruthy();
      expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('навигация покрывает все статические разделы терминала ровно один раз', () => {
    // Статические роуты App.tsx (без 404 и без динамического /coin/:symbol).
    // Инвариант «ровно один раз» ловит дублирование раздела одновременно
    // в primary и в группированном меню — поэтому при переносе пункта
    // из одного списка в другой он обязан исчезнуть из прежнего.
    const STATIC_APP_ROUTES = [
      '/',
      '/market',
      '/futures',
      '/liquidations',
      '/screener',
      '/radar',
      '/heatmaps',
      '/tools',
      '/strategies',
      '/signals',
      '/correlations',
      '/onchain',
      '/journal',
      '/calendar',
      '/ecosystem',
      '/portfolio',
      '/articles',
      '/news',
    ];

    for (const route of STATIC_APP_ROUTES) {
      expect(ALL_NAV_PATHS).toContain(route);
    }
    expect(ALL_NAV_PATHS.length).toBe(STATIC_APP_ROUTES.length);
  });

  it('инвариант концепции: навигация не содержит торгового исполнения', () => {
    const forbidden = /trade|order|buy|sell|bot|trading\b|исполн|ордер|сделк[аи]\s+б(u|о)т/i;
    for (const item of [...PRIMARY_NAV_ITEMS, ...ANALYTICS_NAV_ITEMS, ...TOOLS_NAV_ITEMS]) {
      expect(item.path).not.toMatch(forbidden);
    }
  });
});
