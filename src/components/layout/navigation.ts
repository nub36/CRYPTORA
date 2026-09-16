import {
  Compass,
  LineChart,
  Layers,
  Flame,
  Radio,
  Sliders,
  Cpu,
  BarChart3,
  Wrench,
  Grid3X3,
  Network,
  Grid,
  BookOpen,
  Calendar,
  PieChart,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface SubNavItem extends NavItem {
  sublabel: string;
}

/**
 * CRYPTORA — модель навигации терминала
 * ---------------------------------------------------------------------------
 * Единственный источник правды для шапки, мобильного drawer и футера.
 *
 * Бюджет ёмкости (capacity budget):
 *  - `PRIMARY_NAV_ITEMS` — прямой доступ, максимум **6** пунктов. Это жёсткое
 *    ограничение: 6 пунктов с кеглем 13px — максимум, который гарантированно
 *    помещается в одну строку вместе с сервисными контролами на 1280px
 *    (проверено реальными замерами в scripts/screenshot-qa.mjs).
 *  - Вторичные аналитические и рабочие разделы живут в двух группированных
 *    меню (`ANALYTICS_NAV_ITEMS`, `TOOLS_NAV_ITEMS`) — поэтому при нехватке
 *    места сжимаются сервисные контролы, а не кегль навигации.
 */
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { label: 'Обзор', path: '/', icon: Compass },
  { label: 'Рынок', path: '/market', icon: LineChart },
  { label: 'Фьючерсы', path: '/futures', icon: Layers },
  { label: 'Ликвидации', path: '/liquidations', icon: Flame },
  { label: 'Скринер', path: '/screener', icon: Sliders },
  { label: 'Радар', path: '/radar', icon: Radio },
];

export const ANALYTICS_NAV_ITEMS: SubNavItem[] = [
  { label: 'Карта рынка', sublabel: 'Визуализация секторов и доходностей', path: '/heatmaps', icon: Grid3X3 },
  { label: 'Корреляции', sublabel: 'Матрица Пирсона и Beta к BTC', path: '/correlations', icon: Grid },
  { label: 'Он-чейн', sublabel: 'MVRV Z-Score, NUPL и биржевые потоки', path: '/onchain', icon: Network },
  { label: 'Экосистемы', sublabel: 'DeFi TVL, комиссии и TPS сетей', path: '/ecosystem', icon: Layers },
  { label: 'Календарь', sublabel: 'FOMC, отчеты CPI и cliff-разблокировки', path: '/calendar', icon: Calendar },
];

export const TOOLS_NAV_ITEMS: SubNavItem[] = [
  { label: 'Инструменты', sublabel: 'Калькуляторы размера позиции и PnL', path: '/tools', icon: Wrench },
  { label: 'Портфель', sublabel: 'Value at Risk (VaR) и стресс-тесты', path: '/portfolio', icon: PieChart },
  { label: 'Журнал', sublabel: 'Ручной дневник сделок и самодисциплина', path: '/journal', icon: BookOpen },
  { label: 'Стратегии', sublabel: 'Лаборатория формализованных правил', path: '/strategies', icon: Cpu },
  { label: 'Сигналы', sublabel: 'Неизменяемый криптографический аудит', path: '/signals', icon: BarChart3 },
];

/** Максимально допустимое число пунктов прямой навигации (см. бюджет ёмкости выше). */
export const PRIMARY_NAV_CAPACITY = 6;

/** Все разделы терминала, доступные из навигации (без динамических `/coin/:symbol`). */
export const ALL_NAV_PATHS: string[] = [
  ...PRIMARY_NAV_ITEMS.map((item) => item.path),
  ...ANALYTICS_NAV_ITEMS.map((item) => item.path),
  ...TOOLS_NAV_ITEMS.map((item) => item.path),
];
