# Витрина инструмента: общий слой Spot и Futures

> Статус: реализовано в ветке `arena/01a0ec95-cryptora` (2026-09-29), не слито и не задеплоено.
> Связанные документы: `docs/MARKET_DATA.md` (транспорт и provenance), `docs/DERIVATIVES.md`
> (метрики USD-M), `docs/agent-plan/04-COIN-PAGES.md`, `docs/agent-plan/05-FUTURES.md`.

## 1. Зачем этот слой

До этой правки `/coin/:symbol` (Spot) и `/futures/:symbol` (USD-M) были двумя разными
продуктами: на спотовой странице — карточки метрик, индикаторы, корреляция, стакан,
Radar, полноценный терминал графика; на фьючерсной — заголовок, график и две-три
цифры. Причина не в данных (маршрутизация Spot/Futures проверена в PR #35/#36:
Spot 494/494 инструмента, Futures 522/522 контракта), а в презентации: страница
контракта просто не показывала то, что уже было доступно.

Решение — **один презентационный слой, два рынка**. Никакой второй копии
`CoinDetailPage` (≈1000 строк) не создавалось: общие секции вынесены в
`src/components/instrument/*`, обе страницы остались тонкими контейнерами,
которые поставляют в эти секции данные СВОЕГО рынка.

```
src/components/instrument/
  InstrumentSectionCard.tsx   каркас секции: заголовок, иконка, состояния,
                              строка источника, NoData, InstrumentMetricRow
  instrumentMetrics.tsx       чистые билдеры строк: Spot-статистика,
                              Futures-статистика, деривативы, индикаторы,
                              корреляция + sectionSourceNote()
  InstrumentMetricsCard.tsx   карточка «заголовок + строки метрик»
  InstrumentChartCard.tsx     карточка графика: ChartTerminal + 24ч max/min,
                              состояния загрузки/ошибки, notice/titleSlot
  InstrumentRadarCard.tsx     Radar с ЯВНОЙ политикой источника
src/hooks/
  useInstrumentCandles.ts     единая загрузка свечей для обоих рынков
  useFuturesOrderBook.ts      REST-поллинг стакана USD-M
src/services/indicators/
  chartOverlays.ts            overlay SMA/Bollinger + контекст корреляции
```

Инвариант §17: изменение общего тулбара или карточки метрики делается в ОДНОМ
месте и автоматически применяется к обоим рынкам. Это закреплено тестом
`tests/unit/instrumentSharedPresentation.test.tsx` (обе страницы обязаны
импортировать shared-слой, не имеют собственных `<ChartTerminal>` и собственных
билдеров строк).

## 2. Market-awareness: данные рынков не смешиваются

Каждая секция получает `market: 'spot' | 'futures'` и печатает его в DOM
(`data-market`), а источник — человекочитаемой строкой (`Источник: Binance USD-M
Futures · MEWUSDT`). Правило жёсткое: **отсутствующая метрика показывается как
«Нет данных», а не подменяется спотовым значением.**

| Секция | Spot | Futures |
|---|---|---|
| График | `/api/v3/klines` (`market:'spot'`) | `/fapi/v1/klines` (`market:'futures'`) |
| Рыночная статистика | цена, 24ч %, max/min, объём, капитализация, supply | цена, 24ч %, max/min, оборот USDT, базовый объём, диапазон/цена |
| Деривативы | `compact`: mark/index, фандинг-APR, OI Δ1ч | `full`: mark/index, базис %, фандинг 8ч + APR, следующий фандинг, OI, OI Δ1ч/Δ24ч, объём фьючерса |
| Индикаторы | RSI/MACD/SMA/Bollinger/ATR/VWAP по SPOT-свечам | те же формулы по USD-M свечам |
| Корреляция с BTC | против BTCUSDT Spot | против **BTCUSDT PERP** (USD-M) |
| Стакан | WS Spot depth (`OrderBookL2 market="spot"`) | REST `/fapi/v1/depth` |
| Radar | нативный Spot | Spot базового актива c явной подписью либо скрыт |

Капитализации и circulating supply у бессрочного контракта нет: на фьючерсной
странице они **не показываются как метрика контракта**. Вместо этого в футере
секции стоит сноска, что подобные показатели относятся к базовому активу, со
ссылкой на спотовую страницу.

## 3. Состояния секций (§15)

`InstrumentSectionCard` знает пять состояний, и одна упавшая метрика не роняет
страницу:

| Состояние | Когда | Что видит пользователь |
|---|---|---|
| `loading` | запрос в полёте | скелет строк |
| `ready` | данные есть | значения |
| `no-data` | источник ответил, но метрики нет | «Нет данных» + пояснение |
| `unavailable` | upstream/сеть отказали | текст ошибки + «Повторить», где уместно |
| `unsupported` | инструмента нет в активной вселенной биржи | честное «контракт отсутствует в активной вселенной Binance USD-M» |

Состояние публикуется в DOM (`data-state`), поэтому тесты проверяют именно его,
а не наличие текста.

## 4. Стакан USD-M (§4)

* Источник: `GET /fapi/v1/depth` через same-origin gateway
  (`/api/market/binance/futures/fapi/v1/depth`). Спотовый `/api/v3/depth`
  недоступен для этого пути в принципе — маршрута нет в allowlist.
* `limit` ограничен сеткой биржи (5/10/20/50/100/500/1000); UI использует 50
  уровней (вес запроса 5).
* Символ резолвится через авторитетную вселенную USD-M, поэтому мультипликаторные
  контракты (`1000PEPE`) идут в `1000PEPEUSDT`, а неизвестный тикер даёт
  `UnsupportedMarketSymbolError`, а не спотовую книгу.
