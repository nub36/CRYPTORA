# CHANGELOG — Журнал изменений CRYPTORA

Все заметные изменения в проекте CRYPTORA документируются в этом файле согласно принципам [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).

---

## [0.9.3] — 2026-09-22

### Added — интеграция веток в main + UX-проход по скриншотам владельца

- **Интеграция веток.** В `main` влиты: ветка аудита `arena/01a0b0ba` (отчёты
  `AUDIT_REPORT_2026-09-17`, `DEEP_AUDIT_2026-09-18`, `DESIGN_AUDIT_2026-09-17`, `QA_REPORT`
  и артефакты — DOM-метрики контраста/кеглей, попиксельный диф тем, 24 скриншота 390–1920 dark/light)
  и уникальная часть `arena/01a0aeee`: серверный движок стратегий
  (`server/services/strategyEngine/*`, `strategyCatalog`, `strategySettings`, `signalRepository`),
  миграции `006_strategy_settings` и `007_signals`, API `/api/signals` и `/api/strategies`,
  `setupGeometry` (инвариант порядка уровней из замороженного определения V3.3),
  `StrategyOpsPanel` и `docs/STRATEGY_OPERATIONS.md`.
  Ветки `arena/01a0bd39` (GitHub Pages) и три старых среза v0.8.x не вливались — см. PR #10.
- **Новости:** новая страница `/news` (роут, lazy-чанк, пункт primary-навигации) с фильтром по
  категориям (Биткоин, Альткоины, Регулирование, Макро, Биржи). Раздел честно помечен
  «источник не подключён»: ни демо-ленты, ни выдуманных заголовков — подключение источника
  отдельным релизом. Каркас готов, запросов не делает.
- **Журнал ликвидаций:** локальные фильтры биржа / сторона / минимальный размер (без новых
  сетевых запросов), ограничение DOM `FEED_LIMIT = 50` со счётчиком скрытых, тиры по размеру
  (`< $10K`, `$10K–$100K`, `$100K–$1M`, `$1M+`) как чистая классификация — входные значения
  событий не меняются.

### Changed — навигация и график монеты

- **Primary-навигация:** «Ликвидации» и «Радар» перенесены в dropdown «Инструменты»;
  на их место в прямой доступ пришли «Статьи» и «Новости». Занято 5 слотов из 6
  (`PRIMARY_NAV_CAPACITY`), бюджет ширины на 1280px сохранён. Роуты `/liquidations`
  и `/radar` не изменились.
- **/coin:** дефолтный таймфрейм — `15m` (было `1h`); из переключателя типа графика убраны
  «Бары» (остались «Свечи» и «Линия»); `scaleMargins.top` 0.08 → 0.12 и `barSpacing` 8 → 10 —
  свечи не прижимаются к подписи цены и стали визуально шире.
- **`toPair()`** делегирует `pairLabel()`: единая идемпотентная нормализация пары, заодно закрыт
  биржевой формат без слэша (`ETHUSDT` → `ETH/USDT`).

### Fixed

- **Наложение логотипа на «Обзор»** при ~1280px: nav-пункты и dropdown-триггеры были
  `shrink-0 whitespace-nowrap` без усечения, из-за чего nav выходил за контейнер и симметрично
  (`justify-center`) налезал на brand и сервисные контролы. Стало `min-w-0 shrink` + `truncate` —
  flexbox сжимает пункты вместо выхода за контейнер.
- **Зависание графика при навигации:** во всех fetch-эффектах `/coin` добавлен `AbortController`.
  Раньше ответы применялись к размонтированному компоненту: страница оставалась в `loading`,
  а в график мог прилететь ряд другого таймфрейма. Теперь устаревшие ответы отбрасываются.
- **Дубль подписи текущей цены** на правой оси графика (`81 086,84 / 81 086,84` одна над другой):
  встроенные `lastValueVisible`/`priceLineVisible` выключены, осознанная `createPriceLine` оставлена.
- **Плашка «Доли неподключённых бирж не оцениваются»** не показывалась никогда: после §40 пайплайн
  перечисляет все биржи включая нулевые, поэтому условие `exchangeBreakdown.length === 0` недостижимо.
  Условие переведено на его настоящий смысл — `eventsCount24h === 0`.
- **CI:** guard «миграции 001–005 не изменялись» ронял весь прогон (`fatal: bad revision 'origin/main'` —
  `actions/checkout@v4` не создаёт этот ref). Guard честно пропускается с видимой причиной, если базовый
  ref недоступен, а в `ci.yml` добавлен `fetch-depth: 0`. Аннотации падения e2e больше не забиваются
  шумом `[WebServer] ECONNREFUSED` от недоступных с раннера бирж — причину падения снова видно.

### Verified

- `tsc --noEmit` чисто; **1078/1078** unit-тестов (97 файлов); `vite build` успешно;
  CI: Typecheck + Unit + Build и Browser e2e (Chromium) — зелёные.

## [0.9.1] — 2026-09-22

### Added — UX-проход по скриншотам владельца: скан всех монет, колокольчик сигналов, графики

- **Скан всех монет:** LIVE-движок стартует со всей вселенной канонического реестра
  (`scanUniverse.ts`, localStorage `cryptora_scan_universe_v1`, до 100 тикеров), а не 6
  захардкоженных инструментов. Кастомные тикеры (вне реестра) берут свечи напрямую с
  Binance spot (`LiveMarketDataProvider.getCandles`: `BASEUSDT`), без выдуманного фолбэка.
- **Админка → Монеты:** новая вкладка `ScanUniverseManager`: счётчик, добавление тикера,
  исключение/возврат монет, сброс к реестру. Применяется движком сразу через
  `LiveSignalEngine.updateSymbols` (состояния и ретроспектива сохраняются).
  Правила стратегий не меняются (журнал хеширован, логика заморожена).
- **Колокольчик сигналов:** `signalNotifications.ts` (синглтон поверх `ledger.subscribe`,
  persist до 50, id `sig-<setupId>-<KIND>`, время из журнала) → бейдж Header считает
  `unreadAlertCount + signalUnreadCount`, в AlertsModal новая вкладка «Сигналы»
  (новый сигнал / исполнение входа / исход + ссылка «Открыть журнал»).
- **/signals:** дефолтный фильтр «Открытые» («сигнал отработал, но висит» — теперь видно
  сразу), отдельная вкладка «Отменённые», плитка «Плюсовые / минусовые» по чистому R,
  исход карточки человеческим текстом (`describeSetupOutcome`: направление, вход, R,
  причина), тикер кликабелен (→ `/coin/BASE`). Тексты вынесены в `signalText.ts`.
- **/coin/BASE:** выбор монеты через `SymbolPickerModal` (реестр + произвольный тикер),
  переключатель типа графика (свечи/бары/линия закрытия, `CandleChart.chartType`),
  тумблер MA-линий с легендой (`showMA`: SMA 20/50/200 + BB 20).
- **/liquidations:** секция «Цена и ликвидации» — `LiquidationPriceChart`: свечи 1h +
  фактические события потока полупрозрачными метками (`mapLiquidationMarkers`: лонги
  снизу зелёным, шорты сверху красным, снап к сетке ТФ, cap 200), со своим пикером
  инструмента. Метки не закрывают свечи; нет свечей/событий — честное пояснение.
- **/futures:** убраны «корявые» логотипы монет из таблицы (только тикер + LIVE-бейдж).

### Changed

- Версия 0.9.0 → 0.9.1 (package.json, Header/Footer, e2e-инвариант).
- JSDOM-мок lightweight-charts: `addBarSeries` + `setMarkers` (покрывает новые серии).

## [0.9.0] — 2026-09-20

### Added — Интеграционный релиз: LIVE-сигналы (PR #2) + Source Health + Audit Remediation 1–2

Main объединяет две параллельные ветки разработки:

