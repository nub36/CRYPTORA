/**
 * CRYPTORA — Strategy Lab · справочник «Помощь» (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * ТИПИЗИРОВАННАЯ модель контента: статьи живут здесь как данные, а не внутри
 * гигантского JSX. Каждый пример кода — ПОЛНАЯ компилируемая стратегия вместе
 * с набором индикаторов, при котором канонический компилятор
 * (`compileResearchDraft`) обязан принять его без ошибок — это проверяется
 * регрессионным тестом. Никакого выдуманного DSL в справке быть не может.
 *
 * Контент описывает РЕАЛЬНУЮ семантику Lab (движок/компилятор текущей базы):
 * никакого обучения/квиза — это отдельная будущая фаза.
 */

import type { IndicatorDefinition } from '@/services/strategyLab/types';

export interface LabHelpExample {
  title: string;
  /** Полный код стратегии; компилируется каноническим компилятором в тесте. */
  code: string;
  /** Индикаторы, при которых пример обязан компилироваться. */
  indicators: IndicatorDefinition[];
}

export interface LabHelpArticle {
  id: string;
  title: string;
  /** Поисковые синонимы в дополнение к заголовку/тексту (локальный поиск). */
  keywords: string[];
  paragraphs: string[];
  bullets?: string[];
  examples?: LabHelpExample[];
}

/* ── Общие наборы индикаторов для примеров (стабильные id → идентификаторы) ── */

const EMA_ATR_SET: IndicatorDefinition[] = [
  { id: 'ema-fast', type: 'EMA', name: 'EMA Fast', period: 20, source: 'close', visible: true },
  { id: 'ema-slow', type: 'EMA', name: 'EMA Slow', period: 50, source: 'close', visible: true },
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
];

const RSI_SET: IndicatorDefinition[] = [
  { id: 'rsi-main', type: 'RSI', name: 'RSI 14', period: 14, source: 'close', visible: false },
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
];

const FRACTAL_SET: IndicatorDefinition[] = [
  { id: 'fractals-main', type: 'FRACTALS', name: 'Williams Fractals', period: 5, source: 'high', visible: true },
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
];

const ORDER_BLOCK_SET: IndicatorDefinition[] = [
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
  { id: 'order-block-main', type: 'ORDER_BLOCK', name: 'Order Block', lookback: 5, displacementMultiplier: 1, atrIndicatorId: 'atr-main', visible: true },
];

const MARKET_STRUCTURE_SET: IndicatorDefinition[] = [
  { id: 'market-structure-main', type: 'MARKET_STRUCTURE', name: 'Market Structure', leftBars: 2, rightBars: 2, visible: true },
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
];

const FVG_SET: IndicatorDefinition[] = [
  { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true },
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
];

const COMPOSITE_SET: IndicatorDefinition[] = [
  { id: 'rsi-main', type: 'RSI', name: 'RSI 14', period: 14, source: 'close', visible: false },
  { id: 'fvg-main', type: 'FVG', name: 'Fair Value Gap', visible: true },
  { id: 'atr-main', type: 'ATR', name: 'ATR Main', period: 14, visible: false },
];

/* ── Статьи ────────────────────────────────────────────────────────────── */