* Поллинг раз в 5 с, один запрос в полёте, `AbortController` при смене контракта,
  пропуск при `document.hidden`, кэш 4 с в `LiveMarketDataProvider`.
* Почему REST, а не WS: `RealtimeFeedManager` — это Binance **Spot** WS. Подписать
  на него фьючерсный символ = показать спотовую книгу под видом фьючерсной.

## 5. Тулбар графика (§10, §11)

Единая композиция контролов на обоих рынках и обеих плотностях:

```
[15м ▾] [Свечи ▾] [Индикаторы ▾] ……… [•••]        (desktop, data-layout="desktop")
[15м ▾] [Тип ▾]   [Индикаторы ▾] ……… [•••]        (mobile,  data-layout="compact")
```

* `data-controls="unified"` в DOM фиксирует инвариант «состав кнопок одинаков».
* Шаблоны, Настройки и «Вписать данные» живут в `•••` (`chart-more-trigger`).
* Длинные подписи вида «1ч · таймфрейм» и «Тип графика · Свечи» удалены: кнопка
  показывает текущее значение, полное описание — в `title`/`aria-label`.
* Fullscreen существует ровно в одном экземпляре: правый рельс на desktop,
  плавающий оверлей внутри рамки на мобильном (инвариант PR #31/#32).
* Меню: `role="menu"`, закрытие по Escape и клику вне, возврат фокуса на триггер,
  тап-цели 36 px на компактной плотности, клэмп по вьюпорту (на 360 px нет
  горизонтального overflow).
* Панели RSI/MACD и выравнивание шкал — без изменений (фикс PR #34 сохранён,
  регрессия закреплена `tests/unit/candleChartPanes.test.tsx`).

## 6. Правая шкала: цена, а не объём (§13)

Гистограмма объёма живёт на overlay-шкале (`priceScaleId: ''`), но её «последнее
значение» и price-line рисовались на той же правой кромке и проходили через общий
`localization.priceFormatter`, из-за чего последний объём (`84,369,082.00`)
читался как котировка. Исправление — ровно два презентационных флага серии
объёма: `lastValueVisible: false`, `priceLineVisible: false`. Данные объёма не
скрыты: гистограмма на месте, значение доступно в OHLCV-подсказке.
Закреплено `tests/unit/candleChartVolumeLabel.test.tsx`.

## 7. Точность дешёвых контрактов (§14)

`formatCurrency` округлял всё в диапазоне 0.0001…1 до четырёх знаков, поэтому MEW
(0.000478) печатался как `$0.0005` — ошибка ~4.6%, по такой цене нельзя считать
ни спред, ни базис. Введён канонический `formatInstrumentPrice` (`src/utils/formatters.ts`):

* точность берётся из `tickSize` биржи, если он известен (`priceDecimalsFromTickSize`);
* иначе — по значащим цифрам, минимум 5, максимум 8 знаков (предел Binance);
* никакой научной нотации, никаких лишних хвостовых нулей, `>= 1` по-прежнему с 2 знаками.

Формат используют карточки метрик, заголовок фьючерса, стакан и подписи оси цены
(`formatChartPriceLabel` расширяет точность только там, где шести знаков не
хватает — старые pinned-значения PR #32 байт-в-байт сохранены).

## 8. Политика Radar (§9)

Серверный Radar-монитор — **спотовый** (см. `docs/MARKET_DATA.md` §6). Поэтому:

* `native-spot` — спотовая страница, обычная секция «Radar»;
* `spot-underlying` — страница контракта, заголовок «Spot Radar базового актива X»
  и сноска «Источник: Spot Radar — аномалии базового актива, не контракта»;
  секция помечена `data-market="spot"`;
* `hidden` — у контракта нет активной спотовой базы: секция не рендерится,
  вместо неё остаётся маркер `futures-radar-hidden`.

Спотовая аномалия никогда не подписывается как фьючерсная.

## 9. Мобильная раскладка (§16)

360 / 390 / 430 px: тулбар одной строкой (`flex-nowrap`, без переносов),
метрики в одну колонку, стакан и карточки деривативов с горизонтальным
скроллом только внутри собственных контейнеров, правая шкала цены не скрывается,
панели индикаторов сохраняют минимальные высоты. Проверяется браузерными
сценариями `e2e/coinChartMobileComposition.spec.ts` (Chromium требует
установленных Playwright-браузеров — в песочнице CDN недоступен).

## 10. Карта `data-qa`

Общие: `chart-terminal`, `chart-terminal-toolbar`, `chart-timeframe-trigger`,
`chart-type-trigger`, `chart-indicators-trigger`, `chart-more-trigger(-menu)`,
`chart-reset-view`, `chart-fullscreen`, `chart-side-rail`, `chart-high-24h`,
`chart-low-24h`, `stat-*`, `deriv-*`, `indicator-*`, `correlation-*`,
`order-book-l2{,-scope,-badge,-mid,-message}`.

Spot: `spot-chart-state`, `spot-market-statistics`, `spot-derivatives`,
`spot-indicators`, `spot-btc-correlation`, `spot-radar`.

Futures: `futures-chart-state(-retry)`, `futures-last-price`, `futures-change-24h`,
`futures-market-badge`, `futures-open-spot`, `futures-workspace`,
`futures-chart-card`, `futures-market-statistics`, `futures-derivatives`,
`futures-indicators`, `futures-btc-correlation`, `futures-order-book`,
`futures-radar`, `futures-radar-hidden`.