- **Ветка сигналов (PR #2, `arena/01a0b8cc-cryptora`, локально 0.8.45–0.8.49):** LIVE-движок
  сигналов V3.0/V3.3/V2.8 на фактических закрытых свечах (реплеи архивных раннеров, frozen-функции),
  статус-панель движка на /signals (scanCount/длительность/ошибки, ручной скан), валидация стратегий
  на реальных данных, детерминированные id реестра (v2-журнал, цепочка SHA-256), KuCoin-фолбэк окна
  свечей, пункт навигации «Сигналы».
- **Ветка данных (0.8.45 Source Health + 0.8.50–0.8.52):** circuit breaker REST-источников,
  бесконечный WS-реконнект, честные OI/индикаторы/спред/стакан, авто-обновление страниц,
  AA-палитра CoinIcon, slate-500, тач-таргеты, CI + браузерные e2e.
- **Интеграционные решения:**
  - Guard сканов: их `currentScan`-дедуп + наша пауза `document.hidden` — объединены в их движке
    (ручной скан выполняется даже в фоне).
  - `AlertService.ts` остаётся удалённым (Н13, мёртвый код): их точечный фикс `Math.random` внутри
    него не понадобился — детерминированные id сделаны в реестре сигналов (их v0.8.48).
  - `.github/workflows/deploy.yml` (GH Pages): автотриггер push→main отключён, только ручной запуск
    (workflow_dispatch) — продакшен терминала VPS, Pages вырождает auth/AI в гостевой режим.
  - main.tsx: `basename={BASE_URL}` (их, для Pages) + future-флаги v7 (наши) — вместе.
  - Версия единого релиза: **0.9.0**. Исторические записи обеих веток сохранены ниже с оригинальной
    нумерацией; коллизия (их 0.8.45–0.8.49 ↔ наша 0.8.45/0.8.50+) задокументирована, на артефакты
    не влияет (первая запись CHANGELOG и package.json = 0.9.0).

---

## [0.8.52] — 2026-09-20

### Fixed — Audit Remediation Pass 2 (Н13, Н12, Н8, Д2–Д4) + Н10 (CI + браузерные e2e)

#### Н13 — удалён мёртвый `AlertService.ts`
- 186 строк, нигде не импортировался (UI использует `alertEvaluator` + `AlertDispatcher`),
  `Math.random()` в id — против DONT_DO §2. Удалены сервис и его тест; пометки в
  `docs/SITE_REPORT.md`, `docs/agent-plan/10-ALERTS.md`.

#### Н12 — беты/волатильности портфеля пересчитываются
- `PortfolioRiskPage`: расчёт из фактических дневных свечей теперь через `useAutoRefresh`
  каждые 60с (раньше — один раз при монтировании и застывал навсегда; комментарий «cached 60s»
  не соответствовал коду). `CandleHistoryService` кэширует свечи на 60с — цикл дёшев.

#### Н8 — guard сканов LiveSignalEngine
- `scan()`: in-flight guard (медленная сеть больше не множит запросы свечей каждый тик) +
  пауза в фоновой вкладке (`document.hidden`). Тесты: наложение невозможно, пауза работает.

#### Д2 — CoinIcon: AA-палитра
- Прежняя палитра содержала светлые цвета (#F7931A, #D4A017, #EA580C…) с контрастом буквы
  1.8–3.3:1 — ниже WCAG AA. Новая палитра из 20 тёмных цветов, каждый проверен юнит-тестом
  на ≥ 4.5:1 с белым (`tests/unit/coinIcon.test.tsx` считает WCAG-контраст по формуле).
  Палитра экспортирована (`COIN_ICON_PALETTE`), без дублей, детерминизм сохранён.

#### Д4 — контраст text-slate-600 → text-slate-500
- `slate-600` не проходит AA в ОБОИХ темах (dark #475569 ≈ 2.5:1 на surface; light #94a3b8 ≈ 2.5:1
  на белом). Заменён на `slate-500` (#7484a0 — в коде документирован как ≥4.5:1; light #56657c ≥5:1)
  в 7 файлах (AiExplanationPanel, DataSourcesBadge, WatchlistDrawer, CoinDetail, Market, Overview, Screener).

#### Д3 — тач-таргеты ≥ 28px на мобильных
- `src/index.css`: на экранах ≤ 640px интерактивные элементы (`button`, `a[href]`, `[role=button]`)
  получают `min-height: 28px`. Десктопная плотность не затронута. (Полный 44px-эталон AA — следующий
  шаг после скриншот-QA; 28px закрывает худшие кейсы аудита «до 51 элемента < 28px».)

#### Н10 — CI с настоящими браузерными e2e
- `.github/workflows/ci.yml`: job `quality` (npm ci → typecheck → unit → build) + job `browser-e2e`
  (Chromium через `playwright install --with-deps`, `npm run test:e2e`).
- `e2e/browser.spec.ts` — первые реальные браузерные тесты: рендер Обзора без pageerror, навигация
  «Рынок» → /market, заголовок /strategies, бейдж версии в футере. Ассерты по статичному UI —
  не зависят от доступности биржевых API в CI.

#### Осознанно НЕ сделано (нужны решения/условия)
- react-router 6→7 (2 moderate CVE): breaking-апгрейд — только после прогона браузерных e2e в CI.
- CSP `unsafe-inline` → nonce: риск сломать инлайн-скрипты; отдельный проход с браузерной проверкой.
- Н5 TLS: операция владельца на VPS (certbot + 443/redirect/HSTS в nginx).
- Полный 44px тач-таргет и остальные 100+ контрастных замечаний: после скриншот-QA.

- Тесты: +5 (coinIcon ×3, signalsEngineGuard ×2), −8 (alerts.test удалён вместе с сервисом); всего 890 / 85 файлов.


## [0.8.51] — 2026-09-20

### Added — Б1: авто-обновление данных страниц

- **`useAutoRefresh(callback, delayMs, options)`** (`src/hooks/useAutoRefresh.ts`) — переиспользуемый
  хук цикла обновления: немедленный вызов при монтировании и далее каждые `delayMs` (следующий тик
  планируется после завершения предыдущего — наложения невозможны, плюс in-flight guard); **пауза
  запросов в фоновой вкладке** (`document.hidden` — таймер идёт, запросы не выполняются, лимиты
  источников не сжигаются); возврат видимости вкладки или сетевой `'online'` → немедленный
  внеочередной рефреш; отказ callback не останавливает цикл; cleanup на unmount.
- **Подключено** (раньше данные грузились один раз при монтировании — таблицы застывали до F5):
  - `/` Обзор: 30с, silent-режим без мигания спиннером (свечи BTC — прежний эффект по timeframe);
  - `/market`: 30с; `/futures`: 30с (spot-OI кэш 60с, OI-ряд 5мин — цикл дёшев); `/heatmaps`: 30с;
  - `/screener`: 30с по текущим фильтрам + счётчик активов; попутно добавлен честный catch отказа
    скрининга (раньше отказ уходил в необработанный rejection).
- Интервалы согласованы с кэшами провайдера (10с списки / 60с–10мин secondary): 30-секундный цикл
  почти не порождает реальных запросов к биржам.
- Тесты: `tests/unit/useAutoRefresh.test.tsx` — 8 новых (немедленный вызов, период, пауза в
  фоновой вкладке, внеочередной рефреш visible/online, запрет наложений, отказ не роняет цикл,
  cleanup, enabled=false). Всего 889.


## [0.8.50] — 2026-09-20

> ⚠️ **Коллизия версий с PR #2 (`arena/01a0b8cc-cryptora`, v0.8.45–0.8.49):** эта ветка уже выпустила
> v0.8.45 (Source Health, `7b92211`), поэтому данный проход минует диапазон PR #2 и нумеруется 0.8.50.
> При merge обеих веток одну из нумераций нужно перебить (записи CHANGELOG не пересекаются по смыслу).

### Fixed — Audit Remediation Pass 1 (по DEEP_AUDIT_2026-09-18 + AUDIT_REPORT_2026-09-17)

Верификация находок аудита по актуальному коду: Н1/Н2 (SSRF-прокси + утечка кэша) — уже удалены
(`proxyRemoval.test.ts`); Н3 (look-ahead) — уже исправлен (`ohlcvAdapter` isClosed + closedBars-фильтр);
Н4 (персистенция реестра) и Н7 (реактивность /signals) — уже реализованы; Д1 (шрифты) — @fontsource
self-hosted, CSP не при чём; З1/З2/З5 (пары 65/35, high/low ×1.03, ±5% в аномалии) — уже устранены
ранее. Ниже — исправленное в этом проходе из оставшегося.

#### Н6 🔴 → ✅ WebSocket умирает навсегда после ~4,5 мин офлайна
- `BinanceWebSocketClient` и `LiquidationStreamTransport`: терминальное состояние после
  `maxReconnectAttempts` (10 попыток) удалено — реконнект бесконечный, задержка насыщается на
  `reconnectMaxDelayMs` (30 с); опция теперь означает «попыток до насыщения задержки».
- Возврат сети/вкладки: подписка на `window.online` + `document.visibilitychange` → мгновенный
  реконнект без ожидания backoff-таймера, счётчик попыток сбрасывается. Слушатели снимаются в `disconnect()`.

#### З3 🟡 → ✅ Индикаторы-заглушки при нехватке свечей (RSI=50, MACD=0, SMA=цена)
- `getAssetDetail()`: полный набор — только из >= 200 фактических свечей; иначе `indicators: null`
  (схема `AssetDetailSchema.indicators` → nullable). UI CoinDetail: «—» вместо подставленных чисел.

#### З4 🟡 → ✅ OI = объём×0.15 без маркировки
- `getFuturesList()` теперь запрашивает фактический OI (`/fapi/v1/openInterest`, кэш 60 с) — раньше
  spot-OI не запрашивался вовсе. Эвристика `quoteVolume×0.15` в `DerivativesEngine` удалена:
  нет spot-ответа и ряда → `openInterest: null` → «—» в UI (FuturesPage, OverviewPage, HeatmapGrid,
  AssetPulsePanel/LiquidationPulse — null-safe).

#### З6 🟡 → ✅ Синтетический стакан заявок
- `OrderBookL2`: выдуманные уровни (7 бидов/7 асков вокруг цены) заменены скелетоном «ОЖИДАНИЕ
  ПОТОКА (WS)» без чисел; спред-бар «—» до прихода фактического снапшота глубины.

#### З7 🟡 → ✅ Выдуманный спред 0.01%/0.02%
- Спред пар — только из фактических bid/ask биржи (Binance `extractBinanceSpread`, KuCoin buy/sell);
  нет bid/ask → `spreadPct: null` → «—». NaN-гвард в `extractBinanceSpread` (parseFloat('') → NaN
  проходил старую проверку). Недостижимая fallback-ветка пары удалена.

#### Б3 🟡 → ✅ Watchlist: WS-подписка следует за изменением списка
- `toggleWatchlist` немедленно подписывает/отписывает символ в `RealtimeFeedManager` (раньше новый
  символ не стримился, т.к. эффект подписки зависел только от `dataMode`).

#### Мелочи
- Н9: dev-прокси `/api` → `:3000` в `vite.config.ts` (в dev `/api/ai/explain` больше не 404).
- Н11: React Router future-флаги (`v7_startTransition`, `v7_relativeSplatPath`) — ворнинги v7 убраны.

#### Не выполнено в этом проходе (следующие)
- Б1 (авто-обновление страниц), Б2-хвост (`/portfolio` пересчёт бет), Н5 (TLS — операция на VPS:
  certbot + раскомментировать 443/редирект/HSTS в `nginx/cryptora.conf`), Н8 (guard параллельных
  сканов LiveSignalEngine — строка в зоне PR #2), Н13 (удаление мёртвого AlertService — строка в зоне
  PR #2), контраст/тач-таргеты (Д2–Д6), реальные браузерные e2e (Н10), обновление зависимостей.

- Тесты: +8 (реконнект ×3, OI-факт ×2, деталь З3/З7 ×4 в двух файлах); всего 881.


## [0.8.45] — 2026-09-20

### Fixed — Source Health (circuit breaker недоступных REST-источников)

#### Проблема
Браузерные запросы к биржам могут отказывать **систематически**, а не разово:
- REST KuCoin (`api.kucoin.com`) не отдаёт браузерам CORS-заголовки вовсе — fallback-запросы `market/stats` умирали на каждом цикле опроса;
- инструмент, отсутствующий на Binance (пример из продакшена: KASUSDT нет в bulk-тикере; klines отвечают отказом без CORS-заголовков), генерировал 2 «красных» запроса (1h+1D klines) на каждом цикле обогащения — каждую минуту;
- `[P11] N asset(s) missing from live data` печатался в консоль на каждом цикле `getAssets()`.

Итог: консоль DevTools на проде заполнялась повторными `net::ERR_FAILED` / CORS-ошибками по одному и тому же активу при неизменном результате («данных нет»).

#### Решение — `SourceHealthTracker` (`src/services/data/adapters/sourceHealth.ts`)
- Клиентский circuit breaker **на endpoint+инструмент** (`klines?symbol=KASUSDT`, `market/stats?symbol=KAS-USDT`, …) — без изменчивых параметров (interval/limit), чтобы 1h- и 1D-свечи делили одну запись здоровья.
- Политики: `network`/`http` — блокировка после 3 подряд неудач на 10 мин, повторный эпизод — backoff ×2 (кап 1 ч); `invalid_symbol` (HTTP 400/404) — сразу на 6 ч; `rate_limit` (429/418) — 30 с. Таймауты (AbortError) не учитываются — транзиентны.
- Успешный ответ полностью восстанавливает ключ (half-open recovery); поздние неудачи «зависших» запросов не стирают действующую блокировку.
- Диагностика: **один** `console.warn` на ключ за эпизод с объяснением причины (CORS / делистинг / лимит) — вместо повторяющихся сетевых ошибок.
- **Честность данных не затронута (RULES §1):** трекер ничего не подменяет и не кэширует рыночные данные — актив с заблокированными источниками честно отсутствует/помечается недоступным, как и прежде.
- Опционален и **выключен по умолчанию** в конструкторах адаптеров (детерминированность тестов); включён в боевых точках: `MarketDataContext` (общий трекер для Binance/KuCoin REST-адаптеров) и `CandleHistoryService.getInstance()`.
- Новая ошибка `AdapterSourceBlockedError extends AdapterNetworkError` — существующие catch-ветки реагируют как на сетевой отказ.

#### Сопутствующее
- `LiveMarketDataProvider`: P11-warn дедуплицирован по подписи состава отсутствующих активов (повтор — только при изменении состава).
- Тесты: `tests/unit/sourceHealth.test.ts` — 14 новых (политики блокировок, half-open/backoff, интеграция адаптеров и CandleHistoryService, P11-дедупликация). Всего 873.

---

## [0.8.49] — 2026-09-20

### Added — конфигурация деплоя на GitHub Pages

- `.github/workflows/deploy.yml`: push в `main` (или вручную) → `npm ci` → `npm run build` с `GITHUB_BASE_PATH=/CRYPTORA/`
  → `dist/index.html` копируется в `404.html` (SPA-фолбэк для `BrowserRouter`) + `.nojekyll` → публикация через
  `actions/deploy-pages`. Перед первым запуском: **Settings → Pages → Source: GitHub Actions**.
- `vite.config.ts`: `base` берётся из `GITHUB_BASE_PATH` (по умолчанию `/` — VPS и dev не затронуты);
  `BrowserRouter` получил `basename={import.meta.env.BASE_URL}` — роутер работает и в корне, и в подкаталоге.
- `docs/DEPLOY_GH_PAGES.md` — что возможно на Pages (терминал целиком: рынок, сигналы, статьи — данные браузер берёт
  у публичных API бирж), и что невозможно (Node-бэкенд: логин/регистрация/админка/AI-прокси останутся в режиме
  «гостя» с честным сообщением «Авторизация временно недоступна»).

---

## [0.8.48] — 2026-09-20

### Fixed — журнал аудита не принимает сетапы по QA-данным; id без `Math.random()`

- **Журнал аудита — только фактические сетапы.** Движок считал стратегии и публиковал сетапы у любого провайдера: на
  QA-фикстуре (dev/test-ключ `cryptora_qa_fixture=1`) синтетические сетапы попадали в тот же localStorage-журнал
  `cryptora_signals_ledger_v2`, что и реальные, без пометки. Теперь при `provider.isDemo` реплеи продолжают работать
  для диагностики (окно, ретроспектива, статус), но публикация в журнал не выполняется, а `/signals` показывает
  предупреждение «провайдер отдаёт QA-фикстуру». В production провайдер всегда LIVE — поведение не меняется.
- **`Math.random()` в бизнес-логике (DONT_DO #2).** `AlertService.createRule` и `JournalService.addEntry` генерировали
  id со случайным суффиксом — теперь детерминированные: время + монотонный счётчик (у журнала счётчик продолжается от
  максимального суффикса сохранённых записей, поэтому id уникальны и после перезагрузки).
- Тесты: `tests/unit/alerts.test.ts` (50 правил в одну миллисекунду — id уникальны), `tests/unit/extendedAnalytics.test.ts`
  (30 записей журнала — id уникальны и монотонны, удаление возвращает исходный список),
  `tests/unit/signals/liveSignalEngineE2E.test.ts` (QA-провайдер: журнал пуст, диагностика видна).

---

## [0.8.47] — 2026-09-20

### Added — в `/signals` видно, чьи свечи использовал скан

Движок сообщал глубину окна и пропуски, но не источник. Теперь `SymbolScanStatus.source` содержит провенанс последней
свечи окна (`{ exchange, isFallback }`), а страница показывает колонку «Источник свечей»: `binance` — основной,
`kucoin (резерв)` — подсвечено, если Binance недоступен. Если провайдер провенанс не отдаёт (демо/мок) — честный `—`,
без выдуманной биржи. Это последняя часть наблюдаемости LIVE-пути: пользователь видит, какие данные попали в сигнал,
вместо того чтобы догадываться.

- `src/services/signals/live/LiveSignalEngine.ts` — поле `source` в `SymbolScanStatus`, `sourceOf(raw)` (провенанс
  последней свечи с провенансом, иначе `null`).
- `src/pages/SignalsPage.tsx` — колонка «Источник свечей» + пояснение под таблицей.
- Тесты: `tests/unit/signals/liveSignalEngineE2E.test.ts` — mock-провайдер отдаёт провенанс (binance / kucoin-резерв),
  проверены основной источник, резервный и отсутствие провенанса.

---

## [0.8.46] — 2026-09-20

### Fixed — резервный источник KuCoin отдавал произвольную глубину

`LiveMarketDataProvider.getCandles` вызывал `KuCoinSpotAdapter.fetchCandles(symbol, type)` **без окна**: KuCoin в этом
случае возвращает собственную страницу по умолчанию, поэтому при недоступном Binance (гео-блок, 451/403, таймаут)
LIVE-движок мог получить меньше 1000 закрытых 1h-баров — молча, без единого сообщения. Теперь адаптер принимает
`startAt`/`endAt` (Unix seconds), провайдер запрашивает `limit + 2` бара, обрезает ответ до запрошенной глубины и
предупреждает в консоли, если источник отдал меньше. Ничего не подставляется и не «дорисовывается».

- `src/services/data/adapters/KuCoinSpotAdapter.ts` — `fetchCandles(symbol, type, { startAtMs, endAtMs })`, нечисловое
  окно игнорируется (не превращается в `NaN`); без окна поведение прежнее.
- `src/services/data/LiveMarketDataProvider.ts` — карта `TIMEFRAME_MS`, окно запроса, обрезка и честный `console.warn`
  о меньшей глубине источника.
- Тесты: `tests/unit/adapters.test.ts` (параметры окна в URL), `tests/unit/liveDataProvider.test.ts` (окно + обрезка).

### Docs — протокол и результаты офлайн-валидации на реальных данных

Полный исторический датасет Binance spot (864 ZIP, закреплённый коммит `c3c1dce`, 2022-01 → 2025-12-31, 6 пар)
прогнан через **те же** LIVE-реплеи, что вызывает движок. Результаты и выявленные ограничения зафиксированы
(см. `docs/SIGNALS.md` §7 и ADR-007):

- V3.0 и V3.3 публикуют реальные сетапы: V3.0 — ≈1 сетап на пару за 2–4 дня, V3.3 — 1–2 в день.
- V2.8 на 4 годах 1h-истории даёт всего 10–14 публикуемых сетапов на пару (≈1 в 3–5 месяцев). Отсутствие сигналов
  V2.8 в коротком окне — свойство стратегии (редкость sniper-фильтра), а не отказ движка.
- Задокументировано свойство скользящего окна: зона V3.3, образованная **последним закрытым 4h-баром**, становится
  видимой только после закрытия следующего 4h-бара (до 4 часов задержки, как в архивном раннере) — уровни сетапа при
  скане могут отличаться от ретроспективного прогона по всей истории.

---

## [0.8.45] — 2026-09-19

### Fixed — LIVE-сигналы: три архивные стратегии работают на фактических свечах

Аудит показал, что `LiveSignalEngine` (0.8.44) **не воспроизводил** архивные стратегии: V3.0 не вёл лимитный
коридор (исполнение/отмена/истечение), V3.3 и V2.8 были упрощёнными эвристиками, исходы сетапов никогда не
отслеживались (точность в журнале всегда 0 %), ошибки провайдера глотались `catch {}`, движок не
останавливался при размонтировании контекста. Стратегии **не переписывались** — LIVE-движок теперь вызывает
те же замороженные функции архива, что и исследовательские раннеры.

#### LIVE-движок = детерминированный реплей архивного раннера (`src/services/signals/live/`)
- `replays/v30LiveReplay.ts` — V3.0 HTF Liquidation Trap: `detectTrap` → `buildPending` → `corridorStep`
  (N+1…N+3, худшая граница, отмена при стопе, REJECTED_GEOMETRY, истечение) → `manageTrade` V3.0.
- `replays/v33LiveReplay.ts` — V3.3 HTF Zone Mitigation (headline-вариант `while-protective-displacement`):
  `buildZones` → `trackZone` → абсорбция/RVOL → коридор → `manageTrade` V3.3; Amendment-1 tie-break сохранён.
- `replays/v28LiveReplay.ts` + `strategyArchive/definitions/v2_8-zero-fee-sniper-trailing/v28Live.ts` — V2.8:
  замороженный `evaluateV2` @4839074 + sniper-гейт (`extremePoolKind`/`baseSniper`) + вход по OPEN N+1
  (`resolveEntry`/`executableLadder`) + ОДИН слот, освобождаемый `trackOutcome`, + выход Trail (`simulateTrailing`).
  Обёртка живёт внутри `strategyArchive/`, потому что только архив вправе импортировать `legacy/v2`.
- Реплей идёт по окну последних ≤ 1000 закрытых 1h-баров (+ 4h, + 1d для V2.8); в журнал публикуются
  **только** сетапы последнего закрытого бара (latency 0), id = `${strategyId}-${SYMBOL}-${setupOpenTime}`.
- Pending, которые раннер отклонил бы на баре исполнения по геометрии (TP1 позади коридора), не публикуются
  (`publishable=false`), но остаются в ретроспективе — счётчики сходятся с воронкой исследования.
- Forming-свеча никогда не участвует (`ohlcvToArchive(c, tf, nowMs)`, look-ahead тест сохранён).

#### Жизненный цикл опубликованных сетапов (`live/lifecycle.ts`)
- Исход считается по **опубликованным (хэшированным) уровням** теми же frozen-функциями: `corridorStep` +
  `manageTrade` (V3.0/V3.3), `v28EntryAtNextOpen` + `v28TrailOutcome` (V2.8). Чистая функция, без состояния.
- Статусы: ACTIVE → FILLED → TARGET_REACHED / INVALIDATED / CLOSED; ACTIVE → EXPIRED / CANCELLED (no-trade).

#### Журнал аудита v2 (`SignalsAuditLedger.ts`, ключ `cryptora_signals_ledger_v2`)
- Цепочный SHA-256: `auditHash = sha256(issuance + prevHash)`, `prevHash` хранится; исход хэшируется отдельно
  и ровно один раз (`outcomeHash`). `expireStale()` удалён — он ломал цепочку.
- `SetupFill.stop/targets` (уровни после сдвига на дельту исполнения), `netResultR` (2/5 bps);
  `getSummary()`: доля R > 0, средний/суммарный net R, no-trade не портит точность.

#### UI `/signals`
- Блок статуса движка: сканы, последний/следующий, покрытие по инструментам (закрытые 1h/4h/1d, пропуски),
  найденные сетапы/исходы по каждой стратегии в окне, ошибки источника **по инструменту** (не глотаются).
- Фильтры по статусу и стратегии; карточка показывает вход/стоп/цели, исполнение, gross и net R, правило выхода,
  audit/outcome hash. «Ретроспектива окна» — диагностика реплея, явно не журнал и не трек-рекорд.
- Вердикты стратегий на карточках: V3.0 VALIDATED (3 из 6), V3.3 TRAIN-ONLY, V2.8 GROSS-ONLY / net-отрицательна.

#### Данные
- `MarketDataProvider.getCandles(symbol, timeframe, limit?)`: LIVE — Binance `limit` ≤ 1000 (кэш с учётом лимита),
  Demo — усечение хвоста без дорисовки. `MarketDataContext`: движок останавливается при размонтировании,
  ошибка старта логируется.

#### Тесты
- `tests/unit/signals/liveReplays.test.ts` — паритет LIVE-реплеев V3.0/V3.3 с архивными раннерами (бар в бар:
  сетап, исполнение, цена, причина выхода, gross/net R, воронка), инвариантность к скользящему 1000-барному окну.
- `tests/unit/signals/v28Live.test.ts` — паритет обёртки V2.8 со `runSniperEntryLoop` + `simulateTrailing`
  на трёх детерминированных сериях; AWAITING_NEXT_OPEN ≡ исполнение полного прогона.
- `tests/unit/signals/liveSignalEngineE2E.test.ts` — движок × реплей × журнал на mock-«бирже» с forming-свечой:
  публикация, исполнение и исход совпадают с полным реплеем, цепочка цела, ошибки провайдера в статусе.
- `tests/unit/signals.test.ts` — журнал v2 (цепочка, идемпотентность, одноразовый исход, сводка, persist).
- E2E (Playwright): харнес починен (`AuthProvider` отсутствовал — 46/66 падали до правок), устаревшие ожидания
  приведены к фактическому UI, lazy-маршруты ждут рендера. Итог: 66/66.

#### Известные ограничения (честно)
- Журнал хранится в localStorage браузера — это не серверный трек-рекорд.
- В песочнице сборки нет доступа к биржам: LIVE-эмиссия проверена только кодом и mock-провайдером.
- V2.8 в LIVE — только 1h-подмножество исследования (15m/30m/4h не сканируются); все цифры V2.8 — GROSS.


---

## [0.8.44] — 2026-09-17

### Fixed — Corrective Data-Honesty Pass

#### OI Delta: null ≠ zero
- `openInterestChange1h`/`openInterestChange24h`: 0 → null when OI history unavailable
- 0.00% means "OI did not change"; null means "no data" — semantics now distinct
- Source: UNAVAILABLE (was ESTIMATED); ESTIMATED reserved for historical heuristic (unused)
- FuturesPage, CoinDetailPage, OverviewPage, HeatmapGrid, AssetPulsePanel: null-safe display "—"
- Regression test: `missing OI history !== zero delta`

#### Portfolio Beta: removed silent hardcoded fallback
- `PortfolioRiskEngine.calculateRiskReport()`: overrides only, no silent static table
- ETH/SOL/NEAR beta = null when no candle data (was silently 1.18/1.64/1.52 from static table)
- BTC=1.0 (deterministic benchmark) and stablecoins=0 (deterministic) still non-null
- `staticReferenceUsed=true` flags that reference values exist but were NOT used as fallback
- `PortfolioRiskReport.portfolioBeta`: null if any allocation has null beta
- UI: shows "—" + "Нет данных свечей" instead of silently displaying static values

#### Portfolio Volatility: real or UNAVAILABLE
- `annualizedVolatilityPct`, `dailyVaR95Usd`, `dailyVaR95Pct`, `dailyVaR99Usd`: null when no candle data
- VaR depends on volatility → also null when vol unavailable
- UI: "—" + "Требуется история"

#### Static Reference preserved for transparency
- `STATIC_REFERENCE_BETAS` and `STATIC_REFERENCE_VOLATILITY` kept as labeled model assumptions
- Never used as silent fallback; only flagged via `staticReferenceUsed`
- UI warns when static reference is available but not used

### Added — Last Market-Data Hardening Pass (H1–H2)

#### H1: Request Fan-out Optimization
- **Bulk ticker**: BinanceSpotAdapter.fetchAll24hrTickers() — 1 request (weight 40) replaces 25 individual calls
- **Lazy candle enrichment**: getAssets() returns immediately with ticker data; CandleHistoryService runs in background
  - First paint: 3 requests (bulk ticker + CoinGecko global + F&G)
  - Secondary: 50 kline requests (background, concurrency 6, cached 60s)
  - change1h/change7d/sparkline = null until enrichment completes (honest, not fake)
- **Cache sharing**: Overview, Market, Screener share LiveMarketDataProvider cache (10s TTL)
- **Request budget documented**: Binance weight ~115/load cycle (within 1200/min limit)

#### H2: OKX Notional + Liquidation Labels
- OKX: sz = contracts (not underlying); requires ctVal from instrument metadata
- Unknown ctVal → event skipped (not approximated)
- Known ctVal: amountUsd = price × contracts × ctVal (linear USDT-SWAP only)
- Liquidation < 24h: shows "Наблюдается с [time]" not "за 24ч"
- Liquidation >= 24h: "за 24ч" correct

#### Tests (20 new)
- Request budget: bulk ticker, lazy enrichment, numbers, stale cache, CoinGecko 429
- OKX: unknown ctVal skip, known ctVal notional, inverse contract non-support
- Liquidation: < 24h label, >= 24h label, formatAge
- Network audit: Overview (3 requests), Market (0 if cached), Coin Detail (5 requests)

#### R1: Freshness Contract
- `src/services/data/freshness.ts`: SourceCategory, FreshnessStatus, per-category thresholds
- WS=10s, REST futures=60s, metadata=5min
- `computeFreshness()`, `formatAge()`, `freshnessLabel()` for UI integration
- Ready for Sources/Provenance popover

#### R1: Liquidation Observation Window
- `LiquidationPipeline.observationStartedAt`: when monitoring began
- `LiquidationPipeline.hasFullWindow`: full 24h achieved
- `LiquidationData`: observationStartedAt, observationDurationMs, hasFullObservationWindow
- UI can show "Наблюдается с 14:32 UTC" before full 24h window

#### R1: Liquidation Pulse Completeness
- `AssetImbalance`: availableComponents, missingComponents, completenessPct
- Tracks which of 4 inputs (liquidation/funding/OI/price) have real data
- Missing components listed, not hidden behind math 0
- completenessPct: 0–100%

#### R2: Asset Coverage Contract
- 25/25 canonical assets verified: Binance Spot, KuCoin, CoinGecko all mapped
- Futures eligibility: runtime via exchangeInfo, not hardcoded
- No `hasFutures` flag in registry

#### R3: Partial Failure + Cache + Race Tests
- LiquidationPipeline: empty events, duplicate idempotency, re-ingest, per-exchange state
- CandleHistoryService: cache key isolation (BTC≠ETH), dedup, resetCache
- CoinGecko: per-coin metadata only in getAssetDetail(), not bulk overview
- AnomalyEngine: warmup requires baseline, single tick no anomaly
- Fast switch: cache key isolation documented

#### Docs
- `docs/DATA_SOURCES.md`: sources, 25-asset coverage matrix, data classification, freshness thresholds, CoinGecko policy

### Added — Live Market Data Completion (D1–D8)

#### D1: Real 1h/7d change from factual klines
- Removed model approximations (`change24h * 0.12`, `change24h * 1.8`)
- Created `CandleHistoryService`: shared cache, concurrency=6, TTL=60s
  - Fetches 1h klines (limit=25): 1h change + sparkline
  - Fetches 1D klines (limit=8): 7d change + raw closes for beta
- `change1h`/`change7d` now nullable (null → "—" in UI)
- Sparklines from real 24h hourly closes (removed synthetic `price*0.98`)

#### D2: Real sparklines from shared candle cache
- Combined with D1 via CandleHistoryService architecture

#### D3: CoinGecko global BTC/ETH dominance
- Extended CoinGeckoAdapter: parses `market_cap_percentage` from `/api/v3/global`
- Added `globalBtcDominancePct`, `globalEthDominancePct` to MarketOverviewData
- OverviewPage labels: "Доминация BTC (CoinGecko)" vs "Доминация BTC (каталог)"

#### D4: OI delta — removed price-proxy fallback
- `openInterestChange1h/24h` = 0 when no OI history (was `priceChange*0.1`)
- Source label: 'ESTIMATED' when no history

#### D5–D6: Error resilience, screener null handling
- ScreenerPage: null-safe change1h/change7d columns

#### D7: Real portfolio betas from candle data
- `PortfolioRiskEngine.calculateRiskReport()` accepts optional `PortfolioRiskOverrides`
- PortfolioRiskPage computes real betas via `IndicatorEngine.calculateBeta()`
- Real annualized volatility from daily return variance × √365
- Falls back to hardcoded when candle data unavailable

#### D8: Freshness hardening, version bump
- CandleHistoryService tracks `isLive` flag per asset
- v0.8.43 → v0.8.44

### Changed — Data classification
- change1h/change7d/sparkline: MODEL → DERIVED_FROM_FACTUAL
- Portfolio betas: MODEL → DERIVED_FROM_FACTUAL (with hardcoded fallback)
- BTC/ETH dominance: derived universe → CoinGecko factual global

---

## [0.8.43] — 2026-09-17

### Added — Coin Data + Chart + Market Visualization Quality

#### Chart (CandleChart.tsx)
- **Candle depth**: 100 → 500 candles (Binance supports 1000/request)
- **Timeframes**: added 5m and 30m (Binance + KuCoin support both)
  - Type `Timeframe` extended: `'5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W'`
  - Mappers: LiveMarketDataProvider, TimeSeriesRepository, StrategyArchive adapter
  - UI buttons on Overview + Coin Detail pages
- **OHLC tooltip**: crosshair shows O/H/L/C/Vol with adaptive formatting
  - Volume: B/M/K compact, prices with locale formatting
  - Candle change % shown in green/red
- **Current price line**: horizontal line at last close (green/red, dashed)
- **Indicator overlays**:
  - SMA20 (amber), SMA50 (blue), SMA200 (purple) as line series
  - Bollinger Bands upper/middle/lower (indigo, thin)
  - Data computed from actual candles via IndicatorEngine
- **Reset view button**: `⟲ fit` on hover, bottom-right
- **Price formatter**: adaptive decimals (2 for >$1000, 4 for >$1, 6 for <$1)
- Chart indicator data passed from CoinDetail + Overview pages

#### Coin Detail (CoinDetailPage.tsx)
- **DataSourcesBadge**: compact popover showing all data sources
  - Spot, Order Book, Derivatives, Liquidations, Metadata (CoinGecko), Indicators
  - Status tags: LIVE / DERIVED / Н/Д
- **Spread display**: now shows bps alongside percentage (e.g. `0.01% (1.0bps)`)
- **Chart indicators**: SMA20/50/200 + Bollinger overlays from actual candle data

#### Asset Registry
- All 25 assets: binanceSymbol ✅, kucoinSymbol ✅, coingeckoId ✅ — no mapping gaps
- Hardcode audit: 0 hardcoded market values in production paths

### Fixed
- `tests/unit/liquidations.test.ts`: replaced hardcoded `Date.UTC(2026,8,16)` with `Date.now()`
  (events >24h old silently pruned by `recordEvent()` → `pruneExpired()`)
- OverviewPage hooks order: `useMemo` moved before early returns (React rules of hooks)
- `candleAdapter.ts`: missing `default` case in `cryptoraTimeframeToArchive` switch
- `TimeSeriesRepository`: added 5m=300s, 30m=1800s intervals
- Typography: all text ≥11px, uppercase count ≤20

## [0.8.42] — 2026-09-17

### Added — Server-side AI Integration (OpenAI API, Coin Detail)

#### Server Gateway (`server/ai/explain.mjs`)
- **OpenAI SDK** (v7.17): official `openai` npm package, not raw HTTP
- **Structured output**: LLM returns JSON (`response_format: json_object`), validated at runtime
- **StructuredFacts contract** (`src/services/ai/StructuredFacts.ts`): typed input with origin tags
  (FACTUAL, DERIVED, MODEL_ESTIMATED, UNAVAILABLE) for spot, derivatives, liquidations, indicators, radar, models
- **AiOutputContract** (`src/services/ai/AiOutputContract.ts`): summary, keyObservations[], supportingFacts[],
  counterEvidence[], dataLimitations[], riskNotes[]
- **Rate limiting**: per-IP sliding window (default 10/min)
- **Concurrency limit**: max 3 simultaneous LLM requests
- **LRU cache**: by SHA-256 digest of StructuredFacts (default 100 entries)
- **ENV naming**: OPENAI_API_KEY (legacy AI_API_KEY accepted), OPENAI_MODEL, AI_GATEWAY_PORT=3100
- **groundingGuard**: every number in output must exist in input; forbidden trading phrases
- **503 AI_NOT_CONFIGURED** when OPENAI_API_KEY absent; terminal fully operational

#### UI (`src/components/ai/AiExplanationPanel.tsx`)
- Coin Detail page: «AI-разбор актива» button with structured explanation panel
- Sections: key observations, supporting facts, counter evidence, data limitations, risk notes
- Error states: NOT_CONFIGURED, REJECTED, UNAVAILABLE, TIMEOUT, RATE_LIMITED
- «Сгенерировано AI» meta with model name and timestamp
- Disclaimer: не является инвестиционной рекомендацией

#### Tests (33 new tests in `aiExplainServer.test.ts`)
- sanitizeStructuredFacts: valid, garbage symbol, missing spot, negative price, whitelist
- validateAiExplanation: valid output, missing summary, bad arrays, too many items
- readAiConfig: no key, OPENAI_API_KEY, legacy AI_API_KEY, OPENAI_MODEL
- RateLimiter: limit enforcement, IP isolation
- DigestCache: store/retrieve, LRU eviction
- factsDigest: consistency, uniqueness, hex format
- buildCoinDetailFacts: full construction from coin detail params
- marketContextFactToStructured: MarketContextFact → StructuredFacts conversion
- LlmExplainClient: 503, 422, 200 OK, legacy text, network error, 429

#### Documentation
- `docs/AI.md`: full architecture, contracts, ENV, security, nginx recommendation
- `.env.example`: all ENV variables with empty placeholders

### Fixed
- `tests/unit/liquidations.test.ts`: replaced hardcoded `Date.UTC(2026,8,16)` with `Date.now()` —
  events were silently pruned by `recordEvent()` → `pruneExpired(Date.now())` when timestamp >24h old

## [0.8.41] — 2026-09-17

### Added — CoinGecko integration (supplementary metadata, free public API)
- **CoinGeckoAdapter** (`src/services/data/adapters/CoinGeckoAdapter.ts`): 3 endpoints:
  - `fetchGlobal()` — глобальный market cap всего крипторынка (5-минутный кэш)
  - `fetchCoinMeta(coingeckoId)` — ATH/ATL/market cap per asset (10-минутный кэш)
  - `fetchCoinsMarket(ids[])` — batch-запрос для N активов одним вызовом
- **Asset registry**: добавлено поле `coingeckoId` для всех 25 активов (BTC→bitcoin, ETH→ethereum, ...)
- **LiveMarketDataProvider.getAssetDetail()**: ATH/ATL теперь приходят из CoinGecko вместо хардкода
- **LiveMarketDataProvider.getMarketOverview()**: возвращает `globalMarketCapUsd` из CoinGecko `/global`
- **OverviewPage**: показывает «Капитализация крипторынка» (CoinGecko) или фолбэк на «Капитализация каталога»
- **CoinDetailPage**: ATH/ATL с бейджем «CoinGecko», даты в ISO-формате
- **extractBinanceSpread()**: вычисление реального спреда из bid/ask тикера Binance (normalization.ts). Источник: `GET /api/v3/ticker/24hr` (FULL), поля `bidPrice`/`askPrice` — текущий best bid/ask из стакана (Memory), НЕ значения за 24ч окно. Формула: `(ask-bid)/mid*10000`
- **CSP**: `https://api.coingecko.com` добавлен в CONNECT_SRC (productionServer.js + nginx/cryptora.conf)
- **Tests**: 12 тестов CoinGeckoAdapter + 6 тестов extractBinanceSpread
- **docs/LIVE_DATA_AUDIT.md**: ATH/ATL и global market cap обновлены с UNAVAILABLE → LIVE
- **docs/SITE_REPORT.md**: исправлен счётчик WS-стримов (3 → 4 биржи)

## [0.8.40] — 2026-09-17

### Fixed — устранение оставшихся хардкод-значений в production market-data paths

#### LiveMarketDataProvider.getAssetDetail() — индикаторы из фактических свечей
- **RSI-14, MACD, SMA-20/50/200, Bollinger Bands** в карточке актива (`/coin/:symbol`) ранее возвращали
  захардкоженные числа (`rsi14: 54.2`, `macd: 120.5`, `sma20: price×0.99` и т.д.) вместо расчёта из
  фактических свечей. Теперь используют `IndicatorEngine.computeCompleteIndicators(candles)` — тот же
  движок, что и на Обзоре для BTC. При недостаточном количестве свечей (< 26) — честный fallback
  на минимальный расчёт RSI, остальные поля = цена (не выдуманные коэффициенты).
- **ATH/ATL** (`ath`, `athDate`, `atl`, `atlDate`) были захардкожены (`price×1.4`, `'2024-03-14'`,
  `price×0.1`, `'2020-03-12'`). Текущий API (Binance/KuCoin spot) не отдаёт исторические экстремумы.
  Поля сделаны опциональными в Zod-схеме `AssetDetailSchema`; UI показывает «Н/Д» с подсказкой вместо
  выдуманных значений.

#### OverviewPage — производные из фактических данных
- **«80% РОСТ»** в карточке широты рынка — захардкожено. Теперь вычисляется:
  `advancing / (advancing + declining) × 100`.
- **«+6.8% за 24h»** — агрегированное изменение OI. Было захардкожено. Теперь: взвешенное среднее
  Δ OI 24ч по фьючерсам с `openInterestChangeSource === 'ACTUAL'`; при отсутствии фактических
  данных — «Δ24ч — нет фактических данных OI».
- **«Базис BTC: +0.048%»** — было захардкожено. Теперь: `btcFutures.basisPct` из фактического среза.

### Changed
- `AssetDetailSchema`: `ath`, `athDate`, `atl`, `atlDate` → optional.
- `CoinDetailPage`: ATH/ATL отображение обрабатывает `null`/`undefined` → «Н/Д» с tooltip.

### Docs
- `docs/LIVE_DATA_AUDIT.md` — полная матрица аудита 87 полей по 17 маршрутам с классификацией
  FACTUAL/DERIVED/MODEL/STATIC_REFERENCE/UNAVAILABLE.

### Tests
- `npm run typecheck` — 0 ошибок; `npm test` — **405/405**; `npm run build` — чистый;
  `npm run test:e2e` — **66/66**.

---

## [0.8.39] — 2026-09-17

### Added — ROADMAP п. 6 News/Articles: собственные статьи владельца (решение владельца: markdown в репозитории, без внешних лент)
- `content/articles/*.md` с фронтматтером (title/date/author/summary/tags/sponsored) → `scripts/build-articles-index.mjs` (prebuild) →
  `/articles` и `/articles/:slug`. Собственный безопасный markdown-рендерер без зависимостей: raw-HTML экранируется, `javascript:`-ссылки
  отбрасываются, внешние ссылки `rel="noopener noreferrer nofollow"`. Внешних запросов нет. Первая статья — «Как читать CRYPTORA».
- Тесты: фронтматтер, рендер/экранирование, сортировка, актуальность сгенерированного индекса, запрет промо-формулировок; e2e список/статья/404.
- Навигация «Инструменты → Статьи».

### Added — ROADMAP п. 7 Рекламные слоты: «Sponsored / Partner» из JSON-конфига (решение владельца: без внешних ad-сетей)
- `content/sponsor-slots.json` (+ JSON-schema), три слота: `overview-sidebar`, `articles-list`, `footer-banner`. Пустой конфиг (как сейчас) —
  слоты не рендерятся вовсе. Каждый показ: бейдж «Sponsored / Partner», подпись «партнёрский материал, не рекомендация CRYPTORA»,
  `rel="sponsored"`, только `https://`. Окно активности по датам; тексты с обещаниями доходности отфильтровываются.
- Тесты: валидация, фильтры; e2e — при пустом конфиге ни одного слота на странице.

---

## [0.8.38] — 2026-09-17

### Added — Этап 7: LLM-объяснение поверх фактов (по решению владельца: серверный эндпоинт, ключ в env)
- `POST /api/ai/explain` в `productionServer.js` (`server/ai/explain.mjs`): OpenAI-совместимый провайдер (`AI_API_KEY`, `AI_BASE_URL`,
  `AI_MODEL`, `AI_TIMEOUT_MS`). Без ключа — `503 {configured:false}`; клиент остаётся на детерминированном движке. Ключ в браузер не попадает.
- Вход — только whitelisted числовые факты (`sanitizeFacts`); свободный текст от клиента в промпт не попадает.
- **Страж заземления** (`server/ai/groundingGuard.mjs`): каждое число в ответе LLM обязано присутствовать среди фактов (с учётом округления
  и форматов 64 850,25 / 64,850.25); запрещённые формулировки (гарантии, цели по цене, покупай/продавай, TP/SL) → `422`, текст не отдаётся.
- Клиент `LlmExplainClient.ts`; `/radar` показывает блок «Пояснение LLM по тем же фактам» только при `grounded:true`, с пометкой модели и
  стража; отклонённый ответ показывается как «отклонён стражем», не текстом. Детерминированный брифинг остаётся основным.
- Проверено локально с фейковым провайдером: 503 без ключа / 200 заземлённый / 400 мусор / 422 галлюцинация «90000».
- Тесты: `aiExplainServer.test.ts` (7) — извлечение чисел, страж, конфиг, санитизация, клиент.

---

## [0.8.37] — 2026-09-17

### Changed — Тарифы: честное состояние «биллинг не подключён»
- Модал тарифов показывал цены $29/$99 и кнопки «Переключить на …» без какой-либо оплаты — посетитель мог принять это за подписку.
  Добавлено уведомление «Биллинг не подключён… предпросмотр ограничений, а не покупка»; кнопки переименованы в «Предпросмотр: …».
- e2e: модал содержит уведомление и не содержит «Оформить/Купить/Оплатить». `16-MONETIZATION.md` §3 — фактическое состояние.

---

## [0.8.36] — 2026-09-17

### Fixed — Брифинг на /radar строился из захардкоженных чисел
- `RadarPage` передавал в `AiExplanationEngine` фиксированные `price 64500/3480/158`, `change24h 3.2`, `funding 0.012`, `Δ OI 6.8`,
  `RSI 64.5` для любого события — брифинг «объяснял» несуществующие факты. Теперь факты берутся из провайдера: цена/Δ24ч
  (`getAssetDetail`), фандинг и Δ OI с его происхождением (`getFuturesList`), RSI(14) по свечам 1h (`IndicatorEngine`).
  Недоступный факт опускается, а не подставляется; ESTIMATED Δ OI оговаривается в тексте.
- Единицы фандинга исправлены: движок получал % за 8ч, но умножал ещё на 100 (показывал бы 1.2% вместо 0.012%).
- Подпись «БРИФИНГ AI-АНАЛИТИКА» → «Аналитический брифинг … без LLM»: это детерминированные правила, LLM (Этап 7 ROADMAP) не подключён.
- Тест: все числа в брифинге выводимы из входного контекста; отсутствующие факты не упоминаются (правило docs/AI.md).

---

## [0.8.35] — 2026-09-17

### Fixed — Production CSP: разрешены все фактические источники фронтенда
- `server/productionServer.js` `connect-src` содержал только Binance/KuCoin REST и spot-WS. На VPS это молча блокировало бы
  потоки ликвидаций (`wss://fstream.binance.com`, `wss://stream.bybit.com`, `wss://ws.okx.com:8443`, `https://www.okx.com`),
  Fear & Greed (`api.alternative.me`), DeFiLlama (`api.llama.fi`), mempool.space и доставку Telegram (`api.telegram.org`) —
  соответствующие разделы показывали бы «ИСТОЧНИК НЕДОСТУПЕН» при живой сети. Список вынесен в `CONNECT_SRC` с комментариями.
- Новый тест `tests/unit/cspConnectSrc.test.ts`: каждый https/wss origin из `src/` обязан присутствовать в `CONNECT_SRC`
  (защита от повторения при добавлении адаптеров).

---

## [0.8.34] — 2026-09-17

### Changed — Журнал сделок: без выдуманных «бумажных сделок»
- `JournalService` больше не засевает журнал тремя вымышленными записями с PnL и «оценкой дисциплины». По умолчанию журнал пуст;
  записи добавляются вручную и хранятся только в localStorage браузера. Страница показывает честное пустое состояние.
- Итог сверки после v0.8.30–0.8.34: в терминале не осталось ни одного раздела с иллюстративными данными, выданными за факт.

---

## [0.8.33] — 2026-09-17

### Changed — /signals: иллюстративные сетапы удалены; реестр пуст и честно об этом говорит
- `SignalsAuditLedger` больше не засевается выдуманными сетапами с «результатами» (+15.4% и т.п.). По умолчанию реестр пуст; записи
  только через `append()` (append-only цепочка). Хэш — настоящий SHA-256 (`src/utils/sha256.ts`, синхронная реализация, проверена на
  тест-векторах FIPS) вместо 32-битной свёртки, подписанной как «sha256-».
- Страница показывает блок «Реестр пуст: фактических сетапов нет» и методологию; метрики точности при пустом реестре = 0.
- `StaticDatasetNotice` удалён — статических страниц не осталось (все справочные разделы либо на фактическом источнике, либо честно пусты).
- Навигация: подписи /signals, /ecosystem по фактическому содержанию.
- Тесты: SHA-256 векторы, пустой реестр по умолчанию, цепочка 64-hex + детекция подмены; e2e пустое состояние /signals.

---

## [0.8.32] — 2026-09-17

### Changed — /calendar: статический макро-календарь заменён расписанием деривативов Binance
- `BinanceFuturesAdapter.fetchExchangeInfo()` (`/fapi/v1/exchangeInfo`, zod-схема `BinanceFuturesExchangeInfoSchema`).
- `CalendarService.fetchReport()` — события двух видов: начисления фандинга (premiumIndex.nextFundingTime по BTC/ETH/SOL/BNB/XRP,
  с текущей ставкой источника) и экспирации срочных контрактов (exchangeInfo.deliveryDate, status TRADING, горизонт ≤2 лет). Кэш 5 мин.
  Отказ источника → `DataSourceUnavailable`, без статического fallback.
- Удалены выдуманные FOMC/CPI/NFP/разблокировки с «прогнозами рынка» и «предыдущими значениями» — источника не было.
- Навигация/Обзор: подписи «Он-чейн & MVRV», «MVRV Z-Score, NUPL…», «FOMC, отчеты CPI…» заменены на фактическое содержание страниц.
- Тесты: unit чистого билдера (фильтр перпов/прошлого/группировка/сортировка) и отказ без fallback; e2e состояние источника.
- UNVERIFIED: живой ответ exchangeInfo в песочнице не проверен.

---

## [0.8.31] — 2026-09-17

### Changed — /onchain: статический набор заменён фактическими метриками сети Bitcoin (mempool.space)
- Новый адаптер `MempoolSpaceAdapter` (публичный API без ключа): хешрейт 3д, ретаргет сложности, рекомендованные комиссии, мемпул,
  высота блокчейна; zod-валидация, таймаут 8с.
- `OnChainService.fetchReport()` — 5 метрик BTC + блок комиссий; Δ хешрейта по 3д-ряду источника; прогноз ретаргета помечен как оценка
  источника. Кэш 60с. Отказ любого из 5 запросов → исключение, страница показывает `DataSourceUnavailable`; статического fallback нет.
- Удалены выдуманные MVRV/NUPL/ETH-стейкинг/«биржевые нетфлоу» и «сигнал модели» (BULLISH/NEUTRAL) — источника не было.
- Тесты: unit с mock-fetch (сборка, отказ целиком, короткий ряд), e2e состояние источника без сети.
- UNVERIFIED: живой ответ mempool.space в песочнице не проверен.

---

## [0.8.30] — 2026-09-17

### Changed — /ecosystem: статический набор заменён фактическим источником (DeFiLlama)
- Новый адаптер `DefiLlamaAdapter` (`api.llama.fi/v2/chains`, `/v2/historicalChainTvl/{chain}`; публичный API без ключа; zod-валидация, таймаут 8с).
- `EcosystemService.fetchReport()` — TVL по 10 отслеживаемым сетям (6 L1 / 4 L2), Δ7д по дневному ряду источника (null, если ряда нет),
  доля L2, TVL всех цепочек источника и покрытие каталога. Кэш 10 мин. При отказе источника — исключение, страница показывает
  `DataSourceUnavailable`; статического fallback нет.
- Удалены поля без источника: комиссии/сутки, TPS, активные адреса, стейблкоины (и ранее захардкоженные числа). Страница явно
  перечисляет, чего не показывает и почему.
- Тесты: `calendarAndEcosystem.test.ts` — Δ7д, сборка отчёта из mock-ответа (пропуск неизвестных/отрицательных), отказ без fallback.
- UNVERIFIED: живой ответ DeFiLlama в песочнице не проверен (нет сети); схема — по публичной документации API.

---

## [0.8.29] — 2026-09-17

### Changed — Обзор: 24h-дельты без констант; прогноз фандинга без ×1.05
- `marketCapChange24h` — **точная производная** из данных источника: prevCap = cap / (1 + change24h/100) по каждому активу; константа 1.85 удалена.
- `volumeChange24h` — против собственного снимка объёма ≥24ч давности (`aggregateHistory.ts`, localStorage `cryptora_overview_history_v1`,
  шаг ≥10 мин, хранение 48ч, окно поиска базы 24–30ч); пока базы нет — `null` и чип «Δ24ч —» с пояснением. Константа 4.2 удалена.
- Доминация BTC/ETH при отсутствии актива в ответе — 0, а не «типичные» 56.4/14.8.
- `predictedFundingRate` = текущая ставка источника (Binance не публикует отдельный прогноз; ×1.05 была выдумкой), добавлен
  `nextFundingTime`; на странице монеты подпись «Ставка к следующему начислению · через Xч Yм».
- Снята пометка `MODEL / ESTIMATED` с карточек капитализации и объёма (там больше нет модельных чисел). Схема: оба поля `nullable`.
- Тесты: `aggregateHistory.test.ts` (3). Всего: vitest 380, playwright 60, typecheck 0.

---

## [0.8.28] — 2026-09-17

### Changed — ликвидации 24ч по инструменту на `/futures` из фактического потока
- `FuturesAsset.liquidationsSource: 'ACTUAL' | 'ESTIMATED' | 'UNAVAILABLE'`. `LiveMarketDataProvider.applyFactualLiquidations`: при
  подключённом потоке (`LIVE_STREAM` / `AWAITING_STREAM`) суммы long/short берутся **только** из `LiquidationPipeline.assetBreakdown`
  (окно 24ч, Binance + Bybit + OKX); нет событий по инструменту → `UNAVAILABLE` и нули. Эвристика 0.5% оборота остаётся лишь при
  недоступном потоке и помечена `ESTIMATED`.
- `/futures`: колонка «Ликв. шортов (24ч)» — `EST.` при эвристике, «—» с подсказкой при отсутствии событий, чистое значение при ACTUAL
  (`data-qa=liq-short-24h`, `data-source`). Pulse на странице монеты уже был source-aware — теперь источники согласованы.
- Тесты: `futuresLiquidationsSource.test.ts` (2). Всего: vitest 377, playwright 60, typecheck 0.

---

## [0.8.27] — 2026-09-17

### Added — Fear & Greed из фактического источника (Alternative.me)
- `AlternativeMeAdapter` (`GET https://api.alternative.me/fng/?limit=1`, zod-схема, timeout 8 с, классификация по официальным
  порогам 0–24/25–44/45–55/56–75/76–100). `AdapterSource` расширен на `'alternative.me'`.
- `MarketOverviewData.fearAndGreed` стал `nullable` с `source: 'alternative.me' | 'qa-fixture'` и `timestamp`; `LiveMarketDataProvider`
  кэширует индекс 10 мин и при отказе источника возвращает `null` — **фиксированное 62/Greed удалено**.
- Обзор: карточка «Индекс страха и жадности» (`data-qa=fear-greed-card`, `data-source`) — `LIVE · ALTERNATIVE.ME` с временем расчёта,
  `QA` в фикстуре, `НЕДОСТУПЕН` и «—» при отказе. Русские подписи классов. Снята пометка `MODEL / ESTIMATED` с этой карточки.
- Тесты: `fearGreed.test.ts` (3: пороги, адаптер/ошибки, провайдер+кэш+null); e2e проверяет, что QA-фикстура не помечена как LIVE.

---

## [0.8.26] — 2026-09-17

### Changed — `/correlations` считается по фактическим свечам
- `buildCorrelationReport` (чистая функция): дневные лог-доходности по свечам 1D, окно 30 дн., выравнивание рядов по хвосту, матрица
  Пирсона, бета/волатильность к BTC, исключение символов с < 10 точек. Детерминирована, покрыта unit-тестами (±1, beta 2×, INVERSE).
- Страница: 8 активов каталога (BTC, ETH, SOL, BNB, XRP, DOGE, AVAX, NEAR) через `provider.getCandles(sym, '1D')`; отказ источника →
  «Фактический источник недоступен»; провенанс свечей в бейдже (`LIVE-СВЕЧИ 1D` / `QA-СВЕЧИ`, `data-qa=correlations-source`).
- Удалены статические `getMacroCorrelationMatrix` / `getBetaRankings` и макро-бенчмарки SP500/GOLD/DXY — у терминала нет их фактического
  источника; это прямо сказано на странице. Снята плашка «СТАТИЧЕСКИЙ НАБОР» с `/correlations` (остаётся на 4 страницах).
- Известное свойство QA-фикстуры: все символы генерируются одной формой ряда → в QA-режиме матрица +1.00 повсюду (помечено QA-СВЕЧИ).

---

## [0.8.25] — 2026-09-17

### Added — фактический Δ OI (Binance openInterestHist)
- `BinanceFuturesAdapter.fetchOpenInterestHist` (`/futures/data/openInterestHist`, period 1h, limit 25) + zod-схема.
- `DerivativesEngine.calculateOpenInterestChanges`: Δ1ч и Δ24ч по историческому ряду; `FuturesAsset.openInterestChangeSource = 'ACTUAL' | 'ESTIMATED'`.
  Без ряда прежняя эвристика сохраняется, но помечается ESTIMATED. OI в USD берётся из `sumOpenInterestValue`, когда ряд есть.
- `LiveMarketDataProvider`: ряды OI по 25 символам с отдельным кэшем 5 мин (биржа обновляет их раз в 5 мин); отказ по символу → ESTIMATED
  только у него.
- UI: бейдж `EST.` (`OiDeltaBadge`, `data-qa=oi-delta-estimated`) у оценочных Δ OI на `/futures`, `/coin/:symbol`, Обзоре и в Pulse;
  при ACTUAL бейджа нет. Попутно исправлен класс `font-mono${…}` без пробела в трёх местах.
- Алерт `OI_SPIKE` теперь оценивается — **только** по ACTUAL-ряду (ESTIMATED в алерты не подаётся); текст в модалке обновлён.

### Fixed — LIVE-first: убран скрытый демо-фолбэк деривативов и радара
- `LiveMarketDataProvider.getFuturesList()` при отказе Binance Futures возвращал **демо-датасет под бейджем «LIVE-ДЕРИВАТИВЫ · BINANCE FUTURES»**
  (обнаружено скриншотом в песочнице). Теперь — `AdapterNetworkError`, страницы показывают «Фактический источник недоступен».
- `getRadarEvents()` без фактических аномалий возвращал демо-события; теперь пустой список.
- Обзор и Coin Detail: вспомогательные запросы (деривативы/радар/ликвидации) через `Promise.allSettled` — их отказ не прячет страницу и
  не подставляет значения. Unit-контракт обновлён (`liveDataProvider.test.ts`), +5 тестов `openInterestHistory.test.ts`.

---

## [0.8.24] — 2026-09-17

### Changed — документация и честная маркировка справочных страниц
- `docs/SITE_REPORT.md` — сводный отчёт по всему сайту: карта источников (LIVE / DERIVED / MODEL / STATIC / LOCAL) по 17 маршрутам,
  что подтверждено автоматикой, что UNVERIFIED, известные долги, рекомендуемый порядок работ.
- `/signals`, `/correlations`, `/onchain`, `/calendar`, `/ecosystem`: компонент `StaticDatasetNotice` («СТАТИЧЕСКИЙ НАБОР») — данные этих
  страниц зашиты в код и не запрашиваются из внешнего источника; убраны вводящие в заблуждение подписи «Обновляется посуточно», «N=30d»,
  «Скользящее окно 30 дней», «в реальном времени». E2E-guard на наличие маркировки.
- README: раздел возможностей переписан под фактическое состояние v0.8.24 (был «Этап 1: Visual Foundation & Demo Data»).

---

## [0.8.23] — 2026-09-17

### Added — Этап 6: расширенная система алертов (Telegram / Webhook)
- `src/services/alerts/alertEvaluator.ts`: чистая оценка правил `ABOVE` / `BELOW` (цена), `FUNDING_EXTREME` (|фандинг 8ч|), `OI_SPIKE`
  (Δ OI 1ч); cooldown 5 мин на правило, пауза, детерминированные id событий, источник входа в тексте уведомления.
- `MarketDataContext`: правила оцениваются на каждом WS-тике (`ticker:*`) по подписанным символам; для FUNDING_EXTREME — REST-опрос
  `getFuturesList` раз в 60 с (демо-фолбэк провайдера игнорируется); история срабатываний (`cryptora_alert_history`, ≤100),
  счётчик непрочитанных в шапке (`data-qa=alerts-unread-badge`), лимит тарифа (`PlanManager.getMaxAlerts`: FREE 2 / PRO 25 / ENTERPRISE 999).
- Каналы доставки `deliveryChannels.ts` + `AlertDispatcher`: В приложении, браузерные Notification (только при `granted`),
  Telegram Bot API `sendMessage` (bot token + chat id пользователя, запрос напрямую в api.telegram.org), Webhook POST JSON
  `cryptora.alert.v1` (CORS-ошибка → повтор no-cors → статус `SENT_UNCONFIRMED`). Журнал доставки `cryptora_alert_delivery_log` (≤200).
  Настройки каналов хранятся только в localStorage браузера; серверного посредника у CRYPTORA нет — это зафиксировано в UI.
- `AlertsModal`: вкладки Правила / История / Каналы; удалены подписи «превью», «Демо-алерт», «Очередь прототипа» и стартовый
  фиктивный алерт `alert-sample-1` (старое значение вычищается из хранилища при загрузке).

### Tests
- `tests/unit/alertsEvaluator.test.ts` (8): пороги, cooldown/paused, иммутабельность `evaluateAll`, валидация конфигов, Telegram 2xx/401
  (секрет не попадает в журнал), webhook no-cors, персистентность журнала. E2E: создание правила → фактический тик → история и бейдж →
  лимит тарифа. Всего: vitest 366, playwright 58, typecheck 0.

### Known limitations
- `OI_SPIKE`: источник Δ OI 1ч в реальном времени не подключён (в `DerivativesEngine` поле оценочное) — правило можно сохранить, но оно не
  оценивается; это указано в селекторе триггера. Живая доставка в Telegram/webhook из песочницы не проверена (внешняя сеть закрыта) —
  проверено на моках HTTP-ответов; **UNVERIFIED в проде**.

---

## [0.8.22] — 2026-09-17

### Added — Этап 6: фактические потоки ликвидаций Bybit и OKX
- Общий транспорт `LiquidationStreamTransport` (переподключение, keep-alive, честная деградация); Binance-поток переведён на него без
  изменения поведения (URL `!forceOrder@arr`, тесты зелёные).
- `BybitLiquidationStream`: Bybit V5 `allLiquidation.{symbol}` (linear USDT-перпы каталога), подписка пачками ≤10 топиков, `{"op":"ping"}`
  каждые 20 с. Семантика по документации Bybit: `S=Buy` ⇒ ликвидирован лонг, `S=Sell` ⇒ шорт; USD = bankruptcy price × размер.
- `OkxLiquidationStream`: OKX `liquidation-orders` (instType SWAP), `ping`/`pong` каждые 25 с. `sz` в контрактах ⇒ USD = bkPx × sz × ctVal,
  ctVal из публичного `/api/v5/public/instruments?instType=SWAP`; без каталога поток остаётся `unavailable` — события не оцениваются.
  Только `*-USDT-SWAP`; инверсные контракты отбрасываются.
- Конвейер: состояние транспорта по каждой бирже (`getStreamStates`), агрегированный статус (connected, если жив хотя бы один),
  идемпотентность по id события (повторный snapshot не удваивает агрегаты).
- UI `/liquidations`: чипы состояния по биржам (Binance Futures / Bybit / OKX · поток / подключение / переподключение / недоступен),
  бейдж LIVE перечисляет только подключённые биржи; «Доли неподключённых бирж не оцениваются».
- Тесты: `liquidationsMultiExchange.test.ts` (9), e2e LIVE-first сценарий для трёх потоков. Никаких ключей, никакого исполнения.

## [0.8.21] — 2026-09-17

### Changed — UX-цикл E: визуальная полировка (контраст, overflow, скриншот-QA обеих тем)
- Автоматический аудит контраста (WCAG AA: 4.5:1 текст / 3:1 крупный) по 17 маршрутам × 7 ширин × 2 темы в headless Chromium.
- DARK: `slate-500` → `#7484a0` (4.02 → 4.57–5.05:1 на surface); чип категории актива (`l1`, `defi`) — `slate-400`;
  исправлена несуществующая утилита `text-surface-bg` у кнопки «Запустить бэктест» (белый на циане 1.47:1 → `text-slate-950`).
- LIGHT: фирменные акценты `brand-*`/`accent-*` переведены на токены `--c-brand-*` и затемнены до 700-х оттенков (текст ≥4.5:1 на белом);
  шкалы акцентов `200/300/400/500` → `900/800/700/700`; текст поверх акцентных заливок (`slate-950`) → токен `--c-on-accent` (белый в LIGHT).
- Горизонтальный overflow на 390px устранён на `/radar`, `/correlations`, `/signals` (фильтры и легенды — `flex-wrap`).
- Декоративные разделители (`/`, `|`, `•`) помечены `aria-hidden`. Остаточные срабатывания аудита — только они и ячейки матрицы
  корреляций (аудит не учитывает alpha-заливку; фактический контраст ≥7:1).

## [0.8.20] — 2026-09-17

### Added — UX-цикл владельца п. 5: переставляемые модули workspace (Coin Detail)
- Три крупных модуля страницы актива («График и пульс актива», «Метрики, деривативы, индикаторы», «Стакан, пары и радар»)
  переставляются: drag-handle (HTML5 DnD) + клавиатурная альтернатива (кнопки ▲/▼ и стрелки ↑/↓ на ручке, aria-label с позицией).
- Раскладка хранится в `localStorage.cryptora_workspace_coin` с версионированной схемой (`schemaVersion: 1`); невалидная/устаревшая
  запись → раскладка по умолчанию; кнопка «Сбросить раскладку» (неактивна при дефолте).
- Внутреннее устройство модулей не менялось: график 72/28 + Pulse, провенанс QA-СВЕЧИ/QA-ДАТАСЕТ, стакан, пары, радар.
- Тесты: `tests/unit/coinWorkspaceLayout.test.ts` (5), e2e-сценарий перестановки/сохранения/сброса; скриншоты 390/1440.

## [0.8.19] — 2026-09-17

### Added — UX-цикл владельца п. 4: темы DARK / LIGHT / SYSTEM
- Семантические токены темы `--c-*` (`src/index.css`: `:root` DARK, `html.light` LIGHT); Tailwind-палитры `surface/white/slate` и
  акцентные шкалы переведены на переменные с поддержкой alpha — существующая разметка темизируется без переписывания.
- `ThemeProvider` + `src/theme/theme.ts`: режимы dark/light/system, `prefers-color-scheme` с live-реакцией, сохранение в
  `localStorage.cryptora_theme`, анти-FOUC inline-скрипт в `index.html`, переключатель `ThemeToggle` в шапке.
- Темизация графиков: `CandleChart` читает `--chart-*` токены и перекрашивается при смене темы.
- 148 произвольных `bg-[#hex]` заменены на токены (`bg-surface*`); тест-охрана `tests/unit/theme.test.ts` (8): парность токенов,
  неизменность финансовой семантики, запрет hex, логика выбора/хранения, синхронность inline-скрипта.
- Screenshot QA обеих тем 390/1440 × 6 маршрутов.

## [0.8.18] — 2026-09-17

### Changed — UX-цикл владельца п. 3: типографика, контраст, иерархия
- Sans (Inter) для всех заголовков/подписей/пояснений; mono (JetBrains Mono) только для чисел, цен, процентов, тикеров, хэшей и
  ярлыков провенанса; все числовые узлы — `font-mono tabular-nums`. Контейнеры страниц больше не навязывают mono.
- Минимальный кегль 11px: 119 вхождений `text-[9px]`/`text-[10px]` заменены на 11px (0 текстовых узлов < 11px на 5 маршрутах × 7 ширин, проверено в браузере).
- ALL CAPS: 35 заголовков страниц и блоков переведены в обычный регистр; `uppercase` оставлен только для статус-чипов и шапок таблиц (77 → 18).
- `/liquidations`: дисклеймер «Фактическая ликвидация ≠ расчётный уровень» — компактный раскрываемый блок без потери текста.
- `tests/unit/typography.test.ts` (3): запрет < 11px, запрет mono+uppercase, лимит uppercase. `docs/DESIGN_SYSTEM.md` §4 переписан.
  Screenshot QA `/`, `/liquidations`, `/tools`, `/futures`, `/market` × 390…1920: overflow 0.

## [0.8.17] — 2026-09-17

### Added — Архив стратегий C8: UI `/strategies` «Архив исследований → 13 версий»
- `strategyArchive/presentation.ts` — чистая модель карточек из реестра (порядок хронологический, без рейтинга по доходности),
  RU-ярлыки вердикта и воспроизведения раздельно, фильтры, `comparabilityWarnings` (семейства допущений V3 / V2 pooled / V2.8 gross / V2.1 lump).
- `StrategyArchivePanel.tsx` заменяет одиночную карточку V3.0: 13 карточек, 6 фильтров, сравнение допущений (до 3) с предупреждением
  о несопоставимости; headline-цифры `SOURCE_REPORTED`; provenance; правила; оговорки; расхождения. Нет BUY/SELL/Execute/бот/ключей.
- Тесты: `presentation.test.ts` (11), e2e `/strategies` (13 карточек, verdict ≠ reproducibility, фильтр, предупреждение V2.8 vs V3.0).
  Screenshot QA 390…1920 — без переполнения (`screenshots/archive-c8/`, не коммитятся).

## [0.8.16] — 2026-09-17

### Added — Архив стратегий C7: V2.1a + V2.1b (архив источника перенесён полностью: 13/13)
- `definitions/v2_1a-structural-limit-entry/` (REJECTED_ON_TRAIN, pin `4b25bbb`; prereg `e3750fc`): модели B/C/D через
  `legacy/v2/research/limitEntryReplay.ts` (дословный порт `limit-entry-replay.ts`); модель A (baseline windowed-replay) —
  SOURCE_REPORTED, не портирована. Артефакты `results/v21a/` (metrics, gross, model-A fidelity, structural audit) с sha256.
- `definitions/v2_1b-corridor-entry/` (REJECTED_ON_TRAIN, pin `374b335`; prereg `5ce3761`; tf-cost `dccf751`): 7 веток
  A/E/F/C/EF/EFC/FULL через `legacy/v2/research/corridorReplay.ts` + `legacy/v2/corridorEntry.ts`; `results/v21b/`.
- Расхождения D-V21A-001…006 / D-V21B-001…006: lump-комиссия 0.1 % источника vs per-leg колонки архива (DERIVED),
  метрика «gross на исходный setup» vs gross/filled, поля «gross…» в metrics-артефакте = нетто после lump (D-V21A-006).
- Оба статуса **SOURCE_CHAIN_VERIFIED_NOT_RERUN**: пины sha256 сверены, раннеры перенесены, но перезапуск 42 рядов
  1m…1d × 6 пар не выполнен (OOM при 4 GB; причина записана в `reproductionBlockedReason`). Не помечены REPRODUCED.
- `reproduce.mjs`: посимвольная потоковая загрузка для `1m`-scope; сравнение gross/счётчиков/byTimeframe для lump-артефактов.
- Реестр: 13 импортировано, `STRATEGY_ARCHIVE_PLANNED = []`. Тесты `v21.test.ts` (15): пины, вердикты, инверсия gross↔net,
  примитивы зоны/коридора/fee-guard, окно без look-ahead, полнота реестра (9 отрицательных вердиктов из 13).

## [0.8.15] — 2026-09-16

### Added — Архив стратегий C6: замороженный движок V2 `4839074` (изолированно) + V2.2…V2.6 + перезапуски V2.2–V2.8
- `src/services/strategyArchive/legacy/v2/` — движок V2 источника @ `4839074` (engine/htf/indicators/structure/tracker/risk,
  `resolveEntry`, `executableLadder`, `v24Engine`, `corridorEntry`, research `v22/v23Engine`, `v22/v23/v24Replay`) с `LEGACY_V2_PROVENANCE`
  (sha256 каждого файла); DB-класс `Settings` заменён read-only ридером sha-пинованного snapshot. Только для `definitions/v2_*`;
  тест запрещает импорт из любого production-модуля. `EXECUTION_CODE_PORTED = NONE`.
- `definitions/v2_2-htf-spot-engine` (REJECTED_ON_TRAIN, pin `5ce58db`), `v2_3-sniper-reversal` (REJECTED_ON_TRAIN, `2ee06d1`),
  `v2_4-asymmetric-sniper` (FAILED_VALIDATION, `c52fda7`, freeze `53c9ad8`), `v2_5-trailing-stop` (TRAIN_ONLY_NOT_VALIDATED, `07dabbb`),
  `v2_6-sniper-trailing` (REJECTED_ON_TRAIN, `e89cf1e`) — все arms, артефакты, расхождения D-V22…D-V26, оговорки RU.
- Реальные перезапуски на `c3c1dce` (15m/30m/1h/4h + 1d HTF) совпали с артефактами по всем сравниваемым полям → `REPRODUCED`:
  V2.2 FULL n=5323; V2.3 S-cor n=1497; V2.4 S-asym TRAIN n=689 и VALIDATION n=234 (провал воспроизведён); V2.5 V25 n=30 867;
  V2.6 V26 / V26-frozen-exit n=317; V2.7 RR15…RR40 n=317; V2.8 7 TRAIN-веток + SMC/Trail VALIDATION n=98. Частичный охват
  (не все ветки V2.2/V2.3/V2.4/V2.5) явно указан в `*_REPRODUCED_RESULTS.scope`. Evidence: `results/v2x/cryptora-reproduction/`.
- `scripts/strategy-archive/reproduce.mjs`: object-keyed arms V2.x, сравнение нечувствительно к порядку ключей.
- Реестр: 11 импортировано + 2 запланировано (V2.1a/b) = 13. Тесты `legacyV2.test.ts` (30) — изоляция, provenance, look-ahead
  (`maxOpenTimeRead ≤ toMs`), replay-примитивы, честность статусов; `v27v28.test.ts` обновлён. Все 71 sha-пин V2.2–V2.8 пересчитаны.

## [0.8.14] — 2026-09-16

### Added — Архив стратегий C5: V2.7 + V2.8 (семантика комиссий сохранена)
- `definitions/v2_7-rr-optimization/` — порт `research/v27_rr_test.ts` @ `965fb15` (`simulateFixedRr`, `feeR`); 5 arms
  RR15…RR40, все нетто-отрицательны (n=317), fee drag 0.1555 R одинаков → `REJECTED_ON_TRAIN`, headline нет.
- `definitions/v2_8-zero-fee-sniper-trailing/` — порт `research/v28_gross_only.ts` @ `54243a7` / `v28_validate.ts` @ `1d4d575`
  + `shared/legacyResearch/v25Trailing.ts` (frozen V2.5 trailing). Verdict `VALIDATED_GROSS_ONLY`; новый контракт
  `FrozenAssumptions.feeSemantics` (`GROSS_ONLY_ZERO_FEE`) — V2.8 никогда не показывается рядом с net@fees V3.x без предупреждения.
- Контракт: `StrategyDefinition.legacyEngineDependency` (`FROZEN_V2_ENGINE_4839074`), `scopeTimeframes` (V2.x: 15m/30m/1h/4h в одном пуле).
- Reproducibility обеих версий = `SOURCE_CHAIN_VERIFIED_NOT_RERUN`: входы производит замороженный движок V2 `4839074`,
  который переносится в C6 как изолированная архивная зависимость; раннеры отказываются выдумывать входы.
- Расхождения D-V27-001…004, D-V28-001…005. Реестр: 6 импортировано + 7 запланировано = 13. Тесты `v27v28.test.ts` (13).

## [0.8.13] — 2026-09-16

### Added — Архив стратегий C4: V3.3 HTF Zone Mitigation & LTF Squeeze (ТОЛЬКО TRAIN, 8 прогонов воспроизведены)
- `definitions/v3_3-htf-zone-mitigation/` — дословный порт `research/v33_zone_mitigation.ts` (sha `3f5b1478…`, pin `a7ecd79`);
  в `shared/primitives.ts` добавлены замороженные `detectDisplacement` / `buildOrderBlock` / `findFvg` из `structure.ts` (`e04806a3…`).
- Все 8 архивных прогонов (window while/first × stop protective/climax × leg displacement/swing) реально прогнаны на `c3c1dce`
  и совпали с источником по всем полям. Headline (предзаявленный `isPrimary`) while-protective-displacement: n=6957 gross +0.0778
  net +0.0267 fee 0.0511 TP1 65.24 %. Research verdict новый тип `TRAIN_ONLY_NOT_VALIDATED`: критерии F1/F2/F3 пройдены на TRAIN,
  VALIDATION не проводилась (окно израсходовано V3.0), результат хрупок по хвосту. Остальные 7 — чувствительность
  (first/protective проваливают F1; stop=climax до +0.1058 — постфактум, не «результат V3.3»).
- Расхождения D-V33-001…005 (в т.ч. переименование Zone Continuation → Mitigation, отсутствие валидации).
- `reproduce.mjs`: нормализация funnel `triggersInZone` → `signals`. Реестр: 4 импортировано + 9 запланировано = 13.

## [0.8.12] — 2026-09-16

### Added — Архив стратегий C3: V3.2 Volume Climax & Absorption (ФАЛЬСИФИЦИРОВАНА, 4 варианта воспроизведены)
- `definitions/v3_2-volume-climax/` — дословный порт `research/v32_volume_climax.ts` (sha `c209b8d7…`, pin `b46b4a0`).
- Все 4 архивных варианта (cascade union/fast3 × tp1 cascade/ema50) реально прогнаны на `c3c1dce` и совпали
  с источником по всем полям: primary n=307 gross −0.0082 net −0.0620; fast3 n=158 net −0.1126; union-ema50
  n=213 net +0.0530; fast3-ema50 n=97 net +0.0108. Verdict `FALSIFIED_ON_TRAIN`; EMA50-варианты — `UNPROMOTED`
  (F3 фальсифицирован) и не выдаются за «результат V3.2».
- Расхождения D-V32-001…003. Реестр: 3 импортировано + 10 запланировано = 13.

## [0.8.11] — 2026-09-16

### Added — Архив стратегий C2: V3.1 HTF Trend Pullback & Mitigation (ФАЛЬСИФИЦИРОВАНА, воспроизведена)
- `definitions/v3_1-htf-trend-pullback/` — дословный порт `research/v31_trend_pullback.ts` (sha `1f18bb3c…`,
  pin `292050c`): оба архивных варианта `leg` (PRIMARY) и `same-bar` (SECONDARY), без выбора лучшего.
- Реальный прогон TRAIN на датасете `c3c1dce`: leg n=158 gross −0.0838 net −0.1097 PF 0.7873; same-bar n=82
  net −0.2819 — все поля источника (funnel, exits, bySymbol, TP1/TP2 hit rate…) совпали. Статус
  `REPRODUCED`, research verdict `FALSIFIED_ON_TRAIN` — два независимых измерения.
- Контракт: `StrategyVariant`, `slicesAvailable` (движок отказывается «изобретать» VALIDATION для
  TRAIN-only версий), `ArchiveTrade.tags`; примитивы `emaSeries`, `structureBias`, `detectStructureBreak`.
- Расхождения D-V31-001…003 (перекрытие, раскрытый источником баг двойного учёта, Spot/futures).
- Универсальный офлайн-скрипт `scripts/strategy-archive/reproduce.mjs` (`--version --slice --variant`).
- Реестр: 2 импортировано + 11 запланировано = 13 строк источника (`STRATEGY_ARCHIVE_TOTAL_ROWS`).

## [0.8.10] — 2026-09-16

### Changed — Архив стратегий C1: V3.0 реально воспроизведена на закреплённом датасете
- Выполнен реальный прогон V3.0 (TRAIN и VALIDATION) в CRYPTORA на `svechnoy-suslik-binance-data @ c3c1dce`
  через `scripts/strategy-archive/reproduce-v30.mjs`. Все поля source-артефактов совпали (TRAIN n=1585,
  net +0.0994; VALID n=536, net +0.0600, PF 1.2484; funnel, exits, bySymbol, outlierDependence…). FIRST_MISMATCH = none.
- Статус воспроизводимости V3.0: `SOURCE_CHAIN_VERIFIED_NOT_RERUN` → **`REPRODUCED`**; research verdict без
  изменений (`VALIDATED_FOR_RESEARCH`). Evidence-артефакты `results/v30/cryptora-reproduction/*.json`
  (`DERIVED_BY_CRYPTORA`) хранятся отдельно от `SOURCE_REPORTED`.
- Контракт: `ReproductionEvidence` обязателен при `REPRODUCED`; добавлен статус `REPRODUCTION_BLOCKED`.
- Карточка V3.0 разделяет «Исследование» и «Воспроизводимость». Датасет по-прежнему не коммитится.

## [0.8.9] — 2026-09-16

### Added — Архив стратегий, шаг 1: фундамент + V3.0 (историческое исследование, без исполнения)
- `src/services/strategyArchive/` — контракты, адаптер свечей (мс/с/мкс, `closeTime`, семантика закрытых
  свечей), замороженные настройки прогона (без БД, sha256-пин), узкий R-движок воспроизведения
  (определение + свечи + допущения → сделки → R-метрики → отчёт с детерминированным digest),
  неизменяемый манифест происхождения (`provenance.json`: source `svechnoy-suslik-v2 @ 292050c`,
  dataset `svechnoy-suslik-binance-data @ c3c1dce`, sha256 исходников/артефактов/настроек).
- V3.0 HTF Liquidation Trap — чистая реализация, закреплённая за исходником, включая **дословное**
  поведение исследовательского прогона (перекрытие позиций разрешено; расхождение со спецификацией
  зафиксировано как `D-V30-001`, не исправляется — корректный вариант будет новой версией).
- Дословные копии артефактов источника (TRAIN/VALID метрики, паритет порта, settings/splits) с хешами.
- Тесты (48): детерминизм, адаптер свечей и единицы времени, выравнивание закрытых 4h-свечей,
  отсутствие доступа к будущим свечам, вход на баре N+1, SL раньше TP внутри бара, паритет перекрытий,
  комиссии 2/5 bps, целостность замороженных настроек и хешей артефактов, синтетический паритет
  с оригинальным модулем (фикстура 6000 баров сгенерирована оригинальным кодом).
- Минимальная read-only карточка V3.0 на `/strategies`: статус «VALIDATED SOURCE / NOT RERUN IN CRYPTORA»,
  коммиты источника/датасета, SOURCE_REPORTED TRAIN/VALID, обязательные оговорки, расхождения.
- Офлайн-скрипт оператора `scripts/strategy-archive/reproduce-v30.mjs` (не вызывается UI, ничего не
  скачивает) для реального прогона на локальном клоне закреплённого датасета.
- `docs/STRATEGY_ARCHIVE.md` — архитектура, происхождение, статус воспроизведения, расхождения, ограничения.

### Not changed
- `BacktestEngine` не тронут; второй универсальный бэктестер не создавался; датасет не коммитится;
  другие версии архива (V2.1…V2.8, V3.1) не перенесены; статус V3.0 **не** `REPRODUCED`.

## [0.8.8] — 2026-09-16

### Fixed — corrective: PRODUCTION = ТОЛЬКО LIVE (решение владельца по пункту A)
- **Удалён пользовательский путь включения DEMO через localStorage.** `MarketDataContext` больше не читает
  и не записывает `cryptora_data_mode`; `setDataMode` удалён из контракта контекста; режим фиксируется при
  старте. В production-бандле строка `cryptora_data_mode` отсутствует.
- **Новая политика `src/config/dataModePolicy.ts`:** production → всегда `live`, хранилище не читается;
  QA-датасет доступен только в dev/test (Vite `DEV` или `VITE_CRYPTORA_QA_FIXTURE=1`) **и** по явному ключу
  `cryptora_qa_fixture=1`. Фикстуры маркируются `QA` и не маскируются под LIVE.
- **Недоступный источник в production** → «Фактический источник недоступен» + «Повторить запрос»,
  без demo-fallback (кнопка включения демо в `DataSourceUnavailable` удалена ещё в 0.8.6 — теперь это
  закреплено тестом production runtime).
- **`scripts/screenshot-qa.mjs`:** режим по умолчанию `live` (production-oriented); `--mode=qa-fixture` —
  служебный прогон только против dev-сервера; `demo`/`both` отклоняются.
- **Документация:** `docs/DEPLOYMENT.md` — «Политика режима данных: PRODUCTION = ТОЛЬКО LIVE»; `STATUS.md` —
  исправлен факт: production на VPS перед v0.8.5 = **v0.8.4 (`6a01ce1`)**, а не v0.8.3.

### Tests
- Новый e2e: «PRODUCTION runtime: DEMO недоступен даже при недоступном LIVE-источнике и любом localStorage».
- Новый unit `tests/unit/dataModePolicy.test.ts` (4 теста).
- `npm test` — 177/177; `npm run test:e2e` — 55/55; typecheck 0; build `index-BGwGjif0.js` 793.88 kB.

## [0.8.7] — 2026-09-16

### Changed — системная русификация интерфейса (UX-цикл владельца, п. 2)
- **Сняты англо-дубли в скобках** во всех разделах: «Капитализация (Market Cap)» → «Капитализация»,
  «Обзор рынка (Overview)» → «Обзор рынка», «Винрейт (Win Rate)» → «Доля прибыльных»,
  «Инструмент (Asset)» → «Инструмент», «Широта рынка (Breadth)» → «Широта рынка» и т. д.
- **Заголовки страниц без латинского дубля:** `РЫНОЧНЫЕ КОТИРОВКИ`, `ФЬЮЧЕРСЫ И ДЕРИВАТИВЫ`,
  `КАРТА И ПОТОК ЛИКВИДАЦИЙ`, `КРИПТО-СКРИНЕР`, `РЫНОЧНЫЙ РАДАР: ДЕТЕКТОР АНОМАЛИЙ`, `ТЕПЛОВАЯ КАРТА РЫНКА`,
  `ЛАБОРАТОРИЯ СТРАТЕГИЙ`, `АНАЛИТИЧЕСКИЕ СЕТАПЫ И СИГНАЛЫ`, `КАЛЬКУЛЯТОРЫ И РИСК-ИНСТРУМЕНТЫ`,
  `МАТРИЦА КОРРЕЛЯЦИЙ И БЕТА`, `ОН-ЧЕЙН И МАКРО-МЕТРИКИ`, `ЭКОСИСТЕМЫ И СЕТИ L2`,
  `МАКРО-КАЛЕНДАРЬ И СОБЫТИЯ`, `ЖУРНАЛ СДЕЛОК И РЕФЛЕКСИИ`, `ПОРТФЕЛЬНЫЙ РИСК И СТРЕСС-ТЕСТИРОВАНИЕ`.
- **Карта ликвидаций:** дисклеймер «КРИТИЧЕСКИЙ ПРИНЦИП: ФАКТИЧЕСКАЯ ЛИКВИДАЦИЯ ≠ РАСЧЁТНЫЙ УРОВЕНЬ»,
  секции «Тепловая карта плотности ликвидаций: цена × время», «Расчётные уровни ликвидаций по плечам»,
  «Журнал фактических событий ликвидаций», «Хронология ликвидаций по 3-часовым барам за 24ч», легенда
  «Ликвидации лонгов / шортов», карточки «Ликвидировано лонгов (24ч) / шортов (24ч)». Бейдж модели
  унифицирован — `MODEL / ESTIMATED`.
- **Лонг / шорт по-русски** во всех агрегатах, таблицах и бейджах (Обзор, Ликвидации, пульс актива,
  журнал, стратегии, сигналы, скринер, календарь). Машинные коды `LONG` / `SHORT` остаются в данных.
- **Навигация и подвал:** «Рыночный радар», «Лаборатория стратегий (превью)», «Обзор рынка»,
  «Таблица активов»; шапка — «Открыть избранное», `WS ОНЛАЙН / WS ОЖИДАНИЕ`, `LIVE-ДАННЫЕ РЫНКА`;
  тикер — `LIVE-ТИКЕР / QA-ТИКЕР`; стакан — «СТАКАН ЗАЯВОК (L2)», «СРЕДНЯЯ ЦЕНА», «СИНТЕТИЧЕСКАЯ ГЛУБИНА».
- **Фильтры и пресеты:** типы аномалий радара («Всплеск объёма», «Каскад ликвидаций»…), уровни
  важности («Только высокая / средняя / информационная»), секторы («L1-сети», «ИИ и данные», «Мемкоины»),
  пресеты скринера («Лидеры роста», «Шорт-сквиз», «Крупный объём», «Сектор ИИ»), стратегии
  («Пробой максимума 20-барного канала»), поля («Стоп-лосс», «Тейк-профит»).
- **Бейджи режима данных** приведены к единому виду: `LIVE СПОТ · BINANCE / KUCOIN`,
  `LIVE-ДЕРИВАТИВЫ · BINANCE FUTURES`, `LIVE-ПОТОК · BINANCE FUTURES`, `LIVE-ПЛИТКИ`, `QA-ДАТАСЕТ`.

### Added
- `src/utils/labels.ts` — единый словарь русских подписей для машинных enum
  (`radarEventTypeLabel`, `radarSeverityLabel`, `sideLabel`, `impactLabel`); прямой вывод
  `event.type` / `event.severity` / `side` в JSX заменён вызовами словаря.
- `docs/DESIGN_SYSTEM.md`, раздел 11 «Языковая политика интерфейса» — где латиница допустима
  (аббревиатуры метрик, провенанс `LIVE` / `MODEL / ESTIMATED`, биржи, тикеры, имена собственные).

### Tests
- E2E-контракты переведены на новые подписи: **54/54**; `npm test` — 173/173; `npm run typecheck` — 0 ошибок;
  `npm run build` — `dist/assets/index-BMqh0xKE.js` 793.66 kB (gzip 214.59).
- Версия `0.8.7` синхронизирована в `package.json`, шапке, подвале, health-эндпоинте
  `server/productionServer.js` (ранее там оставалось `0.8.1`) и e2e-инварианте версии.

## [0.8.6] — 2026-09-16

### Removed — Demo UX выведен из production-интерфейса
- **Переключатель режима данных удалён полностью.** Компонент `DemoModal` (и его контекстные методы
  `isDemoModalOpen / openDemoModal / closeDemoModal`) больше не существуют: терминал всегда работает с
  фактическим источником, а внутренний датасет включается только фикстурой окружения.
- Чип источника в шапке и в мобильном меню стал **индикацией** (`role="status"`, `data-qa="data-source-status"`
  / `data-source-status-compact`), а не кнопкой: показывает `LIVE SPOT` + статус WebSocket либо `QA-ДАТАСЕТ`.
  Пункт «Header LIVE / WS оставить как connection status» выполнен.
- Из подвала убрана кнопка «Подробнее о Demo-режиме»; дисклеймер формулируется один раз и не обещает
  демонстрационных данных.
- Карточка «РЕЖИМ СИСТЕМЫ» на Обзоре (кликабельная, открывала демо-модалку) заменена на индикатор
  «РЕЖИМ ДАННЫХ» с источником и состоянием WebSocket; кнопка «Ограничения этапа» удалена.
- **Честное состояние вместо промо:** `DataSourceUnavailable` больше не предлагает включить демонстрационный
  режим — доступно только действие «Повторить запрос».

### Changed — честная терминология для внутреннего датасета
- Пользовательские подписи QA-датасета переведены с «демонстрационный» на «QA-»: `QA TICKER`, `QA DATASET`,
  `QA-СВЕЧИ`, `QA-СЕТКА`, `QA-СРЕЗ`, `QA-ДАТАСЕТ`, «Детерминированный QA-датасет», «Журнал событий
  ликвидаций QA-датасета», «Пары на ведущих биржах (QA-датасет)», «Слой данных: QA-датасет».
- Текст инварианта уточнён: «значения вместо фактических не подставляются» и «значения из другого датасета
  вместо рыночных не подставляются» — без специального обещания конкретного датасета.

### Tests
- E2E обновлены под новый контракт (**54/54**): добавлен тест «переключателя режима данных в интерфейсе нет»
  (чип источника — не кнопка, промо-подписи отсутствуют), тест статуса источника/WebSocket вместо теста
  переключения режима, переименованы ожидания QA-подписей.
- `npm test` — 173/173; `npm run typecheck` — 0 ошибок; `npm run build` —
  `dist/assets/index-fym-X7IT.js` 791.47 kB (gzip 214.33).
- Скриншот-QA `screenshots/v086/`: 9 маршрутов × 7 viewports × DEMO+LIVE = **126 проверок, 0 нарушений**;
  ключевые кадры просмотрены визуально (в т.ч. `/coin/ETH` 1366 и 1280 — график рендерится, см. примечание
  о захвате canvas в STATUS).

## [0.8.5] — 2026-09-16

### Changed — LIVE-first production UX (убрано глобальное демонстрирование)
- **Режим по умолчанию переведён на фактический источник.** Терминал запускается в `LIVE`; демонстрационный
  датасет включается только явным выбором пользователя (ключ `cryptora_data_mode`, значение `demo`).
  Ранее по умолчанию поднимался демо-провайдер, из-за чего интерфейс одновременно показывал «LIVE SPOT»
  в шапке и демо-котировки в других местах.
- **Полоса котировок (`MarketTicker`) переведена на активный провайдер.** Метка источника соответствует
  режиму (`LIVE TICKER` / `DEMO TICKER`), при недоступности источника выводится честное сообщение
  `data-qa="ticker-source-state"` — демо-числа вместо фактических не подставляются.
- **Избранное (`WatchlistDrawer`)** больше не читает демо-датасет напрямую: список и цены приходят из
  активного провайдера, при сбое источника — честное состояние (`data-qa="watchlist-unavailable"`).
- **Тепловая карта рынка (`HeatmapGrid`)** берёт деривативные метрики (OI, фандинг) из провайдера.
  Устранены производные «на глаз» значения: `asset.marketCap * 0.05`, `asset.change24h` в роли OI и
  фандинг по умолчанию `0.01%` — вместо них честная плитка «НЕТ ДАННЫХ» (`источник недоступен`).
- **Поиск в шапке и селектор инструментов в алертах** используют статический каталог `CANONICAL_ASSETS`
  (символы/названия — это метаданные, а не рыночные данные). Метрика 24h в подсказках показывается только
  если актив реально пришёл от провайдера.
- **Подвал** маркирует слой данных по режиму (`LIVE (Binance / KuCoin)` либо `DEMO-датасет`) вместо
  постоянной строки «Active Market Data Gateway», время — живые UTC-часы вместо зафиксированного
  `12:00:00`, вторая часть дисклеймера также зависит от режима.
- **Режимные подписи страниц.** Бейджи и подписи `/market`, `/screener` и верхняя полоса Обзора больше
  не заявляют демо-данные в LIVE-режиме: «30 ДЕМО-АКТИВОВ» / «ДЕМО-ДАТАСЕТ» / «КОМАНДНЫЙ ЦЕНТР:
  ДЕМОНСТРАЦИОННЫЕ ДАННЫЕ» показываются только в демо-режиме.
- **Обзор больше не рисует фиксированные числа BTC.** Цена, 24h-дельта и технические значения
  (SMA20 / SMA50 / RSI-14) карточки BTC берутся из активного провайдера и расчётного движка по
  фактическим свечам; подставляемые ранее `$64,850.25`, `+3.18%`, `$63,877`, `$62,386`, `68.4` и строка
  «24h дельта: +$64.8B» удалены. При отсутствии данных выводятся «НЕТ ДАННЫХ» / «—».
- **Модельные метрики помечены явно.** 24h-дельты капитализации и объёма, а также индекс жадности в
  LIVE-режиме несут маркер `EST.` / `MODEL / ESTIMATED` с подсказкой о том, что источник это значение
  не отдаёт. Превью-карточка сетапа: «LONG SETUP DEMO» → «ПРИМЕР СЕТАПА (НЕ СИГНАЛ)».
- **Карточка актива.** Текст «не зарегистрирован в демонстрационной базе данных» заменён на
  «отсутствует в реестре инструментов терминала».

### Added — честная деградация страниц
- **Новый компонент `DataSourceUnavailable`** — единое честное состояние «фактический источник недоступен»
  с пояснением и кнопкой **явного** включения демонстрационного режима.
- Состояние подключено к страницам, работающим с рыночным источником: Обзор, Рынок, Фьючерсы, Скринер,
  Радар, Тепловая карта, Стратегии (бэктест-свечи), Ликвидации и карточка актива. До этого ни одна
  страница не обрабатывала отказ источника: при сбое интерфейс оставался в вечной загрузке либо пустым.

### Fixed
- Необработанные отказы провайдера (`getAssets`, `getFuturesList`, `getLiquidations`, `getRadarEvents`,
  `getScreenerResults`, `getCandles`, `getAssetDetail`, `getMarketOverview`) больше не приводят к
  «зависшему» экрану загрузки — состояние честно сообщается пользователю.
- **Горизонтальный overflow `/market` на 768px (+178px):** шапка страницы включала row-layout на `md:`
  и не помещалась вместе с поиском и категориями. Брейкпоинт перенесён на `lg:`, кластеры получили
  `min-w-0`, ряды чипов (категории Market, пресеты Screener) переведены на перенос строки вместо
  обрезаемого скроллера — клиппинга нет на 390 / 768 / 1024 / 1280 / 1366 / 1440 / 1920.

### Tests
- E2E: +3 контрактных теста LIVE-first (режим по умолчанию — фактический; недоступный источник даёт честное
  состояние без демо-котировок; демо-режим остаётся доступен явным выбором). Прогон **53/53**.
- Тестовое окружение E2E детерминировано: `resetBrowserStorage()` явно выставляет демо-режим.
- Скриншот-QA расширен до 9 маршрутов (`/`, `/market`, `/futures`, `/liquidations`, `/heatmaps`,
  `/radar`, `/screener`, `/strategies`, `/coin/ETH`) × 7 viewports × DEMO+LIVE = **126 проверок,
  0 нарушений** (`screenshots/v085/qa-report-v085.json`), плюс визуальный просмотр ключевых кадров.

## [0.8.4] — 2026-09-16

### Added — тепловая карта плотности ликвидаций (2D: цена × время)
- **Новая секция «Тепловая карта плотности ликвидаций (Price × Time)»** на странице `/liquidations`
  (`src/components/market/LiquidationHeatmap.tsx`): двумерная карта плотности зон принудительного
  закрытия — цена по вертикали, время по горизонтали (до 64 временных колонок × 28 ценовых уровней).
  Карта постоянно маркируется `MODEL / ESTIMATED` и не смешивается с фактическим журналом событий.
- **Новый детерминированный построитель модели `LiquidationHeatmapModelBuilder`**
  (`src/services/liquidations/LiquidationHeatmap.ts`): уровни считаются как `1 / плечо` от цены закрытия
  каждой свечи для тиров 10x / 25x / 50x / 100x при равномерном распределении открытого интереса по
  тирам; вклад свечи взвешивается её объёмом; интенсивность нормируется в диапазон 0…1. Случайных
  значений нет — повторный вызов на тех же входах даёт побитово тот же результат.
- **Явный провенанс входных данных:** плашка `ВХОД: DEMO-СВЕЧИ` или `ВХОД: ФАКТИЧЕСКИЕ СВЕЧИ`
  определяется по провенансу свечей; при отсутствии свечей или метки цены карта честно не строится
  («карта не построена»), а не подставляется оценочными зонами.
- **Юнит-тесты построителя** (+9): детерминизм, нормировка 0…1, покрытие диапазоном всех плечевых
  уровней (без ложных краевых пиков), различимость полос 10x/25x/50x/100x, честный отказ при
  недостаточных входах, корректные границы временной и ценовой шкал.

### Changed
- **Нижний блок переименован в «Расчетные уровни плечевых тиров (Estimated Liquidation Levels)»**
  и маркирован `MODEL / ESTIMATED` — устранено дублирование названия «тепловая карта» и снята
  двусмысленность «ESTIMATED SIMULATION» с фактическим потоком.
- **Диапазон карты расширен до всех уровней модели:** уровни тиров больше не «слипаются» в крайние
  строки, краевые полосы перестали выглядеть как ложные пики плотности.
- **Временная ось сведена к ≤6 подписям** с привязкой крайних к краям карточки.

### Fixed
- **Горизонтальный overflow на 390px** (`/liquidations`, +4px): крайняя подпись времени выходила за
  пределы карточки — выравнивание подписей теперь зависит от позиции тика (левый/центральный/правый).

## [0.8.3] — 2026-09-16

### Added — аналитическая рабочая область Coin Detail (desktop layout)
- **Главная область под asset header превращена из full-width графика в рабочую область**
  `grid-cols-1 xl:grid-cols-[72fr_28fr]`: от 1280px график занимает ~72% ширины, справа — компактный
  снимок Derivatives / Liquidation Pulse (~28%). Ниже 1280px снимок складывается под графиком
  (одна колонка), горизонтального overflow и клиппинга нет ни на одном viewport.
- **Полезная высота графика увеличена до 460px** на desktop (440–470px) и 340px на мобильных —
  график остаётся визуально доминирующим элементом страницы.
- **Новый компонент `AssetPulsePanel`** (`src/components/market/AssetPulsePanel.tsx`) — снимок только
  по текущему активу: ликвидации Long/Short 24ч с долями и ratio-полосой, наиболее значимые события,
  открытый интерес + Δ24ч, фандинг (8ч), базис, компактный производный индикатор перекоса потока.
  Снимок не дублирует нижние детальные секции и ведёт в `/liquidations` и `/futures`.
- **Новая доменная логика `LiquidationPulse`** (`src/services/liquidations/LiquidationPulse.ts`):
  детерминированная сборка среза с приоритетом факта (FACTUAL → DEMO → ESTIMATED → UNAVAILABLE)
  и композитный индикатор перекоса на фиксированных весах (ликвидации 40, фандинг 25, OI 15, цена 20).
  Никаких случайных значений; провенанс входных метрик маркируется явно.
- **Нижние карточки очищены от дублей и уплотнены:** карточка деривативов переименована в
  «Деривативы: детали контракта» и показывает метрики, которых нет в снимке (Mark/Index, спред метки,
  прогноз фандинга, APR, OI Δ1ч, суточный объем) со ссылкой на `/futures`; padding трёх карточек
  уменьшен без снижения кегля.

### Fixed
- **`CandleChart`: плашка источника данных больше не хардкодит «DEMO СВЕЧИ»** — подпись определяется
  провенансом ряда (`LIVE · BINANCE` для фактических свечей, `DEMO СВЕЧИ` для синтетических).
- **`CandleChart`: ширина графика синхронизируется с контейнером** через `ResizeObserver` и немедленную
  подгонку при монтировании — canvas больше не остаётся шире карточки после смены раскладки 72/28.

### Verified
- `tsc --noEmit`: 0 ошибок; `vitest`: 164 теста (включая 6 новых тестов `LiquidationPulse` и инварианты
  честности данных); E2E: 49 тестов (добавлен контракт рабочей области); screenshot QA: `/coin/ETH`
  в DEMO и LIVE на 390/768/1024/1280/1366/1440/1920 — 0 нарушений overflow/clipping.

## [0.8.2] — 2026-09-16

### Fixed — честность потока ликвидаций (нарушение инвариантов RULES §1, §3; AGENTS §3.1)
- **Устранены выдуманные агрегаты в `LiquidationPipeline`.** Ранее `getLiquidationSnapshot()` подставлял синтетические объемы через fallback-константы (Long $62M, Short $28M, итог $90M, «крупнейшее событие» $1.25M, разбивка бирж 52/28/20%, таймлайн из 6 фиксированных баров), а предзаполненные события хранились с флагом `isDemo: false` — то есть выдавались за фактический биржевой поток. Теперь агрегаты считаются исключительно из фактически принятых событий; при их отсутствии возвращаются нули, `largestEvent: null` и пустые разбивки.
- **Реальный WebSocket-поток фактических ликвидаций.** Добавлен `BinanceFuturesLiquidationStream` (`wss://fstream.binance.com/ws/!forceOrder@arr`), подключенный к жизненному циклу `RealtimeFeedManager`: в LIVE-режиме поток поднимается, в DEMO — останавливается. Ранее метод `processBinanceForceOrder()` не вызывался ниоткуда — «live»-поток ликвидаций фактически не существовал.
- **Убрано `Math.random()` из идентификаторов событий** (RULES §3): id события детерминированно выводится из полей биржевого payload.
- **Честная деградация вместо заглушек.** Добавлен статус данных `LiquidationDataStatus`: `LIVE_STREAM` / `AWAITING_STREAM` / `UNAVAILABLE` / `DEMO`. Страница ликвидаций и блок на Обзоре больше не показывают пульсирующий бейдж «LIVE» и суммы при отсутствии фактического потока — вместо этого отображается причина отсутствия данных.
- **Скользящее 24-часовое окно** для агрегатов и 3-часовых баров хронологии; устаревшие события вычищаются из хранения.
- **Провенанс входных метрик расчетной модели.** Кластеры ликвидаций строятся от метки цены и открытого интереса, полученных от провайдера (ранее — от зашитых `65000` и `$15B`), с явной маркировкой `MODEL / ESTIMATED` и указанием, являются ли входные метрики фактическими или демонстрационными.
- **Пустые состояния** для хронологии, разбивок по биржам/активам и журнала событий: интерфейс объясняет отсутствие данных, а не подставляет плейсхолдеры.

### Changed
- Версия терминала 0.8.2 (`package.json`, `package-lock.json`, бейджи шапки и футера).
- Unit-тесты ликвидаций: 5 → 18 (инварианты честности данных, парсинг потока, отсутствие фабрикации, окно 24ч, детерминированные id).

### Verified
- `tsc --noEmit`: 0 ошибок; `vitest`: 158 тестов; E2E: 48 тестов; screenshot QA `/liquidations` × 5 viewport × 2 режима — 0 нарушений overflow/clipping/overlap.

## [0.8.1] — 2026-09-16

### Исправление UI-регресса шапки (real-device fix) + полировка Coin Detail

**Контекст:** после фактической проверки production на реальном desktop viewport ~1280px
обнаружено, что правая часть шапки не помещалась: после контролов `LIVE SPOT / WS`
элементы (поиск, избранное, алерты) уходили за пределы вьюпорта и клипались.
Автотест этого не поймал, потому что проверял только наличие ссылок и CSS-класс
`whitespace-nowrap` в JSDOM (без реального расчёта layout).

- **Архитектурный рефакторинг шапки (`src/components/layout/Header.tsx`):**
  - **Единая модель навигации** вынесена в `src/components/layout/navigation.ts`
    (`PRIMARY_NAV_ITEMS`, `ANALYTICS_NAV_ITEMS`, `TOOLS_NAV_ITEMS`, `ALL_NAV_PATHS`,
    `PRIMARY_NAV_CAPACITY`) — единый источник правды для шапки, мобильного drawer
    и тестов. Бюджет ёмкости прямой навигации: **максимум 6 пунктов**.
  - **Стеккинг вместо сжатия:** в компактном desktop-диапазоне `1024–1279px`
    навигация переходит в **отдельную строку** (`order-3 w-full border-t`), а не
    сжимает текст; от `1280px` возвращается в первую строку (`xl:order-2 xl:w-auto xl:flex-1 xl:border-t-0`).
  - **Каскад сжатия вторичных service controls** (в порядке приоритета):
    слоган и бейдж версии → чип тарифа → inline-поиск (от `1440px`, ниже — компактная
    иконка с раскрывающейся панелью) → текстовая плашка режима данных
    (`LIVE SPOT`/`ДЕМО-ДАННЫЕ` от `1440px`, `LIVE`/`ДЕМО` от `640px`, иконка с индикатором ниже).
  - **Читаемый кегль primary navigation зафиксирован:** 13px, 14px от `1536px`.
    Микротекст 9–10px в шапке полностью устранён (минимальный порог — 11px).
  - Отсутствие horizontal overflow и наложений подтверждено замерами на 320, 344, 360,
    390, 414, 480, 540, 640, 700, 768, 834, 900, 960, 1024, 1080, 1120, 1152, 1200,
    1280, 1300, 1366, 1400, 1439, 1440, 1600, 1700, 1800, 1919, 1920, 2200 и 2560px.
  - Поиск: добавлена компактная панель поиска под шапкой (`< 1440px`) с автокомплитом
    и сообщением «Совпадений не найдено»; результаты двух полей поиска больше не
    конфликтуют (взаимоисключающее отображение).
  - Мобильный drawer получил статусную строку: режим данных, статус `WS ONLINE/IDLE`, тариф.
- **Дизайн-система (`tailwind.config.js`):**
  - Введены явные кастомные точки перехода с документированным порядком:
    `lg 1024`, `navmd 1152`, `xl 1280`, `navxl 1440`, `2xl 1536`, `nav2xl 1700`.
- **Исправление графика (важный функциональный баг, найден визуальной проверкой):**
  - `CandleChart.tsx` не задавал локаль, и `lightweight-charts` вызывал
    `Date.toLocaleString(navigator.language)`. В окружениях с невалидным системным
    тегом (например `en-US@posix`) вызов бросал `RangeError` при форматировании
    каждой метки времени, из-за чего **свечи и объёмы не рендерились вовсе**
    (оставался только водяной знак TradingView). Добавлена явная `localization.locale: 'en-US'`.
- **Полировка Coin Detail (`CoinDetailPage.tsx`, `OrderBookL2.tsx`, `Badge.tsx`, `CandleChart.tsx`):**
  - Устранён микротекст 9–10px: нижний порог — 11px (`Badge xs`, метаданные стакана),
    значения индикаторов и заголовки таблиц — 12px, заголовки карточек — 13px.
  - Уменьшены избыточные пустые вертикальные области перед disclaimer/footer:
    отступ страницы `space-y-4 → space-y-3.5`, футер `mt-14 py-8 → mt-6 py-6`,
    внутренние интервалы футера `space-y-6 → space-y-5`.
  - Визуальный приоритет графика сохранён (высота свечей 380px при полной ширине).
  - Количество bordered-карточек не увеличено; premium dark стилистика сохранена.
- **Инструменты QA (новое):**
  - `scripts/screenshot-qa.mjs` — браузерный прогон Chromium (Playwright) с фактическими
    скриншотами и измерениями: `document.scrollWidth` vs viewport, элементы шапки за
    пределами вьюпорта, клиппинг контента в контейнерах, **пересечения кластеров шапки**
    (именно этот дефект пропускали прежние assertions), кегль навигации, свободное место
    в строках, поиск пустых вертикальных зон перед футером. Поддерживает `--mode=demo|live`,
    `--viewports`, `--routes`, `--base`, а также подстановку локальных WOFF2-сабсетов
    Inter / JetBrains Mono для метрик реального продакшена.
  - Прогон подтверждён на dev-сервере и на собранном production-бандле
    (`vite preview`, порт 4173): **28/28 комбинаций без единого layout-нарушения**.
- **Регрессионные тесты:**
  - `tests/unit/navigation.test.ts` (6 тестов): бюджет ёмкости, уникальность путей,
    покрытие всех статических роутов, инвариант отсутствия торгового исполнения.
  - `e2e/uiRegression.spec.tsx` расширен до 9 тестов: бюджет ёмкости навигации,
    минимальный кегль текста шапки (11px) **в обоих режимах данных** — регресс
    проявлялся именно в `LIVE` (плашка `LIVE SPOT` + `WS` рендерится только в нём),
    stacking-режим `1024–1279px`, каскад сжатия сервисных контролов и компактной панели поиска.
  - `e2e/responsive.spec.tsx` расширен с 5 до 7 контрольных брейкпоинтов
    (добавлены 1280 и 1366 — реальные проблемные ширины) и проверкой полного состава
    прямой навигации без переносов.
  - **Герметичность E2E:** в JSDOM-шим добавлены заглушки `fetch` и `WebSocket`
    (Node.js предоставляет их глобально) — тесты больше не выполняют реальных сетевых
    вызовов к биржам, а Live-слой по-прежнему честно сообщает об ошибке источника данных.
    Добавлен экспортируемый хук `resetBrowserStorage()` с регистрацией в каждом spec-файле:
    ES-модуль кэшируется на процесс воркера, поэтому хук внутри `setup-dom.ts` применился бы
    только к первому spec-файлу, и режим `LIVE` протекал бы в последующие тесты (флейки).
  - Стабильность подтверждена тремя последовательными полными прогонами: 48/48.
- **Версия:** `0.8.0 → 0.8.1` (`package.json`, health-эндпоинт production-сервера,
  футер, бейдж версии в шапке, документация).
- **Итоги гейтов:** typecheck — 0 ошибок; unit — 145 тестов (24 файла);
  build — чистая production-сборка; E2E — 48 тестов (3 прогона подряд, стабильно);
  screenshot QA — 0 layout-нарушений на 28 комбинациях.
- **Архитектурные инварианты не затронуты:** market-data architecture,
  deployment architecture (Nginx `:80 → /var/www/cryptora`, статика) и бизнес-функциональность
  без изменений. Production server на порту 3000 не запускался; VPS не обновлялся.

## [0.8.0] — 2026-09-16

### UI/UX Редизайн: Премиальный темный терминал рыночной аналитики (Premium Dark Terminal)
- **Архитектурный реинжиниринг Навигации и Хедера (`Header.tsx`):**
  - Полностью исключены переносы строк, наложения и переполнения на разрешениях 1024px, 1280px, 1440px и мобильных устройствах.
  - Первичные разделы вынесены в быстрый доступ (`Обзор`, `Рынок`, `Фьючерсы`, `Ликвидации`, `Скринер`, `Радар`).
  - Вторичные аналитические и расчетные разделы сгруппированы в выпадающие dropdown-меню (`Аналитика ▾`, `Инструменты ▾`) с полной клавиатурной доступностью (A11y, Escape-to-close, клик вне области) и индикатором активности родительского раздела.
  - Жестко зафиксировано правило `white-space: nowrap` для всех навигационных элементов.
  - Обновлен брендовый блок: геометрический технологичный глиф, трекинг логотипа, индикатор тарифа и скрываемый на экранах < 1440px слоган.
  - Мобильное меню адаптировано в чистый полноэкранный drawer с четким делением на разделы («Основные разделы», «Аналитика», «Инструменты»).
- **Комплексная дизайн-система и палитра токенов (`tailwind.config.js`, `src/index.css`, `docs/DESIGN_SYSTEM.md`):**
  - Введены многоуровневые поверхности: Obsidian Root (`#06080e`), Surface 1 (`#0a0f1d`), Surface 2 (`#0f172a`), Surface 3 (`#141e36`), Inset (`#070b14`).
  - Гармонизированная акцентная палитра: технологический циан (`#22d3ee`), электрический синий (`#3b82f6`), аналитический фиолетовый (`#8b5cf6`).
  - Финансовая цветовая семантика: Emerald (`#10b981`), Rose (`#f43f5e`), Amber (`#f59e0b`), Sky (`#38bdf8`).
  - Мягкие объемные градиенты, управляемые тени `shadow-panel` / `shadow-panel-elevated` и мягкое фоновое свечение.
  - Поддержка доступности: отключение анимаций и эффектов при системной настройке `@media (prefers-reduced-motion: reduce)`.
- **Визуальная модернизация ключевых экранов терминала:**
  - `OverviewPage.tsx`: иерархический командный центр с интерактивным графиком в центре внимания, аналитическими панелями и обновленными метриками.
  - `MarketTicker.tsx`: компактная полоса котировок с мини-спарклайнами, фоновыми карточками и четкими разделителями.
  - `HeatmapGrid.tsx`: переработанная тепловая карта секторов с селектором метрик, градиентной шкалой-легендой и визуальным выделением ячеек.
  - `FuturesPage.tsx`, `LiquidationsPage.tsx`, `ScreenerPage.tsx`, `RadarPage.tsx`, `ToolsPage.tsx`, `PortfolioRiskPage.tsx`, `MarketPage.tsx`: модернизированы карточки, формы фильтрации, переключатели, табличные числа (`tabular-nums`) и touch-таргеты (min-h 32–36px).
- **Сквозное автоматизированное регрессионное тестирование (`e2e/uiRegression.spec.tsx`):**
  - Добавлены Playwright-тесты для проверки отсутствия переносов текста в шапке при ширине 1280px.
  - Проверка открытия/закрытия выпадающих меню по клику и клавише Escape.
  - Проверка мобильного навигационного меню и корректности отображения на 6 ключевых брейкпоинтах (390, 768, 1024, 1280, 1440, 1920).
  - Успешный прогон 139 юнит-тестов и 41 Playwright E2E тестов.

## [0.7.1] — 2026-09-16

### Развертывание на VPS и Production Infrastructure
- **Production Server & Gateway (`server/productionServer.js`):**
  - Автономный легковесный Node.js production-сервер без внешних runtime-зависимостей.
  - Высокоскоростная раздача статических файлов (`dist/`) с HTTP-кэшированием (1 год immutable для хэшированных ассетов, `no-cache` для `index.html`).
  - Гарантированный SPA fallback для поддержки прямого перехода по URL React Router (`try_files ... index.html`).
  - Встроенный минимальный шлюз рыночных данных (`/api/proxy/binance`, `/api/proxy/kucoin`) с 10-секундным in-memory кэшированием и эндпоинтом проверки жизнеспособности `/api/health`.
  - Защитные заголовки: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `Referrer-Policy`, строгая CSP.
- **Nginx Configuration (`nginx/cryptora.conf`):**
  - Шаблон виртуального хоста Nginx для проксирования на порт 3000, rate limiting (30r/s), gzip сжатия и HTTPS Let's Encrypt (Certbot).
- **Systemd Service Unit (`systemd/cryptora.service`):**
  - Юнит автозапуска сервиса с ограничением прав (non-root `user`), изоляцией файловой системы и политикой `Restart=always`.
- **Операционные CLI-скрипты (`scripts/`):**
  - Скрипты `./scripts/deploy.sh`, `./scripts/status.sh`, `./scripts/restart.sh`, `./scripts/logs.sh`, `./scripts/update.sh` для автоматизации развертывания и мониторинга.
  - Постоянный патч `scripts/patch-playwright-jsx.cjs` в `package.json:postinstall` для стабильности E2E тестов.
- **Документация:**
  - Создано подробное руководство по развертыванию `docs/DEPLOYMENT.md` и обновлены `README.md`, `.env.example`, `.gitignore`.

## [0.7.0] — 2026-09-16

### Этап 17: Аналитика портфельного риска, Value at Risk и стресс-тестирование
- **Математический движок портфельного риска (`PortfolioRiskEngine`):**
  - Расчет параметрического суточного риска (1-Day Value at Risk / VaR на уровнях доверия 95% и 99%).
  - Расчет совокупной чувствительности портфеля (Beta) к Bitcoin: $\beta_{\text{portfolio}} = \sum w_i \beta_i$.
  - Расчет индекса концентрации Херфиндаля-Хиршмана (HHI) с определением качества диверсификации.
  - Моделирование 4 экстремальных стресс-сценариев: FTX/Luna Liquidity Cascade, March 2020 Liquidity Crunch, Fed Hawkish Tightening, Altseason Expansion с расчетом остатка капитала.
- **Интерфейс риск-терминала (`PortfolioRiskPage.tsx`):**
  - Интерактивный редактор весов активов с быстрыми пресетами (Консервативный Core 60% BTC, Barbell, High-Beta Altseason).
  - Сводная декомпозиция весов, чувствительности и расчетная таблица стресс-тестов.
  - Строгое юридическое предупреждение о non-custodial аналитическом характере инструмента.
- **Тестирование и верификация:**
  - 139 юнит-тестов успешно пройдены в 23 тестовых люксах Vitest.
  - 37 сквозных Playwright E2E тестов пройдены со 100% результатом.

## [0.6.0] — 2026-09-16

### Этапы 6, 8, 10, 12, 14, 15, 16: Ликвидации, Скринер, Алерты, Бэктестинг, Аудит сетапов, AI-аналитик и Монетизация
- **Конвейер ликвидаций (`LiquidationPipeline`):**
  - Прием и парсинг WebSocket сообщений принудительных ликвидаций (`forceOrder`).
  - Расчет скользящих агрегатов за 24ч (Long/Short ratio, распределение по биржам и активам).
  - Математическая модель расчета кластеров риска ликвидаций ($10\times, 25\times, 50\times, 100\times$) с обязательным дисклеймером `Actual != Estimated`.
  - Интеграция с `LiveMarketDataProvider` и `LiquidationsPage.tsx`.
- **Мультифакторный скринер (`ScreenerEngine`):**
  - Композитная фильтрация по категории, изменению цены за 24ч, спотовому объему, капитализации, RSI(14), ставке фандинга и динамике открытого интереса.
  - Встроенные системные пресеты (`oversold_rsi`, `volume_leaders`, `short_squeeze`, `oi_breakout`, `ai_sector`) и персистентное сохранение пользовательских фильтров.
- **Движок алертов (`AlertService`):**
  - Поддержка триггеров: `PRICE_ABOVE`, `PRICE_BELOW`, `CHANGE_24H_ABOVE`, `CHANGE_24H_BELOW`, `FUNDING_EXTREME`.
  - Подавление дребезга (cooldown suppression), каналы уведомлений In-App, Telegram, Webhook.
- **Движок бэктестинга (`BacktestEngine`):**
  - Побарная симуляция без заглядывания вперед (zero look-ahead bias).
  - Учет комиссий тейкера и проскальзывания при входах и выходах по Stop Loss / Take Profit.
  - Расчет статистических метрик: Win Rate, Profit Factor, Max Drawdown %, Net PnL, Sharpe Ratio.
- **Аудит аналитических сетапов (`SignalsAuditLedger`):**
  - Формализованные сетапы с обязательными факторами подтверждения/инвалидации и уровнями риска.
  - Неизменяемый хешированный журнал аудита (SHA-256) с защитой от изменения задним числом.
  - Прозрачный расчет результативности всей выборки без искажений.
- **AI-объясняющий слой (`AiExplanationEngine`):**
  - Генерация структурированных обзоров исключительно на основе детерминированных фактов движка.
  - Фиксированный дисклеймер аналитического терминала (`CRYPTORA DOES NOT EXECUTE TRADES`).
- **Монетизация и гейтинг (`PlanManager`):**
  - Разграничение возможностей тарифов `FREE`, `PRO` и `ENTERPRISE` (Institutional Terminal).
- **Тестирование и верификация:**
  - 121 юнит-тест в 20 файлах пройден успешно.
  - 31 Playwright E2E тест пройден на всех типах устройств.
  - `tsc --noEmit` и `tsc -b && vite build` чистые (0 ошибок).

## [0.5.0] — 2026-09-15

### Этап 5: Деривативный конвейер (Futures Open Interest, Funding Rate & Basis)
- **Адаптер деривативов Binance Futures (`BinanceFuturesAdapter`):**
  - Подключение к публичному шлюзу `https://fapi.binance.com` без ключей и авторизации.
  - Опрос `premiumIndex`, `openInterest`, `ticker/24hr` с runtime-валидацией через Zod (`derivativesSchemas.ts`).
  - Обработка таймаутов, сетевых отказов и лимитов частоты (HTTP 429/418) с типизированными исключениями `AdapterError`.
- **Расчетный движок деривативов (`DerivativesEngine`):**
  - Расчет годовой ставки финансирования (Annualized Funding Rate APR = $FR_{8h} \times 3 \times 365$).
  - Расчет базиса перп/спот и классификация рыночного режима (Contango vs Backwardation).
  - Конвертация открытого интереса в долларовый эквивалент (OI USD = $Contracts \times MarkPrice$).
  - Формирование агрегированного макро-обзора рынка деривативов (`AggregatedDerivativesOverview`).
- **Интеграция с `LiveMarketDataProvider` и UI:**
  - Реализован опрос и нормализация бессрочных фьючерсов в `getFuturesList()` с фиксацией происхождения данных (`isDemo: false`, `provenance: { exchange: 'binance', market: 'futures' }`).
  - `FuturesPage`: режим `LIVE DERIVATIVES (BINANCE FUTURES)`, отображение макро-показателей (Суммарный OI, объем, средний фандинг, режим рынка), фильтрация шорт-сквизов.
- **Тестирование:**
  - Добавлено 9 новых юнит-тестов (всего 96 тестов в 13 файлах) для парсинга DTO, расчета APR, базиса, открытого интереса и агрегатов.
  - Все 31 Playwright E2E тестов успешно пройдены.

## [0.4.0] — 2026-09-15

### Этап 4: Углубленные карточки активов, Time-Series и Индикаторный движок
- **Высокопроизводительный индикаторный движок (`IndicatorEngine`):**
  - Детерминированные математические расчеты:
    - SMA (20, 50, 200);
    - EMA (с коэффициентом $\frac{2}{N+1}$);
    - RSI (метод Уайлдера со сглаживанием 14 периодов);
    - MACD (12, 26, 9 с линией, сигналом и гистограммой);
    - Bollinger Bands (20 SMA, ±2σ, процент ширины полос);
    - ATR (14-периодный True Range со сглаживанием Уайлдера);
    - VWAP (Volume-Weighted Average Price);
    - Volume Profile (расчет POC, Value Area High/Low на базе 70% распределения объемов);
    - CVD (Cumulative Volume Delta).
  - Динамический пересчет полного комплекта индикаторов непосредственно по загруженным свечам.
- **Хранилище временных рядов (`TimeSeriesRepository`):**
  - Реализован `MemoryTimeSeriesRepository` с автоматической дедупликацией свечей по timestamp.
  - Гарантированная хронологическая сортировка (`time ASC`).
  - Механизм детекции пропусков в истории (`detectGaps`) с фиксацией пропущенных баров.
  - Защита от переполнения памяти с вытеснением старых свечей при превышении лимита.
- **Биржевой стакан цен Level 2 (`OrderBookL2`):**
  - Интерактивный стакан котировок L2 для страницы монеты (`CoinDetailPage`).
  - Отображение заявок Bids (зеленый) и Asks (красный) со столбчатыми индикаторами относительной глубины (depth bars).
  - Расчет Mid Price, спреда в USD и относительного спреда в базисных пунктах (bps).
  - Подключение к потоку `depth:<symbol>`.
- **Тестирование:**
  - Добавлено 13 новых юнит-тестов (всего 87 тестов в 12 файлах) для всех математических индикаторов и хранилища временных рядов.
  - Все 31 сквозной Playwright E2E тест успешно пройдены.

## [0.3.0] — 2026-09-15

### Этап 3: Realtime WebSockets & Математический Anomaly Engine
- **Потоковый WebSocket-шлюз (`BinanceWebSocketClient`):**
  - Подключение к публичному WebSocket-серверу Binance (`stream.binance.com:9443/stream`) без необходимости авторизации и API-ключей.
  - Потоковая трансляция тикеров (`<symbol>@ticker`), потока сделок (`<symbol>@trade`) и биржевого стакана 20 уровней (`<symbol>@depth20@100ms`).
  - Автоматическое восстановление соединения с экспоненциальным backoff и синхронизацией активных подписок.
  - Преобразование данных в типизированные сущности `TickerTick`, `TradeTick`, `OrderBookSnapshot` с гарантией происхождения `DataProvenance`.
- **Внутренняя шина событий с троттлингом (`EventBus`):**
  - Реализован шаблон Pub/Sub для каналов котировок, сделок, книги заявок и аномалий.
  - Очередь с регулируемым троттлингом (batch interval 250 мс) для предотвращения лагов пользовательского интерфейса при интенсивном потоке котировок.
- **Математический движок детекции аномалий (`AnomalyEngine`):**
  - Детекция всплесков объема (Volume Spike) через расчет Z-Score ($Z = \frac{V - \mu}{\sigma}$) по скользящему окну.
  - Детекция резких ценовых импульсов (Price Move Velocity) с градацией важности HIGH ($>4\%$) и MEDIUM ($>2.5\%$).
  - Детекция резкого расширения волатильности (Volatility Expansion) относительно среднего диапазона.
  - Встроенный период охлаждения алертов (cooldown) для исключения спама повторными уведомлениями.
- **Интеграция с UI:**
  - `Header`: отображение статуса WebSocket-соединения (`LIVE SPOT (WS ●)`).
  - `RadarPage`: живой режим `LIVE ANOMALY ENGINE` с реактивным получением зафиксированных аномалий.
  - `CoinDetailPage`: реактивное обновление котировки в реальном времени с пульсирующим маркером тика и указанием источника.
  - `MarketPage`: живое обновление цен в таблице инструментов.
- **Тестирование:**
  - Добавлено 15 новых юнит-тестов (всего 74 теста в 10 файлах) для шины событий, математики Z-Score, таймаутов, парсинга сообщений WebSocket.
  - Добавлен E2E-тест Playwright для проверки переключения в Live Spot режим с отображением статуса сокета (всего 31 тест пройден).

## [0.2.0] — 2026-09-15

### Изменение генеральной концепции (General Concept Decision)
- **Исключение торгового исполнения (No Trade Execution):**
  - По решению владельца проекта торговый функционал полностью и окончательно исключен из концепции CRYPTORA — не просто отложен, а аннулирован в архитектуре, дорожной карте и документации.
  - Терминал окончательно проектируется исключительно как **Crypto Market Intelligence Terminal** с целевой цепочкой:  
    `Рынок → Данные → Аналитика → Наблюдения → Решение пользователя`.
  - После шага «Решение пользователя» никакого слоя исполнения заявок (`CRYPTORA ORDER EXECUTION`) нет.
  - Навсегда исключены: торговые боты, автотрейдинг (automated trading), создание/изменение/отмена ордеров, подключение торговых API-ключей/секретов, управление биржевыми балансами, копитрейдинг, кошельки, сид-фразы, приватные ключи, кастоди, автоисполнение сигналов или рекомендаций AI.
  - Зафиксировано архитектурное решение `ADR-006: CRYPTORA IS ANALYTICS-ONLY / NO TRADE EXECUTION` в `docs/DECISIONS.md`.
  - Обновлены и приведены к строгому соответствию документы `AGENTS.md`, `README.md`, `docs/CONCEPT.md`, `docs/MASTER_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATA_SOURCES.md`, `docs/MARKET_DATA.md`, `docs/STRATEGIES.md`, `docs/BACKTESTING.md`, `docs/SIGNALS.md`, `docs/ALERTS.md`, `docs/AI.md`, `docs/SECURITY.md`, `docs/API.md`, `docs/MONETIZATION.md`, `docs/ROADMAP.md` и весь каталог `docs/agent-plan/`.

### Этап 2: Публичные спотовые данные (Spot Market Data: Binance & KuCoin)
- **Канонический реестр активов (`AssetRegistry`):**
  - Централизован начальный контролируемый universe из 25 криптоактивов: `BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `ADA`, `DOGE`, `AVAX`, `LINK`, `DOT`, `SUI`, `NEAR`, `APT`, `RENDER`, `TAO`, `INJ`, `UNI`, `AAVE`, `OP`, `ARB`, `TIA`, `FET`, `KAS`, `RUNE`, `SEI`.
  - Строгий маппинг канонического символа на тикеры Binance (`BTCUSDT`) и KuCoin (`BTC-USDT`) с защитой от отсутствия пары на одной из площадок.
- **Адаптеры бирж и валидация схем DTO:**
  - Реализован `BinanceSpotAdapter` (основной источник): опрос публичных спотовых 24h тикеров и OHLCV свечей через `https://api.binance.com` (резервный шлюз `data-api.binance.vision`) без API-ключей.
  - Реализован `KuCoinSpotAdapter` (вторичный источник / fallback): опрос 24h stats, allTickers и свечей через `https://api.kucoin.com` без API-ключей.
  - Строгая runtime-валидация через Zod-схемы DTO (`BinanceTicker24hrSchema`, `KuCoinStatsResponseSchema`, `KuCoinAllTickersResponseSchema`, klines/candles).
  - Обработка ошибок сетевого уровня, лимитов частоты (HTTP 429/418) и таймаутов через типизированную иерархию `AdapterError`.
- **Происхождение данных (Data Provenance) и нормализация:**
  - Каждая запись помечается структурой `DataProvenance: { exchange, market, symbol, timestamp, isFallback }`.
  - Преобразование данных бирж в канонические сущности `AssetSummary` и `OHLCV`.
- **Живой провайдер данных (`LiveMarketDataProvider`):**
  - Реализована полноценная альтернатива `DemoMarketDataProvider` с флагом `isDemo: false`.
  - Изоляция режимов DEMO и LIVE: при сбое обоих биржевых шлюзов возвращается явное состояние ошибки / недоступности, без тайной подстановки фиктивных демо-котировок.
  - Подсистемы, не входящие в спотовый Этап 2 (Futures, Liquidations, Radar), сохраняют честную демо-маркировку.
  - Добавлена возможность переключения режима данных в контексте `MarketDataContext` и модальном окне `DemoModal`.
- **Тестирование:**
  - Добавлено 31 новый юнит-тест Vitest (всего 59 тестов в 7 тестовых люксах): валидация схем, нормализация, реестр, fallback, таймауты, ошибки сети.
  - Все тесты используют детерминированные фикстуры без зависимости CI от доступности внешних бирж.
  - Все 30 Playwright E2E тестов успешно пройдены.

## [0.1.0] — 2026-09-15

### Аудит и приемочный контроль (Acceptance Audit & Fixes)
- **Playwright E2E Test Suite (`npm run test:e2e`):**
  - Развернут полнофункциональный тестовый люкс Playwright (`@playwright/test`) с 30 автоматизированными проверками:
    - 14 тестов сетевых маршрутов и целостности HTML каркаса (`e2e/routes.spec.ts`): `/`, `/market`, `/coin/:symbol`, `/futures`, `/liquidations`, `/screener`, `/radar`, `/heatmaps`, `/tools`, `/strategies`, `/signals`, а также обработка 404.
    - 10 тестов сквозных пользовательских сценариев (`e2e/flows.spec.tsx`): обзор, поиск и сортировка в таблицах, карточка актива, фьючерсы с фильтрацией по знаку фандинга, журнал ликвидаций, фильтры и пресеты скринера, лента радара аномалий, калькуляторы размера позиции и PnL, кодекс прозрачности сигналов/стратегий, модальные окна и шторки.
    - 6 адаптивных смоук-тестов (`e2e/responsive.spec.tsx`) на ширинах 390 (mobile), 768 (tablet), 1024 (laptop), 1440 (desktop), 1920 (wide desktop) с верификацией мобильного гамбургер-меню и отсутствия горизонтального слома layout.
- **Индикация данных и защита от мислидинга:**
  - На странице Ликвидаций удалена двусмысленная формулировка «живой демо-поток forceOrder», заменена на строгое обозначение «Демонстрационный журнал событий ликвидаций (симуляция)».
  - Закреплен методологический баннер: `ACTUAL LIQUIDATION EVENT ≠ ESTIMATED LIQUIDATION LEVEL`.
  - Усилена маркировка «Демонстрационные данные» на страницах Обзора, Рынка, Фьючерсов, Скринера, Радара и Тепловых карт.
  - Добавлен обязательный плюс-префикс `+` для положительных ставок финансирования (`FuturesPage`, `CoinDetailPage`).
- **Доступность (Accessibility / a11y):**
  - Добавлены четкие стили клавиатурного фокуса `:focus-visible` (контур цвета brand-cyan с отступом).
  - Добавлена поддержка медиа-запроса `prefers-reduced-motion: reduce` для отключения мерцающих пульсаций и резких анимаций.
- **Аудит документации источников:**
  - Файл `docs/DATA_SOURCES.md` актуализирован и снабжен пометками `REQUIRES VERIFICATION` по всем биржам, типам эндпоинтов, ограничениям частоты запросов, глубине истории и лицензионным ограничениям до фактического старта Этапа 2.

### Добавлено
- **Архитектурная память проекта:**
  - Полный комплект документации в `docs/`: `CONCEPT.md`, `MASTER_SPEC.md`, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `DATA_SOURCES.md`, `MARKET_DATA.md`, `INDICATORS.md`, `DERIVATIVES.md`, `LIQUIDATIONS.md`, `SCREENER.md`, `RADAR.md`, `SIGNALS.md`, `STRATEGIES.md`, `BACKTESTING.md`, `ALERTS.md`, `AI.md`, `SECURITY.md`, `DATABASE.md`, `API.md`, `MONETIZATION.md`, `ROADMAP.md`, `DECISIONS.md`.
  - Пошаговый план агентов в `docs/agent-plan/`: `00-README.md`, `RULES.md`, `STATUS.md`, `01-VISUAL-FOUNDATION.md` — `16-MONETIZATION.md`.
  - Регламент работы агентов в `AGENTS.md`.
- **Этап 1: Visual Foundation & Demo Data Layer:**
  - Настройка проекта на React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Zod, Vitest и Playwright.
  - Строгие контракты данных: интерфейс `MarketDataProvider` и валидаторы Zod (`types/market.ts`).
  - Реализация `DemoMarketDataProvider` с детерминированным набором из 30 активов, таймсериями OHLCV, открытым интересом, ставками финансирования, ликвидациями и событиями радара.
  - Верхняя навигация с глобальным поиском, бейджем демонстрационного режима, всплывающим окном пояснения и быстрым доступом к Watchlist / Alerts.
  - Полоса тикера рынка (BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX) с 24h динамикой и спарклайнами.
  - Страница **Обзор (Overview)**: сводка рынка (Cap, Volume, Dominance, Fear & Greed, Advance/Decline), интерактивный график BTC, снапшоты деривативов и ликвидаций, мини-тепловая карта, стрим радара, топ лидеров роста/падения и экстремумы фандинга.
  - Страница **Рынок (Market)**: таблица 30 активов с динамической сортировкой, категоризацией, поиском, спарклайнами и переходом на карточку монеты.
  - Страница **Карточка монеты (/coin/:symbol)**: интерактивный финансовый график с переключением таймфреймов, стаканом/парами, индикаторами (RSI, MACD, SMA), метриками деривативов и событиями радара.
  - Страница **Фьючерсы (Futures)**: таблица деривативов высокой плотности (OI, дельта 1h/24h, Funding rate, Basis, ликвидации), фильтрация по знаку фандинга.
  - Страница **Ликвидации (Liquidations)**: визуализация объемов Long/Short, таймлайн, распределение по активам и биржам, а также обязательное правовое разграничение `Actual vs Estimated`.
  - Страница **Скринер (Screener)**: многофакторные работающие фильтры (Price change, Volume, OI delta, Funding rate, RSI, Market Cap) и быстрые пресеты.
  - Страница **Радар рынка (Market Radar)**: лента аномальных рыночных событий со степенями критичности и типами событий.
  - Страница **Тепловая карта (Heatmap)**: тремап-визуализация с режимами 24h Change, Volume, Open Interest, Funding Rate и шкалой-легендой.
  - Раздел **Инструменты (Tools)**: полностью функционирующие и протестированные калькуляторы Position Size и PnL, а также превью калькуляторов ликвидации и DCA.
  - Разделы **Стратегии** и **Сигналы**: честные прототипы будущей методологии без фиктивных обещаний доходности.
  - Избранное (Watchlist) с сохранением в localStorage.
  - Модальное окно создания алертов (Alerts preview).
  - Тестовый люкс: юнит-тесты Vitest для утилит форматирования, сортировки, фильтрации скринера, формул калькуляторов и контрактов данных.
  - Комплексные E2E тесты на Playwright.