export const LAB_HELP_ARTICLES: readonly LabHelpArticle[] = [
  {
    id: 'ema',
    title: 'EMA — экспоненциальная скользящая средняя',
    keywords: ['EMA', 'скользящая средняя', 'crossesAbove', 'crossesBelow', 'пересечение', 'тренд'],
    paragraphs: [
      'EMA сглаживает цену с экспоненциальными весами: период и источник (open/high/low/close) задаются в «Настройках индикаторов». Значение на баре i использует только бары ≤ i; во время прогрева серия пуста (null), и стратегия не оценивается.',
      'В коде EMA участвует только в условиях пересечения: crossesAbove(A, B) истинно на баре, где A было ≤ B на предыдущем баре и стало > B на текущем; crossesBelow — зеркально. Оба аргумента должны быть индикаторами EMA.',
    ],
    examples: [
      {
        title: 'Классический трендовый кроссовер',
        indicators: EMA_ATR_SET,
        code: `strategy("EMA Trend", () => {
  LONG(crossesAbove(EMA_FAST, EMA_SLOW));
  SHORT(crossesBelow(EMA_FAST, EMA_SLOW));

  STOP(multiply(ATR_MAIN, 1.5));
  TAKE_PROFIT(R(2));
});`,
      },
    ],
  },
  {
    id: 'atr',
    title: 'ATR и стоп-лосс',
    keywords: ['ATR', 'STOP', 'multiply', 'стоп', 'волатильность', 'риск'],
    paragraphs: [
      'ATR (Wilder) измеряет средний истинный диапазон без округления. В Lab он нужен стопу: STOP(multiply(ATR_MAIN, 1.5)) ставит стоп на 1.5×ATR от цены входа; STOP(ATR_MAIN) эквивалентен множителю 1.',
      'Индикатор стопа обязан быть типа ATR. Если на баре сигнала ATR ещё не прогрет (NO_ATR) или равен нулю (ZERO_ATR) — кандидат отклоняется, и отказ виден во вкладке «ОТКАЗЫ».',
      'TAKE_PROFIT задаётся в единицах риска: R(2) — цель на расстоянии двух стопов от входа.',
    ],
    examples: [
      {
        title: 'Стоп 1×ATR, цель 1R',
        indicators: EMA_ATR_SET,
        code: `strategy("Tight ATR", () => {
  LONG(crossesAbove(EMA_FAST, EMA_SLOW));
  SHORT(crossesBelow(EMA_FAST, EMA_SLOW));

  STOP(ATR_MAIN);
  TAKE_PROFIT(R(1));
});`,
      },
    ],
  },
  {
    id: 'rsi',
    title: 'RSI — индекс относительной силы',
    keywords: ['RSI', 'above', 'below', 'перекупленность', 'перепроданность', 'порог', '30', '70'],
    paragraphs: [
      'RSI (Wilder) считается по выбранному источнику цены. В коде доступны пороговые условия: above(RSI_MAIN, 70) — значение строго выше порога, below(RSI_MAIN, 30) — строго ниже. Порог — число от 0 до 100; аргумент обязан быть индикатором RSI.',
      'Условие оценивается по закрытому бару: на баре i используется RSI, рассчитанный по барам ≤ i.',
    ],
    examples: [
      {
        title: 'Возврат из экстремумов RSI',
        indicators: RSI_SET,
        code: `strategy("RSI Reversion", () => {
  LONG(below(RSI_MAIN, 30));
  SHORT(above(RSI_MAIN, 70));

  STOP(multiply(ATR_MAIN, 2));
  TAKE_PROFIT(R(1.5));
});`,
      },
    ],
  },
  {
    id: 'fractals',
    title: 'Фракталы Вильямса (подтверждённые)',
    keywords: ['Fractals', 'фрактал', 'fractalHigh', 'fractalLow', 'Williams', 'подтверждение'],
    paragraphs: [
      'Фрактал — центральная свеча из пяти, чей максимум (минимум) строго выше (ниже) двух соседних с каждой стороны. Фрактал ПОДТВЕРЖДАЕТСЯ только закрытием второй свечи справа: условие fractalHigh/fractalLow истинно именно на баре подтверждения i+2, а не на центральной свече.',
      'Поэтому фрактал не заглядывает в будущее: в момент центральной свечи он ещё неизвестен, и вход возможен не раньше открытия бара, следующего за подтверждением.',
    ],
    examples: [
      {
        title: 'Входы от подтверждённых фракталов',
        indicators: FRACTAL_SET,
        code: `strategy("Fractal Breaks", () => {
  LONG(fractalLow(FRACTALS_MAIN));
  SHORT(fractalHigh(FRACTALS_MAIN));

  STOP(multiply(ATR_MAIN, 1.5));
  TAKE_PROFIT(R(2));
});`,
      },
    ],
  },
  {
    id: 'order-block',
    title: 'Order Block V1 — зоны и ретест',
    keywords: ['Order Block', 'ордер блок', 'bullishOrderBlock', 'insideBullishOrderBlock', 'bullishOrderBlockRetest', 'MITIGATED', 'INVALIDATED', 'зона'],
    paragraphs: [
      'Бычий Order Block — последняя медвежья свеча перед импульсной бычьей свечой, закрывшейся выше её максимума; тело импульса должно быть не меньше Displacement×ATR. Медвежий — зеркально. Зона [low, high] берётся из свечи-источника и подтверждается только закрытием импульсной свечи.',
      'Жизненный цикл начинается со следующей закрытой свечи: первый пересечённый диапазоном бар даёт ретест (MITIGATED); закрытие за дальней границей — INVALIDATED (терминально). Зона, подтверждённая на баре j, недоступна условиям inside/retest на самом j.',
      'Условия: bullishOrderBlock/bearishOrderBlock — создание зоны на этом баре; insideBullishOrderBlock/insideBearishOrderBlock — закрытие внутри живой зоны; bullishOrderBlockRetest/bearishOrderBlockRetest — первое касание зоны.',
    ],
    examples: [
      {
        title: 'Вход на первом ретесте зоны',
        indicators: ORDER_BLOCK_SET,
        code: `strategy("OB Retest", () => {
  LONG(bullishOrderBlockRetest(ORDER_BLOCK_MAIN));
  SHORT(bearishOrderBlockRetest(ORDER_BLOCK_MAIN));

  STOP(multiply(ATR_MAIN, 1));
  TAKE_PROFIT(R(2));
});`,
      },
    ],
  },
  {
    id: 'market-structure',
    title: 'Market Structure — Swing, BOS и CHoCH',
    keywords: ['Market Structure', 'структура', 'swingHigh', 'swingLow', 'BOS', 'CHoCH', 'bullishBOS', 'bearishBOS', 'bullishCHoCH', 'bearishCHoCH', 'пробой'],
    paragraphs: [
      'Swing-максимум/минимум — экстремум, строго превосходящий заданное число свечей слева и справа; он подтверждается только закрытием последней правой свечи (swingHigh/swingLow истинны на баре подтверждения).',
      'Пробой закрытием выше последнего подтверждённого swing-максимума в нейтральной/бычьей структуре — BOS (bullishBOS); против медвежьей структуры — CHoCH (bullishCHoCH). Зеркально для пробоя вниз. Уровень, подтверждённый на баре k, может быть пробит не раньше k+1.',
      'Это дискретные события одного бара: постоянных предикатов состояния структуры в V1 нет.',
    ],
    examples: [
      {
        title: 'Торговля пробоев структуры',
        indicators: MARKET_STRUCTURE_SET,
        code: `strategy("Structure Breaks", () => {
  LONG(any(bullishBOS(MARKET_STRUCTURE_MAIN), bullishCHoCH(MARKET_STRUCTURE_MAIN)));
  SHORT(any(bearishBOS(MARKET_STRUCTURE_MAIN), bearishCHoCH(MARKET_STRUCTURE_MAIN)));

  STOP(multiply(ATR_MAIN, 1.5));
  TAKE_PROFIT(R(2));
});`,
      },
    ],
  },
  {
    id: 'fvg',
    title: 'FVG — Fair Value Gap',
    keywords: ['FVG', 'Fair Value Gap', 'имбаланс', 'bullishFvg', 'bearishFvg', 'insideBullishFvg', 'insideBearishFvg', 'bullishFvgRetest', 'bearishFvgRetest', 'разрыв', 'гэп', 'PARTIALLY_FILLED', 'FILLED'],
    paragraphs: [
      'Fair Value Gap — трёхсвечный разрыв ликвидности. Бычий: low свечи C СТРОГО выше high свечи A (A = C−2); зона — [high(A), low(C)]. Медвежий: high(C) строго ниже low(A); зона — [high(C), low(A)]. Равенство границ отвергает гэп; средняя свеча B границ не задаёт. Параметров расчёта у индикатора нет.',
      'Гэп подтверждается только закрытием свечи C (knownAt = closeTime(C)); на A, B и открытии C он не существует. Жизненный цикл начинается с C+1: первый бар, чей диапазон пересёк зону, записывает первое касание и даёт ретест (PARTIALLY_FILLED); полный возврат — low ≤ нижней границы для бычьего (high ≥ верхней для медвежьего) — делает зону FILLED (терминально).',
      'Если бар перепрыгнул зону целиком, не пересёкши её диапазоном, зона становится FILLED без ретеста и без метаданных касания: внутрибарная траектория не домысливается.',
      'Условия: bullishFvg/bearishFvg — подтверждение гэпа на этом баре; insideBullishFvg/insideBearishFvg — закрытие бара внутри живой (не FILLED) зоны, границы включительно; bullishFvgRetest/bearishFvgRetest — первое касание зоны. Тень без закрытия внутри не делает inside истинным.',
    ],
    examples: [
      {
        title: 'Вход на подтверждении FVG',
        indicators: FVG_SET,
        code: `strategy("FVG Momentum", () => {
  LONG(bullishFvg(FVG_MAIN));
  SHORT(bearishFvg(FVG_MAIN));

  STOP(multiply(ATR_MAIN, 1.5));
  TAKE_PROFIT(R(2));
});`,
      },
      {
        title: 'Вход на первом ретесте FVG',
        indicators: FVG_SET,
        code: `strategy("FVG Retest", () => {
  LONG(bullishFvgRetest(FVG_MAIN));
  SHORT(bearishFvgRetest(FVG_MAIN));

  STOP(multiply(ATR_MAIN, 1));
  TAKE_PROFIT(R(1.5));
});`,
      },
    ],
  },
  {
    id: 'logic',
    title: 'Композиция условий: all / any / not',
    keywords: ['all', 'any', 'not', 'И', 'ИЛИ', 'НЕ', 'композиция', 'логика', 'условия'],
    paragraphs: [
      'Условия комбинируются безопасными функциями: all(…) — все аргументы истинны (минимум два), any(…) — хотя бы один (минимум два), not(…) — отрицание ровно одного условия. Вложенность ограничена: максимум 8 уровней и 64 узла.',
      'Если на одном баре истинны и LONG, и SHORT — кандидат не создаётся (конфликт сторон).',
    ],
    examples: [
      {
        title: 'Фильтр RSI поверх ретеста FVG',
        indicators: COMPOSITE_SET,
        code: `strategy("FVG + RSI Filter", () => {
  LONG(all(bullishFvgRetest(FVG_MAIN), below(RSI_MAIN, 60), not(bearishFvg(FVG_MAIN))));
  SHORT(all(bearishFvgRetest(FVG_MAIN), above(RSI_MAIN, 40)));

  STOP(multiply(ATR_MAIN, 1.5));
  TAKE_PROFIT(R(2));
});`,
      },
      {
        title: 'Любой из двух сигналов',
        indicators: COMPOSITE_SET,
        code: `strategy("FVG Any", () => {
  LONG(any(bullishFvg(FVG_MAIN), insideBullishFvg(FVG_MAIN)));
  SHORT(any(bearishFvg(FVG_MAIN), insideBearishFvg(FVG_MAIN)));

  STOP(ATR_MAIN);
  TAKE_PROFIT(R(1));
});`,
      },
    ],
  },
  {
    id: 'execution',
    title: 'Исполнение: вход, стоп, цель, комиссии',
    keywords: ['исполнение', 'вход', 'open', 'next bar', 'комиссия', 'проскальзывание', 'feeBps', 'slippageBps', 'SAME_BAR', 'R'],
    paragraphs: [
      'Сигнал оценивается на ЗАКРЫТОМ баре i, а вход исполняется по ОТКРЫТИЮ следующего бара i+1 (market next open) с учётом проскальзывания. Если следующего бара нет — отказ NO_ENTRY_BAR.',
      'Стоп и цель проверяются по диапазону каждого следующего бара. Если и стоп, и цель попадают в один бар, применяется документированное правило SAME_BAR_STOP_FIRST: консервативно считается, что первым сработал стоп.',
      'Комиссия (feeBps, на сторону) уменьшает net R; проскальзывание (slippageBps) уже заложено в цены входа/выхода. Валовой grossR считается без комиссий.',
      'Сделка, не успевшая закрыться до конца диапазона, закрывается END_OF_DATA по последнему закрытию.',
    ],
  },
  {
    id: 'no-look-ahead',
    title: 'No look-ahead: почему бар не видит будущее',
    keywords: ['look-ahead', 'look ahead', 'заглядывание', 'knownAt', 'будущее', 'подтверждение', 'closeTime'],
    paragraphs: [
      'Решение на баре i использует только бары ≤ i. У каждого события есть knownAt — момент, когда оно стало известно (обычно closeTime бара решения); knownAt всегда ≥ времени бара.',
      'Поэтому подтверждаемые конструкции (фрактал, swing, Order Block, FVG) становятся доступны стратегии только на баре подтверждения: фрактал — через две свечи после центра, FVG — после закрытия свечи C, пробой структуры — не раньше следующей свечи после подтверждения уровня.',
      'Самый ранний вход после любого сигнала — открытие следующего бара. Сервер исполняет реплей тем же кодом ядра, что и описан здесь: отдельной «серверной математики» нет.',
    ],
  },
  {
    id: 'chart',
    title: 'График: маркеры, зоны и видимость',
    keywords: ['график', 'маркеры', 'зоны', 'visible', 'видимость', 'оверлей', 'LONG', 'SHORT', 'TP', 'SL'],
    paragraphs: [
      'На график проецируются только реальные события движка: стрелки LONG/SHORT на баре решения, точка входа на баре исполнения, TP/SL на баре фактического исхода. Выбор сделки подсвечивает её уровни входа/стопа/цели.',
      'Зоны Order Block и FVG рисуются прямоугольниками: зона FVG начинается на свече A и тянется до последней свечи реплея, а заполненная (FILLED) — до бара заполнения. Заливка FVG специально бледнее Order Block.',
      'Флаг «Показывать на графике» влияет ТОЛЬКО на отрисовку: расчёты, события, сделки и метрики при скрытии индикатора не меняются.',
    ],
  },
  {
    id: 'identifiers',
    title: 'Стабильные идентификаторы индикаторов',
    keywords: ['идентификатор', 'Код', 'FVG_MAIN', 'EMA_FAST', 'ATR_MAIN', 'ORDER_BLOCK_MAIN', 'переименование', 'stable id'],
    paragraphs: [
      'Код ссылается на индикаторы по идентификаторам, детерминированно выведенным из их внутренних id: «fvg-main» → FVG_MAIN, «ema-fast» → EMA_FAST, «atr-main» → ATR_MAIN. Идентификатор показан на карточке индикатора рядом с меткой «Код:».',
      'Идентификатор никогда не строится из отображаемого названия: переименование подписи в UI не ломает уже написанный код. Коллизии разрешаются суффиксами _2, _3 … в порядке объявления.',
    ],
  },
] as const;

/** Все примеры кода из справки — для компиляционного регрессионного теста. */
export function collectHelpExamples(): LabHelpExample[] {
  return LAB_HELP_ARTICLES.flatMap((article) => article.examples ?? []);
}

/**
 * Локальный поиск: без сервера, без индексов — простое включение подстроки
 * (без учёта регистра) в заголовке, ключевых словах, тексте и примерах.
 */
export function searchHelpArticles(query: string): LabHelpArticle[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...LAB_HELP_ARTICLES];
  return LAB_HELP_ARTICLES.filter((article) => {
    const haystack = [
      article.title,
      ...article.keywords,
      ...article.paragraphs,
      ...(article.bullets ?? []),
      ...(article.examples ?? []).flatMap((example) => [example.title, example.code]),
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
