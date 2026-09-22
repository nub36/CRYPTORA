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
  Newspaper,
  Calendar,
  PieChart,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /**
   * Если задано, пункт рендерится как выпадающее меню с этими подпунктами.
   * `path` при этом остаётся «основным» разделом (используется для подсветки
   * активной секции и для прямого перехода в мобильном drawer).
   */
  children?: SubNavItem[];
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
 *    Сейчас занято 5 слотов: «Рынок» и «Фьючерсы» объединены в один пункт с
 *    dropdown (Спот / Фьючерсы), а «Ликвидации» и «Радар» перенесены в
 *    «Инструменты» — освободившиеся места отданы «Статьям» и «Новостям».
 *  - Вторичные аналитические и рабочие разделы живут в двух группированных
 *    меню (`ANALYTICS_NAV_ITEMS`, `TOOLS_NAV_ITEMS`) — поэтому при нехватке
 *    места сжимаются сервисные контролы, а не кегль навигации.
 */
/** Подпункты объединённого раздела «Рынок» (спот и фьючерсы). */
export const MARKET_NAV_ITEMS: SubNavItem[] = [
  { label: 'Спот', sublabel: 'Котировки, дельты и спарклайны', path: '/market', icon: LineChart },
  { label: 'Фьючерсы', sublabel: 'Бессрочные контракты, базис и объёмы', path: '/futures', icon: Layers },
];

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { label: 'Обзор', path: '/', icon: Compass },
  { label: 'Рынок', path: '/market', icon: LineChart, children: MARKET_NAV_ITEMS },
  { label: 'Скринер', path: '/screener', icon: Sliders },
  { label: 'Статьи', path: '/articles', icon: BookOpen },
  { label: 'Новости', path: '/news', icon: Newspaper },
];

export const ANALYTICS_NAV_ITEMS: SubNavItem[] = [
  { label: 'Карта рынка', sublabel: 'Визуализация секторов и доходностей', path: '/heatmaps', icon: Grid3X3 },
  { label: 'Корреляции', sublabel: 'Матрица Пирсона и Beta к BTC', path: '/correlations', icon: Grid },
  { label: 'Он-чейн', sublabel: 'Хешрейт, сложность, мемпул, комиссии BTC', path: '/onchain', icon: Network },
  { label: 'Экосистемы', sublabel: 'DeFi TVL сетей L1 и L2', path: '/ecosystem', icon: Layers },
  { label: 'Календарь', sublabel: 'Фандинг и экспирации деривативов', path: '/calendar', icon: Calendar },
];

export const TOOLS_NAV_ITEMS: SubNavItem[] = [
  { label: 'Инструменты', sublabel: 'Калькуляторы размера позиции и PnL', path: '/tools', icon: Wrench },
  { label: 'Ликвидации', sublabel: 'Карта и поток фактических ликвидаций', path: '/liquidations', icon: Flame },
  { label: 'Радар', sublabel: 'Детектор аномалий: объём, OI, фандинг, каскады', path: '/radar', icon: Radio },
  { label: 'Портфель', sublabel: 'Value at Risk (VaR) и стресс-тесты', path: '/portfolio', icon: PieChart },
  { label: 'Журнал', sublabel: 'Ручной дневник сделок и самодисциплина', path: '/journal', icon: BookOpen },
  { label: 'Стратегии', sublabel: 'Лаборатория формализованных правил', path: '/strategies', icon: Cpu },
  { label: 'Сигналы', sublabel: 'LIVE-сетапы V3.0 / V3.3 / V2.8, журнал append-only', path: '/signals', icon: BarChart3 },
];

/** Максимально допустимое число пунктов прямой навигации (см. бюджет ёмкости выше). */
export const PRIMARY_NAV_CAPACITY = 6;

/** Все разделы терминала, доступные из навигации (без динамических `/coin/:symbol`). */
export const ALL_NAV_PATHS: string[] = [
  ...new Set([
    ...PRIMARY_NAV_ITEMS.map((item) => item.path),
    // Подпункты dropdown тоже разделы терминала. Порядок сохраняется, а дубли
    // убираются: у «Рынка» path совпадает с подпунктом «Спот» (/market).
    ...PRIMARY_NAV_ITEMS.flatMap((item) => item.children?.map((sub) => sub.path) ?? []),
    ...ANALYTICS_NAV_ITEMS.map((item) => item.path),
    ...TOOLS_NAV_ITEMS.map((item) => item.path),
  ]),
];
