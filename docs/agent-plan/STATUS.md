# STATUS — Текущий статус проекта CRYPTORA

## 2026-09-25 — authorial frontend redesign pass (this branch)

- Base verified after `git fetch origin`: `origin/main` = `bd69cfca3059fa3292f8232d71bd154680185368`.
- Frontend-only: compact terminal shell treatment, shared authorial tokens, smaller footer, and global-by-default Signals Home.
- `/signals` primary feed is `GET /api/signals?limit=20` without a symbol filter. Asset history is a distinct bounded view, activated after explicit selection/deep-link. Statistics default is global, with explicit `ALL SIGNALS` / `CURRENT ASSET` scope.
- No server, strategy engine/math, production settings, or production signal records changed. Not deployed.
- Verification so far: `npm run typecheck`, `npm run build`, targeted Signals unit tests pass.
- Phase 2: route-specific layout identities and workstation styling were added across primary routes; screenshot QA and Browser E2E remain blocked in this sandbox because Playwright Chromium download repeatedly fails with `ECONNRESET`.


PR #21 (ветка `arena/01a0d727-cryptora` от `a33bd1aba3b4b9998557b2e4d77a1418cad0d98c`) — колокольчик переведён на СЕРВЕРНЫЙ
источник продакшн-событий; deep-link `/signals?symbol=<BASE>&signal=<server-id>`; RUNE-инцидент 2026-09-25 разобран в
`docs/incidents/2026-09-25-bell-dual-source.md`. **НЕ СЛИТО, НЕ ЗАДЕПЛОЕНО.**

> **ЕДИНСТВЕННАЯ ТОЧКА ОСТАНОВКИ ДЛЯ СЛЕДУЮЩЕГО АГЕНТА**  
> **Последнее обновление:** 2026-09-25
> **Текущая версия:** v0.9.3 — ИНТЕГРАЦИЯ ВЕТОК + UX-ПРОХОД ПО СКРИНШОТАМ (навигация, график монеты, новости)  
> **ТЕКУЩИЙ ЭТАП (2026-09-24, ветка `arena/01a0d27d-cryptora` от `45c01b80`, PR #18):** Signals
> end-to-end — исправления производства (BUG A/B/C/D), серверный монитор открытых сигналов, серверная
> статистика, часовой пояс пользователя. **НЕ СЛИТО, НЕ ЗАДЕПЛОЕНО.** Полное описание этапа — ниже, перед
> разделом про PR #16.
> **ОСНОВНОЙ BACKLOG → [`docs/PRODUCTION_ROADMAP.md`](../PRODUCTION_ROADMAP.md).** После текущих
> исправлений (PR #12, #13, #14 слиты; PR #15 — аудит и PR #16 — конвейер сигналов открыты) задачи берутся
> оттуда: живой checklist
> `[ ]/[~]/[x]/[!]` с приоритетами P0–P3, доказательствами из production, acceptance criteria и
> обязательными инвариантами. Закрывая задачу, обнови её статус и PR/commit в roadmap.
> **Предыдущий этап (Signals V2 UI, ветка `feat/signals-v2-ui` от `origin/main` после слияния #16):**
> Signals V2 UI — страница `/signals` переведена с браузерного журнала на серверную ленту `GET /api/signals`.
> Мобильная иерархия: селектор монеты (полный активный Spot-universe, не админ-скан) → сводка сигнала → свечной
> график (общий `CandleChart`, аддитивные `markers`/`levelLines`) → уровни выбранного сигнала → история →
> сворачиваемые «Статистика и аудит». Уровни/статусы/R — только серверные, ничего не досчитывается на клиенте;
> произвольная длина `targets[]`; таймфрейм сигнала (исполнения, `1h`, V2.8 — не «15m») отделён от таймфрейма
> графика; защита от гонок и запрет веера (свечи — только выбранный символ и таймфрейм). Математика стратегий не
> тронута; серверный фундамент — из слитого #16. Подробности: `docs/SIGNALS.md` §8.8, roadmap 9.3.
> **ТЕКУЩИЙ ЭТАП (2026-09-25, ветка `arena/01a0d727-cryptora`, PR #21, НЕ слит):**
> **P0-инцидент RUNE: колокольчик звонил по сигналу, которого нет в PostgreSQL. Колокольчик переведён на серверный источник.**
>
> **1. Root cause (подтверждён production-доказательствами владельца).** В production работали ДВА независимых
> рантайма сигналов. Страница `/signals` читала `GET /api/signals` (PostgreSQL, миграции 007/009/011), а
> колокольчик — `signalNotifications.ts` ← подписка на браузерный `SignalsAuditLedger` →
> `localStorage cryptora_signal_notifications_v1`. Событие RUNE было **браузерным сетапом**: серверного
> `signal_id` у него не было, в БД оно никогда не публиковалось — отсюда `SELECT` → `[]` и
> `GET /api/signals?symbol=RUNE%2FUSDT` → `count = 0` при звонящем колокольчике. Данные RUNE в PostgreSQL
> НЕ вставлялись и НЕ мигрировались; состояние стратегий (V3.0 on, V3.3/V2.8 off, lastScanAt/lastSignalAt/
> lastError) и `scan_universe` не менялись.
>
> **2. Серверный источник продакшн-событий.** `src/services/signals/serverSignalNotifications.ts`: лента
> строится ТОЛЬКО по `SignalDto` из `GET /api/signals`, id события `srv-<signalId>-<KIND>`, в записи
> серверный `signalId` + symbol/strategy/direction/timeframe/status/уровни/время/provenance. Смена статуса —
> по сохранённому снапшоту `seen` (переход при закрытой вкладке не теряется, первая синхронизация только
> «сеет» базу и не звонит, уже известные строки не дублируются). Политика происхождения fail-closed: только
> `VERIFIED`; `MISMATCH`/`UNKNOWN` в ленту не попадают, но их число показано честно. Отказ источника
> (`GET /api/signals` упал) не удаляет уже подтверждённые события.
>
> **3. Версионированное хранилище и миграция.** `src/services/signals/signalNotificationStorage.ts`: конверт
> со `schemaVersion` + `source`. ЛЕГАСИ `cryptora_signal_notifications_v1` переносится в карантин
> `cryptora_signal_notifications_v1_legacy_quarantine` (сохранён целиком, лентами НЕ читается) — старое
> локальное событие не может выглядеть серверным. Серверная лента — `…_v2`, локальный аудит браузера —
> `…_local_v1` (отдельный источник `local-ledger`, событий продукта не создаёт). `SignalsAuditLedger` не
> удалён: он остаётся явным локальным аудитом/отладкой.
>
> **4. Deep-link уведомления.** Каждое событие ссылается на `/signals?symbol=<BASE>&signal=<server-id>`.
> `SignalsPage` выводит символ и выбранный сигнал ИЗ URL (ранее эффект «смена монеты сбрасывает сигнал»
> обнулял выбранный по ссылке id на монтировании — теперь URL единственный источник). Сигнал за пределами
> первой страницы догружается точечно новым `server/routes/signals.js` `GET /api/signals/:id`
> (`signalRepository.getSignalById`: один `SELECT` по первичному ключу; `400 INVALID_ID`,
> `404 SIGNAL_NOT_FOUND`; карантинные строки отдаются как есть). Неизвестный id — честная ошибка без
> подстановки чужого сигнала; сигнал другого инструмента не «переезжает» на выбранную монету. «Открыть
> актив» сохранено отдельным действием.
>
> **5. Свечи и шкала цены при смене инструмента (второй дефект того же инцидента).** `CandleChart` —
> persistent: при смене символа снимаются данные ВСЕХ серий (`setData([])`), линии текущей цены и уровней,
> маркеры, и ЯВНО возвращается авто-масштаб цены (`autoScale: true`) у серий и правой шкалы; подгонка
> времени нового инструмента выполняется приходом его данных; график не пересоздаётся. Кэш свечей раздельный
> (`${symbol}_${timeframe}_${klineLimit}`), резерв KuCoin запрашивает тот же инструмент; при отказе
> источника по RUNE — честная ошибка/пустота, подстановки свечей BTC нет. «KLINE STALE» (свежесть WS-тика,
> не отказ REST) оставлен на отдельную диагностику — поведение не менялось.
>
> **6. Проверено (локально, честно):** `npx tsc --noEmit` — 0 ошибок; `npx vitest run tests/unit` —
> **132 файла / 1419 тестов passed**; `npx vitest run tests/integration` — **11 файлов / 189 passed**
> (настоящий embedded PostgreSQL); `npm run build` — успешно; Browser E2E на локально распакованном
> Chromium (`@sparticuz/chromium`, см. §5.1) — **97 сценариев passed**, включая новый
> `e2e/signalsBellServerSource.spec.ts`; `git diff --check` — чисто. Новые тесты:
> `serverSignalNotifications` 16, `useServerSignalNotifications` 6, `signalsDeepLink` 5,
> `candleChartSymbolTransition` 5, +2 в `useSignalChartCandles`, +3 в `liveDataProvider`,
> +3 в `signalsRealBackendPath`, +3 Browser E2E.
>
> **7. Математика стратегий не менялась:** нулевой diff по `src/services/strategyArchive/**`,
> `src/services/signals/live/**` и ядру (**STRATEGY MATH MODIFIED: NO**); production-БД не изменялась
> (**PRODUCTION SIGNALS MODIFIED: NO**); deploy не выполнялся (**PRODUCTION DEPLOYED: NO**);
> PR не слит (**PR MERGED: NO**). **BELL SOURCE OF TRUTH: server · SIGNALS SOURCE OF TRUTH: server.**

> **ТЕКУЩИЙ ЭТАП (2026-09-24, ветка `arena/01a0d27d-cryptora`, PR #18, не слит):**
> **Сигналы end-to-end. База:** `origin/main` = `45c01b80f72f129388d86d7b7ac7a2ab207247b0`, HEAD ветки — см. `git log`.
>
> **1. Исправления производства (доказаны на реальной странице):**
> * **BUG A — поиск селектора монеты.** Ввод `B` давал «Ничего не найдено» при ~493 активных Spot USDT
>   инструментах. Корень: `SymbolPickerModal` сбрасывал строку в эффекте с зависимостями `[open, onClose]`, а
>   `SignalsCoinSelector` передавал `onClose` инлайн-стрелкой — каждый ререндер родителя (опросы статуса 5 с,
>   журнала 5 с, ленты 60 с) перезапускал эффект и делал `setQuery('')` ПОСЛЕ ввода символа. Исправление:
>   стабильный `onClose` (`useCallback`) + сброс только при переходе `open` false→true. Дополнительно запрос
>   нормализуется (`BTC/USDT`, `BTCUSDT`, `btc` → `BTC`) — раньше пара не находила свой тикер никогда.
>   Поиск локальный, по загруженному реестру `/api/market/universe/spot` (не админ-вселенная скана).
> * **BUG B — два пустых состояния.** Страничный блок и блок внутри `SignalSummaryCard` показывали «сигналов
>   нет» одновременно. Оставлен один: `signals-empty[data-state]` с причиной `scanner-off` / `empty` /
>   `error` / `market-error`.
> * **BUG C — ложный LIVE.** Плашка читала браузерный `LiveSignalEngine.getStatus()` и писала «LIVE-скан ·
>   каждые 60с» при `enabled = false` у всех трёх стратегий. Теперь источник — серверный `/api/strategies`
>   (`useServerScanner`, 15 с, пауза при скрытой вкладке): 0 включенных → «Сканирование сигналов выключено»,
>   N → «Сканирование включено: N стратегий · каждые Xс» (X из БД), ERROR → отдельной строкой, отказ запроса →
>   «Статус сканирования недоступен» (не «выключено»).
> * **BUG D — метка LOCAL.** Тумблер LOCAL/UTC и техническая подпись зоны убраны из `CandleChart` и
>   `IndicatorPaneChart`; вместо неё подпись настоящего IANA-пояса пользователя.
>
> **2. Серверный монитор открытых сигналов** (`server/services/signalMonitor/{signalMonitor,signalTradeManager}.js`,
> миграция `010_signal_monitor_bookkeeping.sql`): тик 30 с независимо от браузера; бюджет цикла
> `MAX_LIFECYCLE_SYNC_PER_SCAN = 500` сигналов, `MAX_MONITOR_GROUPS = 64` группы, конкуррентность 4,
> lookback ≤ 1000 баров **на группу, размер по ТАЙМФРЕЙМУ ГРУППЫ** (`timeframeMs()` → `ARCHIVE_TF_MS` ядра;
> таймфрейм из `signals.timeframe`) — **веера N×свечи нет**. Исполнение и исход считает ЗАМОРОЖЕННЫЙ
> `trackPublishedSetup()` через адаптер: семантика закрытого бара, `CORRIDOR_EXPIRY_BARS = 3`,
> `TIMEOUT_BARS = 50` (V3.0) / `48` (V3.3), комиссии из `V30_CONSTANTS`/`V33_CONSTANTS`, LONG fill =
> `min(open, zoneHigh)`, SHORT fill = `max(open, zoneLow)` — как в ядре; паритет зафиксирован тестом.
> **Same-bar TP/SL — правило РАЗНОЕ у разных стратегий** (не универсальное «сначала стоп»): V3.0 — стоп
> первым, `// R1: stop first, always.` (`v30Core.ts:160`, `manageTrade` 124–188); V3.3 — структурно так же
> (`v33Core.ts:270`, `manageTrade` 241–295), но комментария R1 нет, а таймаут другой (48 против 50); V2.8 —
> пары TP/SL нет вовсе, исходы только `SL|BE|TRAIL|TIMEOUT` (`v25Trailing.ts`, `simulateTrailing` 38–105).
> Порог зафиксирован в `outcome.sl_priority_on_ambiguous_bar = true`.
> Монитор **stateless по стратегии**: рестарт-паритет проверен на настоящем PostgreSQL для V3.0/V3.3/V2.8,
> частичный жизненный цикл (TP1 ⇒ `FILLED`, не исход) и TP1 → BE через рестарт тоже. Окно 1000 баров >
> максимального жизненного цикла (V3.0 ≈ 53–54, V3.3 ≈ 51–52, V2.8 ≈ 113). Состояние цикла — в
> `signal_monitor_state` + `signals.monitor_*` (переживает рестарт), отказ рыночных данных
> не роняет тик и не закрывает сигнал, `stale` после двух подряд отказов. Монитор стартует и при
> выключенных стратегиях: сопровождает уже сохранённые открытые сигналы, новых не создаёт, стратегии не
> включает. 009 не переписана; 010 аддитивная,
> обычная DDL (раннер оборачивает миграцию в одну транзакцию, `CONCURRENTLY` невозможен).
>
> **3. Серверная статистика** (`server/services/signalStatistics.js` → `GET /api/signals/statistics`, UI —
> `SignalStatisticsPanel`): агрегаты по persisted lifecycle, а не по браузерному `SignalsAuditLedger`.
> Раздельные счётчики опубликовано / ожидают входа / дождались входа / завершились сделкой / без сделки;
> gross R, net R, ΣR, разрезы по стратегии и инструменту; четыре корзины результата (прибыльные / в ноль / убыточные / без оценки R);
> доля успешных — только по завершённым сделкам с известным результатом; `null` → «—».
> Точные формулы и место результата 0 R (отдельная корзина `breakEven`, а не `losses`; NULL не считается нулём) — `docs/SIGNALS.md` §10.
> Телеметрия монитора — `GET /api/signals/monitor` (только чтение; пользовательских эндпоинтов, меняющих
> состояние стратегий, не добавлено).
>
> **4. Часовой пояс.** `src/utils/timePresentation.ts` — единственный форматтер (оси, перекрестие, бейджи
> свежести, время сигнала и исхода). Зона — `Intl...resolvedOptions().timeZone` (пояс ОС/браузера), DST-aware;
> БД и API остаются UTC/ISO; `mode: 'UTC'` только для отладки. Захардкоженных UTC+3 / Europe/Moscow нет
> (проверяется сканом исходников).
>
> **5. Авто-обновление.** `useAutoRefresh`: лента 60 с, статус сканера 15 с, статистика 60 с; пауза при скрытой
> вкладке; `AbortController` + монотонный номер запроса отменяют устаревшие ответы. Серверный монитор пишет
> исход независимо от вкладки, поэтому статус меняется на экране без перезагрузки.
>
> **6. Проверено:** `npx tsc --noEmit -p tsconfig.json` — 0 ошибок; `npx vitest run` — **135 файлов /
> 1476 тестов passed, 0 failed**; `npx vitest run tests/integration` — **130 passed** (настоящий PostgreSQL,
> включая `signalMonitorPostgres` 15 и `migrationsPostgres` 28); `npm run build` — успешно; Browser E2E на
> реальном Chromium (`@sparticuz/chromium`, см. §5.1) — **94 сценария passed**; `git diff --check` — чисто.
> Новые тесты: `signalMonitor` 21, `signalMonitorParity` 24, `signalStatistics` 9, `signalCoinSelectorSearch` 6,
> `signalsScannerStatus` 13, `signalsStatisticsPanel` 7, `chartTimePresentation` 11.
>
> **7. Математика стратегий не менялась:** нулевой diff по `src/services/strategyArchive/**`,
> `src/services/signals/live/lifecycle.ts` и ядру (**STRATEGY MATH MODIFIED: NO**). Стратегии остаются
> `enabled = false` (**PRODUCTION STRATEGIES ENABLED: NO**); план канарейного включения — runbook-only в
> `docs/STRATEGY_OPERATIONS.md` §13.
>
> **8. PR:** https://github.com/nub36/CRYPTORA/pull/18 — OPEN, CI зелёный (Typecheck + Unit + Build,
> Browser e2e). Merge и deploy — за владельцем.
> **9. Остаток:** серверный архив исходов старше окна реплея; `pnl_result_pct` из серверного пути; маркеры
> `CandleChart` для других страниц.

> **Предыдущий этап (2026-09-23, PR #16 `fix/signal-pipeline-foundation` — СЛИТ в `main` как `dada279`):**
> надёжный серверный конвейер сигналов — фундамент до Signals V2 UI. Реализованы findings аудита PR #15
> (F-01, F-03, F-05, F-06, F-08, F-09, F-10, F-17): движок вызывает настоящий `LiveSignalEngine.scanNow()`
> (фантомного `scanOnce()` в ядре не было — каждый скан падал с TypeError при живом планировщике); интеграционный
> контракт ядра больше не «зеленеет молча» (`@vitest-environment node`: esbuild в jsdom падает на инварианте
> TextEncoder, а пропуск теперь виден как skipped через `ctx.skip()`); дедупликация сигналов — по
> `setupOpenTime` закрытого бара, а не по времени публикации; лестница целей хранится целиком
> (`targets NUMERIC[]`, TP3 больше не теряется, `tp1`/`tp2` производны); новая аддитивная миграция
> **009_signal_levels_and_lifecycle** (домен `status` из восьми состояний ядра, `chain_version`,
> `fill_*`, `result_r`/`net_result_r`/`bars_held`, `outcome_hash`, индекс `idx_signals_symbol_status_created`;
> 006/007/008 не переписаны); жизненный цикл переносится из ретроспективы ядра как есть, монотонно и без
> выдуманных строк/времени; таймфреймы (`'1D'`→`'1d'`), символы (`'BTC/USDT'`→`'BTCUSDT'`) и лимиты свечей
> (1000/1000/400 = константы ядра, не 300) нормализуются на границе рыночных данных; у пула PostgreSQL появился
> обработчик `'error'` (структурированная запись без секретов, `closePool()` терминален, остановка закрывает пул
> последним шагом) — `FATAL 57P01` больше не завершает процесс и не красит CI; `GET /api/signals` получил
> серверную фильтрацию, ограниченную пагинацию, детерминированный порядок и честные 400 с кодами вместо тихой
> пустоты; эксплуатационные инструкции исправлены (`npm start` = legacy static-сервер, бэкенд = `npm run server`
> / systemd → `server/index.js`, шаблон юнита приведён к фактической схеме VPS).
> Сквозной сценарий стажинга автоматизирован: `tests/integration/schedulerPersistence.test.ts` (настоящий
> PostgreSQL + настоящие миграции + настоящее приложение + настоящее скомпилированное ядро) проходит цепочку
> «включённая через админ-API стратегия → `StrategyScheduler.tick()` → `scanNow()` → `last_scan_at` продвинулся,
> `last_error` = null → повторный цикл уважает интервал и не дублирует → отказ рынка виден в `last_error`/`ERROR` →
> запись `buildSignalRecord()` доходит до БД и `GET /api/signals` со всей лестницей целей»; подменяется только
> сетевой слой рыночных данных. Общий bootstrap настоящего PostgreSQL для новых интеграционных тестов —
> `tests/helpers/embeddedPgHarness.ts`.
> Проверено: `npm run typecheck` — 0 ошибок; полный набор `vitest run` — **121 файл / 1305 тестов passed,
> 0 unhandled errors** (было 1176 passed + 2 unhandled pg-ошибки); восемь подряд прогонов `tests/integration` —
> 109 passed, **0 skipped** (один прогон — с удалённым `.generated/`, холодная сборка бандла); `npm run build` —
> успешно; миграция 009 применена на настоящем PostgreSQL (embedded-postgres) всеми девятью файлами и идемпотентно. Математика стратегий не менялась:
> `src/services/strategyArchive/**`, `src/services/signals/**` — нулевой diff
> (**STRATEGY MATH MODIFIED: NO**). Дизайн Signals V2 (без реализации UI) —
> `docs/agent-plan/SIGNALS_V2_HANDOFF.md`.
> **Предыдущий этап (PR #14 — влит в main 8eacfb9):** полная вселенная Binance — Spot из
> exchangeInfo (USDT/TRADING/spot allowed), Futures — все активные USDT-M perpetual, логотипы через
> серверный кэш CoinGecko, скан-вселенная в PostgreSQL (миграция 008, админка «Монеты»), пагинация
> /market и /futures, селекторы /coin и /liquidations по всей вселенной. Живые счётчики из песочницы
> не проверены (нет доступа к Binance) — проверить на VPS через /api/market/universe/*.
> Прод-ошибка `relation "strategy_settings" does not exist`: миграции на VPS запускались без
> DATABASE_URL прод-базы (конфиг не читает .env) — процедура в описании PR.
> **Текущий этап:** v0.9.3 completed: в main влиты ветка аудита (отчёты + артефакты) и серверный слой
> стратегий из arena/01a0aeee (движок, миграции 006/007, API /api/signals и /api/strategies,
> setupGeometry) — при этом рантайм сигналов сохранён за main (SetupIssuance/SetupOutcome, outcomeHash);
> серверный движок влит как самостоятельный слой и UI его пока не потребляет (перевод /signals на
> GET /api/signals — отдельное решение владельца, нужен PostgreSQL). Навигация: «Ликвидации» и «Радар»
> перенесены в «Инструменты», в primary пришли «Статьи» и «Новости» (5 из 6 слотов). /coin: дефолтный
> таймфрейм 15m, переключатель типа графика без «Бары» (Свечи + Линия), scaleMargins.top 0.08→0.12 и
> barSpacing 8→10, во всех fetch-эффектах AbortController (устранено зависание графика при навигации).
> Новая страница /news — честная заглушка: источник не подключён, демо-лента не подставляется.
> Починены CI-регрессии слияния: guard миграций не падает без origin/main (+ fetch-depth: 0),
> аннотации e2e больше не забиваются шумом [WebServer], плашка «Доли неподключённых бирж не
> оцениваются» переведена на eventsCount24h === 0 (§40 всегда возвращает все биржи).
> typecheck + 1078 unit + build + Browser e2e зелёные.
> Предыдущее: v0.9.1 completed: движок сканирует вселенную реестра + кастомные тикеры (Binance spot),
> админка «Монеты» (updateSymbols в runtime), колокольчик = алерты + события журнала (вкладка «Сигналы»),
> /signals (дефолт «Открытые», «Отменённые», +/− по чистому R, исход текстом, тикер→/coin), /coin (пикер,
> свечи/линия («Бары» убраны в v0.9.3), MA-тумблер с легендой), /liquidations (цена+ликвидации на одном графике),
> /futures без логотипов. Правила стратегий не тронуты. typecheck+unit+build зелёные.
> Предыдущее: INTEGRATION RELEASE completed. Main объединяет ветку сигналов (LIVE V3.0/V3.3/V2.8
> на закрытых свечах, статус-панель /signals, валидация, KuCoin-окна, навигация «Сигналы»), Source
> Health circuit breaker и оба Audit Remediation прохода. Интеграционные решения: guard сканов = их
> currentScan + наша document.hidden-пауза; AlertService удалён (Н13); deploy.yml — только ручной
> запуск (прод = VPS); версия 0.9.0 (коллизия локальных 0.8.45–0.8.49 ветки сигналов задокументирована). Мёртвый AlertService удалён (Н13); беты
> портфеля пересчитываются каждые 60с (Н12); LiveSignalEngine — guard сканов + пауза в фоне (Н8);
> CoinIcon AA-палитра с юнит-проверкой контраста (Д2); slate-600→500 в 7 файлах (Д4); тач-таргеты
> ≥28px на ≤640px (Д3); CI-workflow + первые настоящие Chromium-e2e (Н10). Осознанно отложено:
> react-router 7 (breaking, после e2e в CI), CSP nonce, Н5 TLS (VPS владельца), 44px-таргеты.
> Предыдущие: v0.8.51 (Б1 авто-обновление), v0.8.50 (Н6/З3/З4/З6/З7/Б3), v0.8.45 (Source Health). Все рыночные страницы (/ , /market, /futures,
> /heatmaps, /screener) обновляют данные сами каждые 30с; в фоновой вкладке запросы на паузе,
> возврат видимости/сети — внеочередной рефреш. Хук: src/hooks/useAutoRefresh.ts (8 тестов).
> Предыдущие этапы: AUDIT REMEDIATION PASS 1 (v0.8.50: Н6/З3/З4/З6/З7/Б3+Н9/Н11), Source Health (v0.8.45). По независимому аудиту (PR #1,
> DEEP_AUDIT_2026-09-18 + AUDIT_REPORT_2026-09-17) верифицирован каждый пункт по актуальному коду:
> Н1/Н2 (SSRF), Н3 (look-ahead), Н4/Н7 (реестр сигналов), Д1 (шрифты), З1/З2/З5 — оказались уже
> исправлены в актуальном дереве; в этом проходе исправлены Н6 (WS-реконнект бесконечный +
> online/visibility reset), З3 (индикаторы null без заглушек), З4 (фактический spot-OI вместо ×0.15),
> З6 (стакан — скелетон), З7 (спред только из bid/ask), Б3 (watchlist WS-подписка), Н9/Н11 (мелочи).
> ⚠️ Коллизия версий с PR #2 (0.8.45–0.8.49): эта ветка использует 0.8.45 и 0.8.50 — при merge
> одну из сторон перенумеровать (см. CHANGELOG 0.8.50).
> Предыдущий этап: CORRECTIVE PROD-DIAGNOSTICS PASS (v0.8.45 Source Health). Систематические сетевые отказы
> (CORS KuCoin, делистнутый/недоступный на Binance инструмент, гео-блок) больше не долбятся каждым
> циклом опроса: `SourceHealthTracker` блокирует endpoint+инструмент с backoff, диагностика — один
> console.warn на эпизод. P11-warn дедуплицирован. Честность данных не затронута (RULES §1):
> трекер ничего не подменяет — актив с недоступными источниками честно отсутствует/помечен «нет данных».
> **D5 VERIFIED_NO_CHANGE:** Liquidation normalization/freshness — `LiquidationPulse`, `LiquidationPipeline`, `LiquidationHeatmap` data flow unchanged in D-series. Liquidation 24h remains ACTUAL (pipeline events) / ESTIMATED (DerivativesEngine model) / UNAVAILABLE.  
> **D6 VERIFIED_NO_CHANGE:** Radar/Screener/Heatmap consistency — null-safe change1h/change7d from D1 already applied to ScreenerPage (D1 commit). RadarPage and HeatmapGrid now also null-safe for OI delta. No new artificial data was needed.  
> 🏭 **ФАКТИЧЕСКИЙ PRODUCTION (исправлено по указанию владельца):** перед v0.8.5 production на VPS
> (`89.125.24.50`) был обновлён до **v0.8.4 (`6a01ce1`)** и визуально проверен на `/liquidations`.
> Прежние записи «production = v0.8.3» неверны. Версии v0.8.5–v0.8.39 на VPS **не выкатывались** (деплой не заказан).  
> ⚠️ **КЛЮЧЕВОЙ ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> 🚨 **P0-ИНЦИДЕНТ 2026-09-24 (этап этой ветки, `arena/01a0d40a-cryptora`): CROSS-STRATEGY
> PROVENANCE.** Три `strategy_id` (V3.0 / V3.3 / V2.8) получили на production ОДИН payload
> (BTC/USDT, `signal_candle_ts` `2026-09-24 14:00 UTC`: `LONG`, коридор `83612.89569417082 …
> 83734.64430582919`, стоп `83297.56854125623`, цели `{85389.275, 87278.54}`; то же на SEI, RENDER,
> NEAR, INJ). **Root cause:** `server/services/strategyEngine/strategyEngine.js` → `runStrategyScan()`
> читал статический синглтон `SignalsAuditLedger.getInstance()` **ПОСЛЕ `await`**, а планировщик
> запускает стратегии КОНКУРЕНТНО — сканы читали чужой журнал, а `buildSignalRecord()` ставил
> `strategyId` вызывающего. **Fix:** ссылка на ledger фиксируется синхронно с созданием движка;
> `buildSignalRecord()` запрещает relabel (`provenanceMismatch`). Математика стратегий НЕ тронута.
> Подробности: `docs/SIGNALS.md` §12, roadmap 9.5, SQL-аудит `scripts/sql/signal-provenance-audit.sql`.
> **PRODUCTION-ФАКТЫ (read-only аудит владельца, подтверждено):** всего сигналов **45**
> (ACTIVE 36 / FILLED 6 / CANCELLED 3), **15** collision-групп × 3 strategy_id, **30** доказанных
> расхождений provenance, открытых с совпадением **12** (ACTIVE 6 + FILLED 6), MISMATCH ACTIVE 30.
> Матрица: V2.8←V3.0 6, V2.8←V3.3 9, V3.0←V3.0 6, V3.0←V3.3 9, V3.3←V3.0 6, V3.3←V3.3 9 ⇒
> **V2.8 не автор ни одной строки**; MATCH 15, MISMATCH 30.
> **ИЗОЛЯЦИЯ (доказано):** свой движок на скан (`new LiveSignalEngine`) + синхронный захват
> журнала + мьютекс критической секции (`scanMutex.js`, внутри ядра всегда один скан) +
> single-flight `loadStrategyCore()`. Барьерные состязательные тесты (без слипов): прямой,
> обратный и перемешанный порядок, враждебный `resetInstance()` посреди чужого скана, гонка
> записи вне мьютекса, падение внутри секции.
> **КАРАНТИН:** миграция **011** — `signals.provenance_status`
> (`VERIFIED | MISMATCH | UNKNOWN`, `DEFAULT 'UNKNOWN'` — fail-closed). Классификация legacy —
> только по префиксу `engine_setup_id`; `UNKNOWN` никогда не повышается автоматически. Монитор
> ведёт только открытые `VERIFIED`; статистика считает только `VERIFIED` + audit-счётчики.
> Процедура `scripts/signal-provenance-classify.mjs` (отчёт / `--apply`, идемпотентна,
> транзакция) — **на production НЕ запускалась**. Хэш-цепочка валидна до и после карантина.
> **PRODUCTION:** стратегии остаются OFF, сигналы НЕ удалены и НЕ изменены, PR #18 НЕ задеплоен,
> миграции 010 и 011 НЕ применены. Точный порядок деплоя (**A–P**, сверен с `systemd` и
> `server/index.js`) — `docs/SIGNALS.md` §12.9. **Бэкенд НЕ стартует между миграциями и
> классификацией**: stop на шаге C, первый start только на шаге N (после dry-run, сверки
> плана 45/15/30, `--apply`, сверки 15/30/12 и проверки хэш-цепочки).
> Полный разбор инцидента — `docs/incidents/2026-09-24-signal-provenance.md`.
> Терминал спроектирован исключительно для сбора и анализа данных (Crypto Market Intelligence Terminal). Торговый функционал, исполнение ордеров, торговые боты, автотрейдинг, кастоди и торговые API-ключи полностью и бесповоротно исключены из архитектуры и дорожной карты платформы.

---

## 1. Что сделано

### v0.9.0 — Интеграционный релиз (merge ветки сигналов → main)
- Влита `arena/01a0b8cc-cryptora` (6 коммитов): LIVE-сигналы V3.0/V3.3/V2.8 на фактических закрытых
  свечах, реплеи/lifecycle/статус движка, тесты signals/* (~800 строк), навигация «Сигналы».
- Разрешения конфликтов: версии → 0.9.0; main.tsx (basename + future-флаги); LiveSignalEngine (их
  рефакторинг + наша hidden-пауза); AlertService удалён; deploy.yml → workflow_dispatch-only.
- Гейты после слияния — в записи коммита интеграции.

### v0.8.52 — Audit Remediation Pass 2 + CI
- Н13: удалены `AlertService.ts` + его тест; пометки в SITE_REPORT/10-ALERTS.
- Н12: PortfolioRiskPage — пересчёт бет/волов через useAutoRefresh(60с).
- Н8: LiveSignalEngine.scan() — in-flight guard + document.hidden пауза (тесты).
- Д2: CoinIcon — новая 20-цветная палитра ≥4.5:1 к белому (юнит-тест WCAG-формулой).
- Д4: text-slate-600 → text-slate-500 (7 файлов; slate-600 не проходит AA в обеих темах).
- Д3: index.css — min-height 28px для интерактива на ≤640px.
- Н10: .github/workflows/ci.yml (quality + browser-e2e) + e2e/browser.spec.ts (4 Chromium-теста).
- Отложено: react-router 7 (после e2e в CI), CSP nonce, Н5 TLS (VPS), 44px-таргеты.
- Тесты: +5, −8 (alerts.test); всего 890 / 85 файлов.

### v0.8.51 — Б1: авто-обновление страниц
- `useAutoRefresh` (см. CHANGELOG 0.8.51): цикл 30с на /, /market, /futures, /heatmaps, /screener;
  пауза в фоновой вкладке, внеочередной рефреш на visible/online, защита от наложений.
- Screener: catch отказа скрининга (было — необработанный rejection).
- Тесты: +8 (`tests/unit/useAutoRefresh.test.tsx`).
- Остаток из аудита (не сделано): Н5 TLS (VPS), Н8 (зона PR #2), Н12 (пересчёт бет портфеля),
  Н13 (мёртвый AlertService), Д2–Д6 (контраст/тач), Н10 (браузерные e2e + CI), зависимости (react-router 7.x — breaking).

### v0.8.50 — Audit Remediation Pass 1 (по аудиту PR #1)
- **Верификация аудита:** все находки DEEP_AUDIT_2026-09-18/AUDIT_REPORT_2026-09-17 проверены по
  актуальному коду (аудит делался на `arena/01a0aeee @ e08acb0` до merge). Уже исправлены ранее:
  Н1/Н2 SSRF-прокси (удалён, `proxyRemoval.test.ts`), Н3 look-ahead (isClosed + closedBars), Н4
  персистенция реестра, Н7 реактивность /signals, Д1 шрифты (@fontsource), З1/З2/З5.
- **Н6:** `BinanceWebSocketClient` + `LiquidationStreamTransport` — бесконечный реконнект с
  насыщением delay (30 с); `window.online`/`visibilitychange` → мгновенный reconnect + сброс счётчика.
- **З3:** `getAssetDetail` → `indicators: null` при <200 свечей; UI «—» (RSI=50/MACD=0/SMA=цена удалены).
- **З4:** spot-OI `/fapi/v1/openInterest` (кэш 60 с) в `getFuturesList`; эвристика ×0.15 удалена;
  `FuturesAsset.openInterest` nullable, потребители null-safe (Futures/Overview/Heatmap/Pulse/Liquidations).
- **З6:** `OrderBookL2` — скелетон «ОЖИДАНИЕ ПОТОКА (WS)» вместо выдуманных уровней.
- **З7:** спред только из bid/ask (Binance/KuCoin), `spreadPct: null` без bid/ask; NaN-гвард
  `extractBinanceSpread`; мёртвая fallback-ветка пары удалена.
- **Б3:** `toggleWatchlist` сразу подписывает/отписывает WS-символ.
- **Н9/Н11:** vite dev-прокси `/api` → `:3000`; React Router future-флаги.
- **Тесты:** +8 (realtimeWs ×3, openInterestHistory ×1 + расширен, liveDataProvider ×4); версии в
  test-фикстурах обновлены. НЕ сделано (след. проход): Б1 авто-обновление страниц, Н5 TLS (операция
  на VPS: certbot + 443/редирект/HSTS), Н8 guard сканов (зона PR #2), Н13 AlertService (зона PR #2),
  контраст/тач (Д2–Д6), браузерные e2e (Н10), зависимости.

### v0.8.45 — Source Health: circuit breaker недоступных REST-источников
- **Контекст (прод-наблюдение с cryptora.duckdns.org):** консоль DevTools заполнялась «красными»
  CORS/`net::ERR_FAILED` по одному активу (KAS): его нет в bulk-тикере Binance → провайдер уходил
  в персональный запрос Binance (отказ без CORS-заголовков) и в KuCoin `market/stats` (KuCoin REST
  не отдаёт браузерам CORS вовсе) на каждом цикле опроса; фоновое обогащение добавляло 2 запроса
  klines (1h+1D) в минуту; `[P11]` печатался на каждом цикле.
- **`SourceHealthTracker`** (`src/services/data/adapters/sourceHealth.ts`): блокировка per
  endpoint+инструмент. Политики: network/http — 3 подряд неудач → 10 мин (повторный эпизод — ×2,
  кап 1 ч); invalid_symbol (400/404) — сразу 6 ч; rate_limit (429/418) — 30 с; таймауты не считаются.
  Успех полностью восстанавливает ключ; поздние «зависшие» неудачи не стирают блокировку.
  Диагностика — один console.warn на эпизод. `AdapterSourceBlockedError extends AdapterNetworkError`.
- **Подключение:** адаптеры Binance/KuCoin — опциональный `health` (выключен по умолчанию —
  детерминированность тестов); включён в `MarketDataContext` (общий трекер) и
  `CandleHistoryService.getInstance()`. `CandleHistoryService` — обёртка `fetchKlinesWithHealth`.
- **P11:** warn только при изменении состава отсутствующих активов (`LiveMarketDataProvider`).
- **Честность данных (RULES §1):** без изменений — трекер не подменяет и не кэширует цены;
  недоступный актив честно отсутствует в таблицах / помечен «ИСТОЧНИК НЕДОСТУПЕН».
- **Тесты:** `tests/unit/sourceHealth.test.ts` — 14 новых; всего 873 (83 файла).

### Ветка сигналов (слито в v0.9.0, локальные версии ветки 0.8.45–0.8.49)
### v0.8.49 — конфигурация GitHub Pages (2026-09-20)
- `.github/workflows/deploy.yml` (push в main / вручную): build с `GITHUB_BASE_PATH=/CRYPTORA/`, копия `index.html` →
  `404.html` (SPA-фолбэк), `.nojekyll`, публикация `actions/deploy-pages`. Включать: Settings → Pages → Source:
  GitHub Actions. Статический фронтенд без Node-бэкенда: auth/AI остаются в режиме «гостя» с честным сообщением;
  рыночные данные и сигналы — клиентские запросы к публичным API бирж, работают.
- `vite.config.ts` — `base` из `GITHUB_BASE_PATH` (по умолчанию `/`, VPS/dev не затронуты); `BrowserRouter` —
  `basename={import.meta.env.BASE_URL}`. Docs: `docs/DEPLOY_GH_PAGES.md`.

### v0.8.48 — журнал аудита без QA-данных + детерминированные id (2026-09-20)
- Публикация в журнал запрещена при `provider.isDemo`: на QA-фикстуре стратегии считаются для диагностики (окно,
  ретроспектива), но в `cryptora_signals_ledger_v2` ничего не пишется; на `/signals` — предупреждение. В production
  провайдер всегда LIVE, поведение не меняется.
- `Math.random()` убран из `AlertService.createRule` и `JournalService.addEntry` (DONT_DO #2): id = время + монотонный
  счётчик; у журнала счётчик продолжается от сохранённых записей. Тесты: 50 правил и 30 записей в одну миллисекунду —
  id уникальны.
- Верификация: `tsc` 0 ошибок; vitest 85 файлов / 889 тестов; Playwright 66/66; `npm run build` OK.

### v0.8.47 — наблюдаемость источника данных в /signals (2026-09-20)
- `SymbolScanStatus.source` (`{ exchange, isFallback }`) + колонка «Источник свечей» на `/signals`: видно, чьи свечи
  использовал скан — Binance или KuCoin (резерв). Провайдер без провенанса → честный `—`. Тесты в
  `liveSignalEngineE2E.test.ts` (основной, резервный, отсутствие провенанса). Версия 0.8.47 синхронизирована.

### v0.8.46 — проверка LIVE на реальных данных + глубина резервного источника (2026-09-20)
- **Проверка на реальных данных (офлайн, датасет Binance spot `c3c1dce`, 2022-01 → 2025-12-31, 6 пар; датасет вне
  репозитория).** Прогон **через сам движок** (241 скан, скользящее окно ≤1000 баров, 10 суток) дал 121
  опубликованный сетап; журнал — 96 закрытых сделок, accuracy 86.5 %, avg RR 3.38, Σ net R +50.30. Сверка с полным
  реплеем: 50/50 сетапов совпали по времени/направлению/входу, V3.0 `runV30Series` vs журнал — 0 расхождений в обе
  стороны. Полная история: V3.0 ≈540–600 записей на пару за 4 года, V3.3 ≈4.2–4.9 тыс.; Q4-2025 публикуемых
  V3.0 — 23–40, V3.3 — 93–127 на пару. Подробно: `docs/SIGNALS.md` §7, ADR-007.
- **V2.8 «молчит» — это редкость, а не отказ.** На 4 годах 1h-истории: 65 сетапов на 6 пар (≈1 на пару в 3–5
  месяцев) при 1150–1250 отсечённых sniper-фильтром actionable-сетапов; в окне 1000 баров ни один сетап полной
  истории не потерян (31 из 65 отличаются на один тик по входу/стопу — квантование коридора при ATR от начала ряда).
- **Задокументировано свойство замороженной V3.3 (не дефект):** зона, образованная последним закрытым 4h-баром,
  становится видимой только после закрытия следующего 4h-бара (`buildZones`, `i < h4.length-1`) → задержка до 4 часов,
  и уровни «на момент скана» могут отличаться от ретроспективного прогона (Amendment-1 берёт новейшую зону).
- **Исправлено:** резервный KuCoin-источник вызывался без окна (произвольная страница по умолчанию при недоступном
  Binance) — теперь `fetchCandles(symbol, type, { startAtMs, endAtMs })`, запрос `limit + 2` бара, обрезка до
  запрошенной глубины и честный `console.warn` при меньшей глубине; +2 теста. Версия 0.8.46 синхронизирована
  (package.json/lock, Header, Footer, e2e-инвариант, uxCleanup, CHANGELOG).
- **Верификация:** `tsc --noEmit` — 0 ошибок; vitest 85 файлов / 885 тестов; Playwright 66/66; `npm run build` OK.

### v0.8.45 — LIVE-сигналы: три архивные стратегии на фактических данных (2026-09-19)
- **Аудит репозитория:** typecheck/vitest/build были зелёными, но Playwright e2e падал 46/66 (в харнесе не было
  `AuthProvider`) и ещё 14 тестов держали устаревшие ожидания UI. Заглушек/TODO/`Math.random` в бизнес-логике нет;
  демо-данные только в `DemoMarketDataProvider`, production-путь — `LiveMarketDataProvider` (Binance/KuCoin REST+WS).
- **Главный дефект:** `LiveSignalEngine` не воспроизводил стратегии: V3.0 без ведения коридора, V3.3/V2.8 — упрощённые
  эвристики, исходы не отслеживались (точность всегда 0 %), `catch {}` глотал ошибки, движок не останавливался.
- **Сделано (стратегии не тронуты):** `live/replays/{v30,v33,v28}LiveReplay.ts` — реплей архивных раннеров теми же
  frozen-функциями; `v28Live.ts` внутри архива (единственное место вне `legacy/`, импортирующее `legacy/v2`);
  `live/lifecycle.ts` — исход по опубликованным уровням; `SignalsAuditLedger` v2 (prevHash, outcomeHash, netResultR,
  без `expireStale`); `/signals` со статусом движка, покрытием, ретроспективой окна; `getCandles(..., limit)`;
  движок останавливается при размонтировании контекста.
- **Верификация:** `tsc` 0 ошибок; vitest 85 файлов / 883 теста (новые: паритет реплеев с раннерами бар в бар,
  паритет V2.8 со `runSniperEntryLoop`+`simulateTrailing`, сквозной движок×журнал на mock-«бирже»); Playwright 66/66;
  `npm run build` OK. Перф: полный реплей 3 стратегий × 6 символов укладывается в секунды (evaluateV2 ≈ 0.43 мс/бар).
- **Не проверено (честно):** фактическая эмиссия на бирже — песочница без доступа к сети; журнал живёт в localStorage.
- **Docs:** `docs/SIGNALS.md` переписан, `14-SIGNALS.md` §3, `DONT_DO.md` (строки 4/8/9/11), README, CHANGELOG,
  D-V28-005 и комментарии `legacy/v2` приведены к факту (порт остаётся архивным, LIVE идёт через обёртку архива).

### Git-статус (v0.8.45)
- Ветка `arena/01a0b8cc-cryptora` с коммитом `v0.8.45: LIVE signals — three archived strategies run on real closed
  candles` запушена в `origin` (в начале сессии доступа к GitHub не было; он появился к моменту пуша). Слияние в `main` —
  через pull request, решение владельца.


### v0.8.39 — Тарифы без иллюзии покупки
- Модал тарифов: уведомление «Биллинг не подключён», кнопки «Предпросмотр: …» вместо «Переключить». e2e-проверка. Этап 8 (оплата) — решение владельца.

### v0.8.36 — Брифинг /radar из фактов провайдера
- `RadarPage` подавал в `AiExplanationEngine` захардкоженные числа — теперь факты из провайдера, недоступные опускаются; подпись «без LLM».
  LLM (Этап 7) не подключён — решение владельца.

### v0.8.35 — Production CSP и health согласованы с кодом
- `connect-src` production-сервера и nginx расширен на Bybit/OKX/fstream/Alternative.me/DeFiLlama/mempool.space/Telegram — до этого на VPS
  все эти источники были бы молча заблокированы. Тест `cspConnectSrc.test.ts` сверяет оба CSP со всеми origin в `src/`.
- `/api/health` берёт версию из package.json (была константа 0.8.8); тест `versionConsistency.test.ts` (package ↔ Header/Footer ↔ e2e ↔ CHANGELOG).

### v0.8.34 — Журнал без выдуманных сделок; AlertService без правил по умолчанию
- Засев трёх вымышленных «бумажных сделок» удалён; журнал пуст по умолчанию, только ручной ввод в localStorage.

### v0.8.33 — /signals: пустой реестр вместо иллюстративных сетапов
- Засев удалён; хэш цепочки — настоящий SHA-256 (`src/utils/sha256.ts`). `StaticDatasetNotice` удалён: статических страниц не осталось.

### v0.8.32 — /calendar из расписания Binance Futures
- Статические FOMC/CPI/NFP удалены. Теперь: начисления фандинга (premiumIndex) и экспирации срочных контрактов (exchangeInfo).

### v0.8.31 — /onchain из mempool.space
- Статические MVRV/NUPL/стейкинг/«нетфлоу»/«сигнал модели» удалены. Теперь: хешрейт (Δ3д), сложность и ретаргет, высота, мемпул, комиссии.

### v0.8.30 — /ecosystem из DeFiLlama
- Статический набор TVL/комиссий/TPS/адресов/стейблкоинов удалён. Теперь: TVL по 10 сетям + Δ7д из `api.llama.fi`, доля L2, покрытие каталога.
- Общее для v0.8.30–0.8.32: отказ источника → «ИСТОЧНИК НЕДОСТУПЕН», без fallback; живые ответы UNVERIFIED из песочницы (сеть закрыта),
  LIVE-ветка отображения проверена стендом `scripts/qa-reference-pages-fixture.mjs`.

### v0.8.29 — Обзор без модельных констант
- Δ капитализации — производная из change24h источника; Δ объёма — против собственного снимка ≥24ч (до накопления — «Δ24ч —»).
  Удалены последние выдуманные числа LIVE-провайдера (1.85 / 4.2 / 56.4 / 14.8 / фандинг ×1.05). В `LiveMarketDataProvider`
  и `DerivativesEngine` модельных значений без пометки не осталось.

### v0.8.28 — ликвидации 24ч по инструменту из фактического потока
- `/futures` больше не показывает эвристику как факт при живом потоке: ACTUAL из конвейера (3 биржи), UNAVAILABLE «—» без событий,
  EST. только при недоступном потоке. В `DerivativesEngine` оценочными остались только величины, которых источник не отдаёт.

### v0.8.27 — Fear & Greed из Alternative.me
- Индекс на Обзоре — фактический (публичный API без ключа), при отказе — «НЕДОСТУПЕН», не 62. Живой ответ из песочницы не проверен.
  На Обзоре остаются оценочными только 24h-дельты капитализации/объёма (источник абсолютной дельты не отдаёт).

### v0.8.26 — корреляции по фактическим свечам
- `/correlations` больше не статический: матрица Пирсона и бета к BTC по дневным лог-доходностям свечей источника (окно 30 дн.).
  Макро-бенчмарки убраны (нет источника). Живые значения из песочницы не видны (сеть закрыта) — проверено на QA-свечах и unit-тестах.

### v0.8.25 — фактический Δ OI и устранение скрытого демо-фолбэка
- Δ OI 1ч/24ч по `openInterestHist` (ACTUAL) с бейджем `EST.` для эвристики; алерт OI_SPIKE работает по ACTUAL.
- **Найден и закрыт нарушитель LIVE-first:** `getFuturesList` при отказе сети отдавал демо-датасет как LIVE; радар — демо-события.
  Теперь честная ошибка/пустой список. Это касалось production v0.8.4 тоже — ещё один аргумент за деплой.

### v0.8.24 — документация: SITE_REPORT и маркировка статических страниц
- `docs/SITE_REPORT.md` — сводный отчёт по сайту (карта источников по маршрутам, UNVERIFIED-список, долги, порядок работ).
- Пять справочных страниц получили явную плашку «СТАТИЧЕСКИЙ НАБОР» (снята в v0.8.30–0.8.33 после перевода на источники); ложные подписи об обновлении убраны. README актуализирован.
- Production VPS по-прежнему v0.8.4 `6a01ce1` (20 версий позади) — деплой только по команде владельца.

### v0.8.23 — Этап 6: расширенная система алертов (Telegram / Webhook)
- Правила оцениваются по фактическим WS-тикам и REST-фандингу; история, непрочитанные, лимит тарифа; каналы В приложении / Браузер /
  Telegram Bot API / Webhook с честным журналом доставки. Секреты канала — только в localStorage пользователя (это не ключи бирж).
  Убраны «превью»/«демо»-подписи и фиктивный стартовый алерт. Этап 6 ROADMAP закрыт полностью.
- **UNVERIFIED в проде:** реальная доставка в Telegram/webhook и живые тики проверены только на моках/шине событий (внешняя сеть в песочнице
  закрыта). `OI_SPIKE` не оценивается — нет фактического источника Δ OI 1ч (в UI это явно указано).

### v0.8.22 — Этап 6: фактические потоки ликвидаций Bybit V5 и OKX
- Общий `LiquidationStreamTransport`, `BybitLiquidationStream`, `OkxLiquidationStream`; конвейер с per-exchange состоянием и идемпотентностью;
  UI-чипы состояния потоков. В песочнице внешние WS недоступны — реальный приём кадров проверен только на фикстурах формата из официальной
  документации (Bybit `T,s,S,v,p`; OKX `instId, details[bkPx,sz,side,posSide,ts]`), **живой прогон на VPS не выполнялся → UNVERIFIED в проде**.
- Остаток Этапа 6 (алерты) закрыт в v0.8.23 после «да продолжай» владельца.

### v0.8.21 — UX-цикл E: визуальная полировка
- Аудит контраста/overflow/кегля 17 маршрутов × 7 ширин × 2 темы (скрипт `polish.mjs`, результаты `screenshots/polish-e/`, gitignored).
  Исправлено: slate-500 в DARK, brand-акценты и on-accent текст в LIGHT, `text-surface-bg` (bug), overflow 390px на 3 страницах.
- **UX-цикл владельца закрыт по всем пунктам, которые имеют ТЗ (1–5, A–E).** Пп. 6 News/Articles и 7 рекламные слоты — ждут scope от
  владельца (ROADMAP так и фиксирует). Production VPS по-прежнему v0.8.4 `6a01ce1` — деплой только по команде владельца.

### v0.8.20 — UX-цикл п. 5: переставляемые модули workspace (Coin Detail)
- `src/workspace/layout.ts` (схема v1, parse/serialize/move/reorder), `useCoinWorkspaceLayout`, `WorkspaceModule` (drag-handle +
  клавиатура), кнопка сброса; unit 5 + e2e 1; инварианты графика/Pulse/провенанса сохранены.
- Пп. 6 (News/Articles) и 7 (рекламные слоты) — scope по-прежнему определяется владельцем отдельно (в ROADMAP так и записано);
  без ТЗ по ним не стартуем. Далее по ROADMAP: E «Визуальная полировка» (скриншот-QA 390–1920 в обеих темах).

### v0.8.19 — UX-цикл п. 4: темы DARK / LIGHT / SYSTEM
- Токены `--c-*` (DARK/LIGHT), Tailwind-палитры на переменных, ThemeProvider (system/prefers-color-scheme/localStorage), анти-FOUC,
  переключатель в шапке, темизация CandleChart, 148 hex-фонов → токены, `theme.test.ts` (8). Скриншоты обеих тем: `screenshots/theme-p4/`.
- Владелец снял все ограничения («выполняй по порядку») → далее п. 5 переставляемые модули workspace (Coin Detail).

### v0.8.18 — UX-цикл п. 3: типографика, контраст, иерархия
- Sans для UI, mono только для чисел/тикеров/провенанса (`font-mono tabular-nums`); минимум 11px (119 замен); ALL CAPS убран с 35 заголовков
  (uppercase 77 → 18, только чипы/шапки таблиц); компактный дисклеймер на `/liquidations`; тест-охрана `typography.test.ts`; DESIGN_SYSTEM §4.
- Проверка в headless Chromium: 5 маршрутов × 7 ширин — 0 узлов < 11px, overflow 0. Далее по порядку владельца: п. 4 DARK/LIGHT/SYSTEM
  (только после приёмки; ранее владелец просил к темам не переходить без приёмки).

### v0.8.17 — Архив стратегий C8: UI /strategies (порт архива завершён)
- Панель «Архив исследований → 13 версий» из реестра; вердикт и воспроизведение — раздельные бейджи; фильтры; сравнение только допущений
  с предупреждением о несопоставимости (V2.8 gross fees=0 ≠ V3.x net; V2.1 lump 0.1 %; TRAIN ≠ VALIDATION). Screenshot QA 390…1920 пройден.
- Итог порта: 13/13 версий, 11 REPRODUCED (реальные перезапуски), 2 SOURCE_CHAIN_VERIFIED_NOT_RERUN (V2.1a/b), `EXECUTION_CODE_PORTED = NONE`.
  На VPS не выкатывалось. Следующий шаг — приёмка владельцем; далее UX-цикл (типографика/темы) по решению владельца.

### v0.8.16 — Архив стратегий C7: V2.1a + V2.1b — реестр полон (13/13)
- V2.1a Structural Limit Entry и V2.1b Corridor Entry — обе REJECTED_ON_TRAIN, перенесены с историческими пинами (`4b25bbb`, `374b335`),
  артефактами и расхождениями D-V21A/D-V21B; раннеры на `legacy/v2`. Статус воспроизводимости честно
  `SOURCE_CHAIN_VERIFIED_NOT_RERUN` (перезапуск 1m-рядов не выполнен — OOM при 4 GB), цифры SOURCE_REPORTED, модель A V2.1a не портирована.
- `STRATEGY_ARCHIVE_PLANNED = []`. Далее C8: UI /strategies (карточки 13 версий, фильтры, verdict ≠ reproducibility) + screenshot QA, итоговый отчёт C1–C8.

### v0.8.15 — Архив стратегий C6: замороженный движок V2 + V2.2…V2.6
- `strategyArchive/legacy/v2/` — порт движка источника @ `4839074` как **изолированная архивная зависимость** (sha256 по файлам,
  DB-настройки → snapshot-ридер, `EXECUTION_CODE_PORTED = NONE`); тест гарантирует: импортируется только `definitions/v2_*`, не LIVE / BacktestEngine / UI.
- V2.2 REJECTED, V2.3 REJECTED, V2.4 FAILED_VALIDATION, V2.5 TRAIN_ONLY_NOT_VALIDATED, V2.6 REJECTED — все с историческими пинами,
  артефактами, расхождениями; headline-ветки реально перезапущены на `c3c1dce` и совпали (V2.4 — TRAIN и VALIDATION, воспроизведён провал).
- V2.7 (5 веток) и V2.8 (9 прогонов, fees=0) перезапущены через порт → `REPRODUCED`; verdicts не изменены. Реестр 11 + 2 (V2.1a/b) = 13.
  Все 71 sha-пин V2.2–V2.8 пересчитаны в клоне источника. Далее C7 (V2.1a/b), C8 (UI /strategies + screenshot QA), итоговый отчёт.

### v0.8.14 — Архив стратегий C5: V2.7 + V2.8
- Exit-логика перенесена дословно; verdicts/artifacts/pins сохранены; V2.8 помечена `GROSS_ONLY_ZERO_FEE` и несопоставима с V3.x.
  Обе версии `SOURCE_CHAIN_VERIFIED_NOT_RERUN` до порта замороженного движка V2 `4839074` (C6, только внутри архива).

### v0.8.13 — Архив стратегий C4: V3.3
- 8 прогонов воспроизведены (все поля совпали); verdict `TRAIN_ONLY_NOT_VALIDATED` — не валидированный результат, хвост хрупок.
  Headline предзаявлен; остальные — чувствительность. Далее C5 (V2.7 + V2.8, семантика комиссий), C6 (frozen V2 engine `4839074`
  как изолированная архивная зависимость), C7 (V2.1a/b…), C8 (UI /strategies + screenshot QA).

### v0.8.12 — Архив стратегий C3: V3.2
- 4 варианта воспроизведены; primary FALSIFIED; EMA50 UNPROMOTED. Далее C4 (V3.3).

### v0.8.11 — Архив стратегий C2: V3.1
- V3.1 перенесена как ОТРИЦАТЕЛЬНЫЙ результат (FALSIFIED_ON_TRAIN) и реально воспроизведена (оба варианта). Далее C3 (V3.2).

### v0.8.10 — Архив стратегий C1: V3.0 реально воспроизведена
- Реальный прогон TRAIN+VALIDATION на датасете `c3c1dce` совпал с source-артефактами по всем полям; статус `REPRODUCED`
  (evidence в `results/v30/cryptora-reproduction/`). Research verdict не изменён. План владельца C1–C8 принят; далее C2 (V3.1).

### v0.8.9 — Архив стратегий, шаг 1 (фундамент + V3.0)
- См. `docs/STRATEGY_ARCHIVE.md` и CHANGELOG 0.8.9. Источник `svechnoy-suslik-v2 @ 292050c`, датасет `c3c1dce` (не коммитится).
- Статус V3.0: **SOURCE_CHAIN_VERIFIED / NOT_RERUN** (синтетический паритет с оригинальным модулем — 100 %; реальный прогон
  на датасете в CRYPTORA не выполнялся). Расхождение D-V30-001 (перекрытие позиций) сохранено намеренно.
- Следующее решение владельца: (а) перенести V3.1 (FALSIFIED/REJECTED, обязательно сохранить вердикт) или
  (б) выполнить реальный прогон V3.0 на закреплённом датасете через `scripts/strategy-archive/reproduce-v30.mjs`.
- (Историческая запись C7.) Позднее владелец снял ограничения («выполняй, ограничения сняты, по порядку»): пункты 3–5, A–E выполнены v0.8.18–0.8.21.

### v0.8.8 — Corrective: PRODUCTION = ТОЛЬКО LIVE (пункт A по решению владельца)

**Замечание владельца к v0.8.5/v0.8.6 (пункт A принят НЕ полностью).** В production пользовательского
DEMO-режима не должно быть вообще. Оставались: (1) `cryptora_data_mode` как пользовательский способ
включить DEMO через localStorage; (2) кнопка включения DEMO в `DataSourceUnavailable`; (3) screenshot-QA
тестировал DEMO+LIVE как два пользовательских режима.

#### 1.1. Фактическое состояние до corrective (аудит ветки на `1d0bd95`)
- (2) кнопка «включить демо» в `DataSourceUnavailable` — **уже была удалена в v0.8.6** (осталось только
  «Повторить запрос»); `DemoModal` удалён, чип LIVE/WS — только статус.
- (1) `MarketDataContext` **всё ещё читал и записывал** `cryptora_data_mode` (`demo` → включал
  `DemoMarketDataProvider`) — пользовательский путь восстановления demo из localStorage существовал
  в production-сборке. **Не выполнено → исправлено.**
- (3) `scripts/screenshot-qa.mjs` по умолчанию `--mode=both` (demo + live). **Не выполнено → исправлено.**

#### 1.2. Что сделано
- **Новая политика `src/config/dataModePolicy.ts`:** `QA_FIXTURE_ALLOWED` = dev-сервер Vite
  (`import.meta.env.DEV`) **или** сборка с `VITE_CRYPTORA_QA_FIXTURE=1` (тестовые раннеры без Vite —
  Playwright/JSDOM — считаются dev). В production-бандле это статический `false`.
  `resolveInitialDataMode()` → в production **всегда `live`, хранилище не читается**; в dev/test `demo`
  только при явном ключе `localStorage.cryptora_qa_fixture = '1'`.
- **`MarketDataContext`:** режим фиксируется один раз при старте, `setDataMode` удалён из контракта,
  запись в localStorage удалена; ключ `cryptora_data_mode` больше **не читается и не пишется**
  (проверено: в `dist/assets/*.js` строка отсутствует). Проп `qaFixtureAllowed` — только для тестов,
  эмулирует production runtime.
- **Недоступный источник в production:** `DataSourceUnavailable` («Фактический источник недоступен…»
  + «Повторить запрос»), тикер/watchlist/heatmap — «НЕТ ДАННЫХ». Demo-fallback отсутствует.
- **Screenshot-QA:** `--mode` по умолчанию `live` (production-ориентированный); `--mode=qa-fixture` —
  служебный прогон только против dev-сервера; значения `demo`/`both` отклоняются с кодом 2.
- **Фикстуры не маскируются под LIVE:** QA-датасет по-прежнему маркируется `QA-ТИКЕР` / `QA-ДАТАСЕТ` / `QA`.
- **Документация:** `docs/DEPLOYMENT.md` — раздел «Политика режима данных: PRODUCTION = ТОЛЬКО LIVE»;
  `README.md`, `docs/DESIGN_SYSTEM.md` §10 — команды QA обновлены.

#### 1.3. Доказательные тесты
- **E2E `PRODUCTION runtime: DEMO недоступен даже при недоступном LIVE-источнике и любом localStorage`**
  (`e2e/flows.spec.tsx`): в хранилище заранее положены `cryptora_qa_fixture=1` и `cryptora_data_mode=demo`,
  политика = production (`qaFixtureAllowed={false}`), fetch/WS недоступны → показано честное состояние
  «источник недоступен», `LIVE-ТИКЕР`, нет `QA-ТИКЕР`, нет demo-цен, **ни одна кнопка/ссылка не содержит
  контрола включения демо**, единственное действие — «Повторить запрос».
- **Unit `tests/unit/dataModePolicy.test.ts`** (4 теста): production → всегда live при любом хранилище;
  dev → demo только по явному ключу; устаревший `cryptora_data_mode` никогда не восстанавливает demo.
- Все прочие e2e переведены с `cryptora_data_mode` на служебный ключ `cryptora_qa_fixture`.

#### 1.4. Верификация
- `npm run typecheck` — 0 ошибок; `npm test` — **177/177**; `npm run test:e2e` — **55/55**;
  `npm run build` — `dist/assets/index-BGwGjif0.js` 793.88 kB (gzip 214.76); `grep cryptora_data_mode dist/` → 0.
- **Production-oriented screenshot QA в песочнице не выполнен:** `cdn.playwright.dev` недоступен
  (`Client network socket disconnected before secure TLS connection`), локального Chromium нет.
  Команда для VPS/CI: `node scripts/screenshot-qa.mjs --tag=v088 --routes=/,/market,/liquidations,/coin/BTC`
  (режим `live` по умолчанию, против `vite preview` production-бандла).

#### 1.5. STOP
- Corrective-коммит сделан поверх текущей ветки (`ee41857` → `92b30ed` → `1d0bd95` → этот коммит), запушен.
  **К пункту B (DARK / LIGHT / SYSTEM) не переходить** до приёмки владельцем.

---

### v0.8.7 — UX-цикл п. 2: системная русификация интерфейса

**Задача (ROADMAP, UX-цикл §48 п. 2).** Снять англо-дубли в скобках, латинские заголовки блоков
(PRICE × TIME, ACTUAL EVENT LOG, ESTIMATED LIQUIDATION LEVELS, Long / Short), названия разделов
навигации; латиница — только у общепринятых аббревиатур.

#### 1.1. Метод
- Автоматический аудит JSX-текстов и строковых подписей (`label / title / aria-label / option`)
  по всем `src/**/*.tsx` с белым списком аббревиатур; ~150 подписей в 27 файлах переведены.
- Машинные enum (`RadarEventType`, `RadarSeverity`, `LONG/SHORT`, `EventImpact`) больше не выводятся
  в JSX напрямую — добавлен словарь `src/utils/labels.ts`, подключён в Обзоре, Радаре, карточке актива,
  Ликвидациях, Журнале, Стратегиях, Сигналах, Календаре и `AssetPulsePanel`.
- Языковая политика зафиксирована в `docs/DESIGN_SYSTEM.md` §11 (что остаётся латиницей:
  аббревиатуры метрик, провенанс `LIVE` / `MODEL / ESTIMATED`, биржи и потоки, тикеры, имена собственные).

#### 1.2. Что изменилось в интерфейсе
- Заголовки всех 16 страниц — без латинских дублей в скобках; бейджи режима данных унифицированы
  (`LIVE СПОТ · BINANCE / KUCOIN`, `LIVE-ДЕРИВАТИВЫ · BINANCE FUTURES`, `LIVE-ПОТОК · BINANCE FUTURES`, `QA-ДАТАСЕТ`).
- `/liquidations`: «КРИТИЧЕСКИЙ ПРИНЦИП: ФАКТИЧЕСКАЯ ЛИКВИДАЦИЯ ≠ РАСЧЁТНЫЙ УРОВЕНЬ», «Тепловая карта плотности
  ликвидаций: цена × время», «Расчётные уровни ликвидаций по плечам», «Журнал фактических событий ликвидаций»,
  «Ликвидации лонгов / шортов», «Бары по UTC». Инварианты heatmap (2D, `MODEL / ESTIMATED`, провенанс входа) сохранены.
- Шапка/подвал/тикер/стакан: «Открыть избранное», `WS ОНЛАЙН / ОЖИДАНИЕ`, `LIVE-ДАННЫЕ РЫНКА`, `LIVE-ТИКЕР`,
  «Рыночный радар», «Лаборатория стратегий (превью)», «СТАКАН ЗАЯВОК (L2)», «СРЕДНЯЯ ЦЕНА».
- Фильтры/пресеты/поля: типы аномалий и важность радара, секторы рынка и скринера, пресеты скринера,
  названия стратегий, «Стоп-лосс / Тейк-профит», «Доля прибыльных», «Профит-фактор», «Коэффициент Шарпа».
- Ничего в слое данных, провайдерах, схемах Zod и `data-qa`-контрактах не менялось.

#### 1.3. Верификация
- `npm run typecheck` — 0 ошибок; `npm test` — **173/173**; `npm run test:e2e` — **54/54**
  (контракты e2e переведены на новые подписи; там, где русское слово встречается и в подвале, селекторы
  ужесточены до `heading` / точного совпадения); `npm run build` — `dist/assets/index-BMqh0xKE.js`
  793.66 kB (gzip 214.59).
- Браузерный скриншот-QA в этой сессии **не выполнялся**: `cdn.playwright.dev` недоступен, локального
  Chromium в песочнице нет. Русские подписи длиннее английских — визуальную приёмку заголовков на 390 / 1024 /
  1280 px рекомендуется выполнить на VPS (риск: перенос длинных `h1` на вторую строку, что допустимо).
- Версия `0.8.7` синхронизирована: `package.json`, `package-lock.json`, шапка (2 места), подвал, e2e-инвариант
  версии, health-эндпоинт `server/productionServer.js` (там оставалось `0.8.1`).

#### 1.4. Следующий подэтап
- Пункт **3** цикла: типографика + контраст + иерархия (sans для UI, mono только для чисел/тикеров, меньше
  ALL CAPS, единые уровни заголовков, компактный дисклеймер «фактическая ≠ расчётная», компактные пустые состояния).
  Запуск — строго по команде владельца.

---

### v0.8.6 — UX-цикл п. 1: LIVE-first cleanup (Demo UX выведен из production)

**Задача (handoff §47.5–§47.7, §48.1).** Production всё ещё содержал демонстрационный UX: кнопку
«Подробнее о Demo-режиме» в подвале, демонстрационный дисклеймер, а чип LIVE/WS в шапке работал как
переключатель режима данных. Требовалось: удалить Demo UX, оставить LIVE/WS как статус соединения,
русифицировать и почистить подвал.

#### 1.1. Удалено
- `src/components/layout/DemoModal.tsx` (113 строк) — единственная точка смены режима — удалён;
  из `MarketDataContext` убраны `isDemoModalOpen / openDemoModal / closeDemoModal`, из `App.tsx` — рендер.
- Подвал: кнопка «Подробнее о Demo-режиме» и упоминание демонстрационного режима.
- Обзор: кликабельная карточка «РЕЖИМ СИСТЕМЫ → Демонстрационный» и кнопка «Ограничения этапа».
- `DataSourceUnavailable`: кнопка включения демонстрационного режима заменена на действие «Повторить запрос».

#### 1.2. Изменено
- Чип источника в шапке (desktop и < 640px) и в мобильном меню — `role="status"`, не кнопка:
  `LIVE SPOT` + `WS ●/⟳` в фактическом режиме, `QA-ДАТАСЕТ` во внутреннем. Пункт «LIVE / WS оставить как
  connection status» выполнен.
- Карточка режима на Обзоре — индикатор «РЕЖИМ ДАННЫХ»: источник и состояние WebSocket («нет соединения»,
  «подключение», «переподключение», «подключен»).
- Терминология внутреннего датасета: `QA TICKER`, `QA DATASET`, `QA-СВЕЧИ`, `QA-СЕТКА`, `QA-СРЕЗ`,
  `QA-ДАТАСЕТ`, «Слой данных: QA-датасет», «Пары на ведущих биржах (QA-датасет)», «Очередь прототипа».
  Слово «демонстрационный» в пользовательских подписях не встречается.

#### 1.3. Верификация
- `npm run typecheck` — 0 ошибок; `npm test` — 173/173; `npm run test:e2e` — **54/54**;
  `npm run build` — `dist/assets/index-fym-X7IT.js` 791.47 kB (gzip 214.33) + `index-BT_4Ecuv.css`.
- Скриншот-QA `screenshots/v086/`: 9 маршрутов × 7 viewports × DEMO+LIVE = 126 проверок, 0 нарушений.
- ⚠️ Особенность инструмента: в headless-chromium full-page захват иногда не отрисовывает canvas-слой
  Lightweight Charts (кадр `/coin/ETH` 1366 выглядит пустым). Проверено element-скриншотом карточки
  графика — свечи и объёмы рендерятся корректно на 1280 и 1366. Это артефакт захвата, не дефект вёрстки.

#### 1.4. Следующий подэтап
- Пункт **2** цикла: системная русификация (снятие англо-дублей в скобках, латинские заголовки блоков
  карты ликвидаций, названия разделов навигации), затем 3 типографика + контраст + иерархия.

---

### v0.8.5 — UX/DS п. A: LIVE-first production UX (убрано глобальное демо)

**Задача.** Интерфейс одновременно показывал LIVE-источники и демо-данные: полоса котировок всегда
рендерила `DEMO_ASSETS`, «Тепловая карта рынка» брала `DEMO_FUTURES`, режим по умолчанию был `demo`,
а ни одна страница не обрабатывала отказ фактического источника (вечная загрузка либо пустой экран).

#### 1.1. Режим данных
- Продуктовый режим по умолчанию — `live` (`MarketDataContext`). ~~Демо включается явным выбором
  пользователя и сохраняется в `cryptora_data_mode`~~ — **отменено владельцем, см. v0.8.8:** в production
  DEMO недоступен вообще, ключ `cryptora_data_mode` больше не используется.
- Роли определены: `LIVE + провенанс` → `DERIVED / MODEL / ESTIMATED + методика` → `НЕТ ДАННЫХ`.
  Подмена недоступного LIVE-источника демо-значениями запрещена (RULES §3.1).

#### 1.2. Runtime-компоненты без демо-констант
- `MarketTicker` работает от активного провайдера, метка источника соответствует режиму, пустой ответ —
  честное сообщение (`data-qa="ticker-source-state"`).
- `WatchlistDrawer` — данные из провайдера, при сбое `data-qa="watchlist-unavailable"`.
- `HeatmapGrid` — OI/фандинг из провайдера; убраны производные значения (`marketCap * 0.05`, фандинг по
  умолчанию `0.01%`), вместо них плитка «НЕТ ДАННЫХ».
- `Header` (поиск) и `AlertsModal` — статический каталог `CANONICAL_ASSETS`; метрика 24h показывается
  только при фактическом ответе провайдера.
- `Footer` — строка слоя данных соответствует режиму.

#### 1.3. Честная деградация страниц
- Новый компонент `DataSourceUnavailable` (единое состояние «источник недоступен»; ~~кнопка явного
  включения демо-режима~~ удалена в v0.8.6, в v0.8.8 подтверждено тестом production runtime).
- Подключён к: Обзор, Рынок, Фьючерсы, Скринер, Радар, Тепловая карта, Стратегии, Ликвидации, Карточка
  актива. Обработаны отказы всех провайдерных вызовов — вместо «вечной загрузки» пользователь видит
  честный статус.

#### 1.4. Верификация
- `npm run typecheck` — 0 ошибок; `npm test` — 173/173; `npm run build` — `dist/assets/index-YYuAKLll.js`
  798.12 kB (gzip 215.61) + `dist/assets/index-C-u_X6yq.css` 54.56 kB (gzip 10.08);
  `npm run test:e2e` — **53/53** (+3 теста LIVE-first: режим по умолчанию, честное состояние при
  недоступном источнике без демо-чисел, сохранение доступа к демо-режиму явным выбором).
- Скриншот-QA расширен до **9 маршрутов** (`/`, `/market`, `/futures`, `/liquidations`, `/heatmaps`,
  `/radar`, `/screener`, `/strategies`, `/coin/ETH`) × 7 viewports (390 / 768 / 1024 / 1280 / 1366 /
  1440 / 1920) в режимах DEMO и LIVE: **126 проверок, 0 нарушений** вёрстки (горизонтальный overflow,
  offscreen, clipped) — `screenshots/v085/qa-report-v085.json`; ключевые кадры просмотрены визуально,
  дефект `/market @768` (+178px) найден этим прогоном и исправлен (см. 1.5).
- ⚠️ Реальное соединение с биржами из песочницы недоступно: LIVE-ветка проверена на честной деградации,
  а контракт отображения LIVE-данных — на детерминированных фикстурах (`/tmp/qa-live-fixture.mjs`).

#### 1.5. Финальная зачистка демо-подписей и фикс вёрстки (по итогам расширенного QA)
- Шапки страниц, показывавшие демо-подписи независимо от режима, стали режимными: `/market` (бейдж
  «30 ДЕМО-АКТИВОВ» → `LIVE SPOT (BINANCE / KUCOIN)`, подпись страницы), `/screener` (бейдж
  «ДЕМО-ДАТАСЕТ» и подпись), верхняя полоса Обзора («КОМАНДНЫЙ ЦЕНТР: LIVE-ДАННЫЕ…» вместо
  демонстрационной формулировки).
- Обзор: карточка BTC больше не рисует фиксированные `$64,850.25 / +3.18% / SMA20 $63,877 /
  SMA50 $62,386 / RSI-14 68.4` — цена и 24h-дельта берутся из провайдера, SMA/RSI считает
  `IndicatorEngine` по фактическим свечам, при отсутствии данных — «НЕТ ДАННЫХ» / «—»; фиктивная строка
  «24h дельта: +$64.8B» удалена; подпись стола `/market` отражает источник («Источник: Binance Spot /
  KuCoin» либо «Источник недоступен»).
- Модельные метрики Обзора (24h-дельты капитализации и объёма, индекс жадности) в LIVE помечены
  `EST.` / `MODEL / ESTIMATED` с пояснением, что источник значение не отдаёт.
- Превью-карточка сетапа: «LONG SETUP DEMO» → «ПРИМЕР СЕТАПА (НЕ СИГНАЛ)». Карточка актива: текст
  «не зарегистрирован в демонстрационной базе данных» → «отсутствует в реестре инструментов терминала».
- **Fixed:** `/market @768` — горизонтальный overflow документа +178px (шапка включала row-layout на
  `md:`): брейкпоинт перенесён на `lg:`, кластеры получили `min-w-0`, ряды чипов (категории Market,
  пресеты Screener) переведены со «обрезаемого» скроллера на перенос строки.

#### 1.6. Следующий подэтап
- Пункт **B**: семантические design tokens и темы `DARK / LIGHT / SYSTEM` (включая темизацию графиков),
  затем C (типографика), D (переставляемый workspace), E (визуальная полировка).

---

### v0.8.4 — Этап 6, пункт 2: тепловая карта плотности ликвидаций (2D: цена × время)

**Задача.** Раздел ликвидаций показывал только таблицу плечевых тиров. Требовалось добавить полноценную
аналитическую тепловую карту плотности (2D-визуализация цены и времени) поверх расчетной модели
`MODEL / ESTIMATED`, не смешивая её с фактическим потоком событий и не подставляя случайные значения.

#### 1.1. Детерминированный построитель модели (`src/services/liquidations/LiquidationHeatmap.ts`)
- Уровни принудительного закрытия считаются как `цена_закрытия × (1 ∓ 1 / плечо)` для тиров
  **10x / 25x / 50x / 100x** при равномерном распределении открытого интереса по тирам (без
  искусственного усиления веса высоких плеч).
- Вклад каждой свечи взвешивается её объёмом (`min(1.5, объём / средний объём)`); размытие по
  соседним ценовым строкам — фиксированное ядро `[0.3, 1, 0.3]`.
- Сетка ограничена 64 временными колонками × 28 ценовыми строками; интенсивность нормируется в 0…1.
- Диапазон цены покрывает **все** уровни модели (включая дальние зоны 10x) — уровни больше не
  «слипаются» в крайние строки и не создают ложных краевых пиков.
- Временная ось — UTC-тики (`dd.mm hh:00`), не более шести подписей: первая привязана к левому краю,
  последняя — к правому, чтобы подписи не наезжали и не выходили за карточку.
- Функция `build()` возвращает `null`, если свечей меньше восьми или нет валидной метки цены
  (честный отказ вместо «примерных» зон). Случайных значений нет: повторный вызов на тех же входах
  даёт тот же результат (проверено тестом на побитовое совпадение JSON).

#### 1.2. Секция карты (`src/components/market/LiquidationHeatmap.tsx`)
- Постоянный бейдж `MODEL / ESTIMATED` + плашка провенанса входных свечей: `ВХОД: DEMO-СВЕЧИ`
  либо `ВХОД: ФАКТИЧЕСКИЕ СВЕЧИ` (определяется по провенансу свечей, а не по режиму UI).
- Пояснение методики в шапке секции: расчётные светлые зоны ≠ фактические ордера и не уровни
  отдельных бирж; на странице сохраняется принцип `ACTUAL LIQUIDATION EVENT ≠ ESTIMATED LIQUIDATION LEVEL`.
- Легенда плотности (низкая → высокая), метка текущей цены, ось цены и ось времени (UTC).
- Полотно — DOM-строки с градиентами (по одной строке на ценовой уровень), а не canvas: карта
  проверяема скриншот-стендом и доступна как текстовая альтернатива (`role="img"` с описанием).
- Пустое состояние: «карта не построена» с пояснением, почему оценочные зоны не подставляются.

#### 1.3. Интеграция в страницу (`src/pages/LiquidationsPage.tsx`)
- Карта получает те же входы, что и модель кластеров: исторические свечи BTC (`4h`), метка цены и
  открытый интерес; ничего дополнительно не «дорисовывается».
- Нижний блок переименован в «Расчетные уровни плечевых тиров (Estimated Liquidation Levels)» и
  маркирован `MODEL / ESTIMATED` — устранено дублирование названия «тепловая карта» и снята
  двусмысленность с фактическим журналом событий.

#### 1.4. Верификация
- `tests/unit/liquidations.test.ts`: **24 → 33 теста** (+9 тестов построителя: детерминизм, нормировка
  0…1 и наличие пика, маркировка провенанса DEMO/FACTUAL, честный отказ, покрытие диапазоном уровней
  всех тиров, различимость полос 10x/25x/50x/100x, отсутствие ложных краевых пиков, границы
  временной шкалы).
- E2E: +1 тест контракта секции (маркировка `MODEL / ESTIMATED`, провенанс, 28 ценовых строк,
  сохранение разделения фактического журнала и расчетной модели) — прогон **50/50**.
- Скриншот-QA DEMO `/liquidations` на 390 / 768 / 1024 / 1280 / 1366 / 1440 / 1920 — `overflow`,
  `offscreen`, `clipped` = 0 (`screenshots/v084b/`).
- Скриншот-QA LIVE на детерминированных фикстурах Binance REST (`/tmp/qa-live-fixture.mjs
  --profile=liquidations`): карта строится из свечей с провенансом (`ВХОД: ФАКТИЧЕСКИЕ СВЕЧИ`),
  бейдж `MODEL / ESTIMATED`, 28 строк, ноль нарушений вёрстки на всех семи viewport
  (`screenshots/v084live/`). ⚠️ Реальное соединение с биржами из песочницы недоступно: проверена
  вёрстка и контракт отображения на фикстурах, а не фактический канал.

#### 1.5. Что осталось по Этапу 6 (следующие пункты)
- [ ] Пункт 3: расширенная система алертов — фактическая доставка Telegram / Webhook.
- [ ] Пункт 4: потоки ликвидаций других бирж (Bybit V5 `allLiquidation`, OKX) и аудит остальных
      мест с `isDemo: false` (`AnomalyEngine`, `DerivativesEngine`, `LiveMarketDataProvider`).

---

### v0.8.3 — Аналитическая рабочая область Coin Detail (graph + Derivatives/Liquidation Pulse)

**Задача.** Главная область под asset header была full-width графиком (380px). Требовалось превратить её
в рабочую область: снимок деривативов и ликвидаций по текущему активу рядом с графиком, не переделывая
дизайн и шапку, не меняя market-data архитектуру и не добавляя фиктивных значений.

#### 1.1. Раскладка рабочей области (`src/pages/CoinDetailPage.tsx`)
- Область графика обёрнута в `grid grid-cols-1 xl:grid-cols-[72fr_28fr]` с `items-start`:
  от 1280px график занимает ~72%, правая колонка ~28%; ниже 1280px снимок складывается под графиком.
- Высота графика: 460px от 1280px (в требуемом диапазоне 440–470px) и 340px на мобильных;
  график остаётся визуально доминирующим элементом.
- Правая колонка — `xl:sticky xl:top-[70px]`, чтобы снимок оставался в поле зрения при скролле.
- QA-атрибуты `data-qa="coin-workspace"` / `data-qa="coin-chart-card"` используются браузерным стендом.

#### 1.2. Снимок по активу (`src/components/market/AssetPulsePanel.tsx`)
Три компактных блока, только по текущему инструменту (не дублируют нижние детальные секции):
1. **Liquidation Pulse** — Long/Short 24ч, доли, ratio-полоса, наиболее значимые события, ссылка
   в `/liquidations`.
2. **Деривативы** — открытый интерес, OI Δ24ч, фандинг 8ч, базис, ссылка в `/futures`.
3. **Перекос потока (DERIVED)** — композитный индикатор на фиксированных весах с разложением по
   компонентам и явной пометкой «не является торговым сигналом».

#### 1.3. Доменная логика (`src/services/liquidations/LiquidationPulse.ts`)
- Приоритет источника данных: **FACTUAL** (фактические события потока по активу) → **DEMO** →
  **ESTIMATED** (модельная оценка движка деривативов, всегда с предупреждением) → **UNAVAILABLE**
  (пустое состояние с пояснением). Никаких случайных или «примерных» чисел.
- Композитный индикатор: ликвидации 40 + фандинг 25 + OI 15 + цена 20, диапазон −100…+100,
  порог перевеса ±25; формула детерминирована и покрыта тестами.

#### 1.4. Нижние секции: устранение дублей и плотность
- Карточка «Деривативы и фьючерсы» → **«Деривативы: детали контракта»**: убраны метрики, дублирующие
  снимок (OH, OI Δ24ч, фандинг 8ч), добавлены Mark/Index, спред метки, прогноз фандинга, OI Δ1ч,
  ссылка на `/futures`. Полезная детальная аналитика сохранена.
- Три карточки нижнего ряда уплотнены (`p-3.5 space-y-2.5`) без уменьшения кегля.

#### 1.5. Исправления в графике (`src/components/common/CandleChart.tsx`)
- Плашка источника данных определяется провенансом ряда: `LIVE · BINANCE` для фактических свечей,
  `DEMO СВЕЧИ` для синтетических (ранее была жёстко зашита надпись DEMO).
- Ширина графика синхронизируется с контейнером (ResizeObserver + подгонка при монтировании) —
  canvas не остаётся шире карточки после смены раскладки.

#### 1.6. Верификация
- `tests/unit/liquidations.test.ts`: 24 теста (+6 тестов `LiquidationPulse`: приоритет факта, маркировка
  ESTIMATED, демо-набор, пустое состояние, детерминизм индикатора, матчинг символов).
- E2E: 49 тестов (+1 контракт рабочей области Coin Detail: раскладка 72/28, состав снимка, переходы).
- Screenshot QA: `/coin/ETH` × 390/768/1024/1280/1366/1440/1920 — 0 нарушений overflow/clipping;
  DEMO-режим проверен штатным стендом, LIVE-ветка — стендом детерминированных биржевых фикстур
  (в песочнице исходящая сеть к биржам закрыта, поэтому фактический LIVE-ответ получить нельзя;
  штатный стенд в LIVE фиксирует честную ветку «Актив не найден» из-за недоступности источника).

### v0.8.2 — Этап 6, пункт 1: фактический поток ликвидаций и честность данных

**Проблема, обнаруженная при сверке кода с ТЗ (`docs/ROADMAP.md`, `RULES.md`, `AGENTS.md`).** Модуль
ликвидаций формально числился выполненным, но фактически нарушал базовые инварианты проекта:

1. `LiquidationPipeline.getLiquidationSnapshot()` **фабриковал данные**: при отсутствии событий подставлял
   Long $62M, Short $28M, итог $90M, «крупнейшее событие» $1.25M, разбивку бирж 52/28/20% и таймлайн из
   фиксированных баров. Пользователь видел эти суммы как фактические.
2. Предзаполненные события хранились с флагом `isDemo: false` — прямое нарушение обязательной маркировки
   демо-данных (RULES §1).
3. Метод `processBinanceForceOrder()` **не вызывался ниоткуда** — заявленного в ROADMAP WebSocket-потока
   фактических ликвидаций не существовало; бейдж `LIVE STREAM (BINANCE FUTURES)` с пульсирующей точкой
   отображался поверх синтетических чисел.
4. В идентификаторах событий использовался `Math.random()` (RULES §3).
5. Кластеры риска считались от зашитых констант (`65000`, `$15B`), а не от рыночных метрик.

#### 1.1. Новый транспорт фактического потока
- **`src/services/realtime/BinanceFuturesLiquidationStream.ts`** — подписка на публичный поток
  `wss://fstream.binance.com/ws/!forceOrder@arr` (Binance USD-M Futures), реконнект с экспоненциальной
  задержкой (1.5s → 30s, максимум 10 попыток), состояния `idle / connecting / connected / reconnecting /
  unavailable`, разбор как одиночных, так и батчевых кадров агрегированного потока.
- **`RealtimeFeedManager`**: поток создаётся в конструкторе и управляется жизненным циклом —
  `connect()` (LIVE-режим) / `disconnect()` (DEMO-режим). Только чтение публичных рыночных данных:
  без API-ключей, без торгового исполнения.

#### 1.2. Конвейер переписан на принцип «нет данных — значит нет данных»
- Агрегаты, разбивки по биржам и активам, крупнейшее событие и 3-часовые бары хронологии считаются
  **исключительно** из фактически принятых событий; скользящее окно — 24 часа (`pruneExpired`).
- При отсутствии событий возвращаются нули, `largestEvent: null`, пустые массивы разбивок.
- Добавлен тип `LiquidationDataStatus` (`src/types/market.ts`): `LIVE_STREAM` / `AWAITING_STREAM` /
  `UNAVAILABLE` / `DEMO`, а также поля `eventsCount24h` и `lastEventAt`.
- События биржевого потока помечаются `isDemo: false` только по факту приёма из WS; `Math.random()`
  в идентификаторах заменён на детерминированный ключ `liq-<symbol>-<timestamp>-<price>-<qty>`.

#### 1.3. UI: деградация вместо заглушек (`LiquidationsPage.tsx`, `OverviewPage.tsx`)
- Бейдж `LIVE STREAM (BINANCE FUTURES)` показывается **только** при статусе `LIVE_STREAM`; при
  `AWAITING_STREAM` — «ПОТОК ПОДКЛЮЧЕН · ОЖИДАНИЕ СОБЫТИЙ», при `UNAVAILABLE` — «ПОТОК ЛИКВИДАЦИЙ
  НЕДОСТУПЕН» с пояснением, что оценочные суммы не подставляются.
- Пустые состояния для хронологии, разбивок и журнала событий; блок Long/Short ratio скрывается при
  нулевом объеме; шкала баров выводится из фактических данных, а не из константы `35M`.
- Блок Обзора (Overview) больше не показывает агрегаты и whale-событие при отсутствии фактического потока.
- Кластеры риска строятся от метки цены и открытого интереса, полученных от провайдера, с маркировкой
  `MODEL / ESTIMATED` и указанием провенанса входных метрик (фактические либо демонстрационные).
- Страница обновляет срез каждые 5 секунд, пока открыта.

#### 1.4. Верификация пункта 1
- `tests/unit/liquidations.test.ts`: **5 → 18 тестов** (8 тестов инвариантов честности + 5 тестов транспорта).
  Переписаны два теста, которые сами закрепляли фабрикацию данных (`dataProvider`-тест и тест live-провайдера
  требовали `total24h > 0` при пустом конвейере).
- `tsc --noEmit` — 0 ошибок; `vitest` — 158 тестов; `npm run build` — чисто; E2E — 48 тестов.
- Screenshot QA `screenshots/p1liq3/`: `/liquidations` × 5 viewport × {DEMO, LIVE} — 0 нарушений
  overflow / clipping / overlap; страница визуально проверена в обоих режимах.
- В песочнице исходящая сеть к биржам закрыта, поэтому LIVE-режим корректно демонстрирует ветку
  `UNAVAILABLE`: фактические суммы отсутствуют, выдуманные не подставляются.

#### 1.5. Что осталось по Этапу 6 (следующие пункты)
- [x] Пункт 2: аналитическая тепловая карта плотности (2D цена × время) поверх модели `MODEL / ESTIMATED` — закрыт в v0.8.4.
- [ ] Пункт 3: расширенная система алертов — фактическая доставка Telegram / Webhook.
- [ ] Пункт 4: потоки ликвидаций других бирж (Bybit V5 `allLiquidation`, OKX) и аудит остальных
      мест с `isDemo: false` (`AnomalyEngine`, `DerivativesEngine`, `LiveMarketDataProvider`).

---

## 1. Что сделано

### v0.8.1 — Исправление реального UI-регресса шапки + полировка Coin Detail

**Проблема, подтверждённая фактической проверкой production:** на реальном desktop viewport ~1280px
правая часть header не помещалась — после контролов `LIVE SPOT / WS` элементы (поиск, избранное, алерты,
гамбургер) уходили за пределы вьюпорта и клипались. Прежний автотест регресс пропустил: он работал
в JSDOM (без реального расчёта layout) и проверял лишь наличие ссылок и CSS-класс `whitespace-nowrap`.
Дополнительно визуальная проверка вскрыла критичный функциональный дефект: свечной график не рендерился.

#### 1.1. Архитектурный рефакторинг responsive header (`src/components/layout/Header.tsx`, `navigation.ts`)
- **Единая модель навигации** вынесена в `src/components/layout/navigation.ts`: `PRIMARY_NAV_ITEMS`,
  `ANALYTICS_NAV_ITEMS`, `TOOLS_NAV_ITEMS`, `ALL_NAV_PATHS`, `PRIMARY_NAV_CAPACITY`. Единый источник
  правды для шапки, мобильного drawer и тестов.
- **Бюджет ёмкости:** прямая навигация — строго **6 пунктов** (обосновано замерами: 6 пунктов кеглем
  13px гарантированно помещаются в одну строку вместе с сервисными контролами на 1280px).
- **Стеккинг вместо сжатия:** в диапазоне `1024–1279px` навигация переходит в отдельную строку
  (`order-3 w-full border-t`), а не уменьшает текст; от `1280px` возвращается в первую строку
  (`xl:order-2 xl:w-auto xl:flex-1 xl:border-t-0`).
- **Каскад сжатия вторичных service controls** (в порядке приоритета): слоган бренда и бейдж версии →
  чип тарифа → inline-поиск (от `1440px`; ниже — компактная иконка поиска с раскрывающейся панелью
  под шапкой) → текстовая плашка режима данных (`LIVE SPOT`/`ДЕМО-ДАННЫЕ` от `1440px`,
  `LIVE`/`ДЕМО` от `640px`, иконка с индикатором ниже `640px`). Кнопки Watchlist и Alerts не сжимаются никогда.
- **Читаемый кегль primary navigation:** 13px, 14px от `1536px`. Микротекст 9–10px в шапке устранён
  полностью (минимальный порог — 11px).
- **Новые кастомные точки перехода** (`tailwind.config.js`, порядок media-запросов документирован):
  `lg 1024`, `navmd 1152`, `xl 1280`, `navxl 1440`, `2xl 1536`, `nav2xl 1700`.
- **Мобильный drawer:** статусная строка (режим данных, `WS ONLINE/IDLE`, тариф), сетка разделов,
  закрытие по Escape / клику по роуту.

#### 1.2. Исправлен функциональный баг свечного графика (`CandleChart.tsx`)
- `lightweight-charts` вызывал `Date.toLocaleString(navigator.language, ...)`. При невалидном системном
  теге локали (например `en-US@posix` — типовая ситуация в минимальных контейнерах/на серверах без LANG)
  вызов бросал `RangeError` для каждой метки времени, из-за чего **свечи и объёмы не рендерились вовсе**
  (оставался только водяной знак TradingView). Добавлена явная `localization.locale: 'en-US'`.
- Проверено попиксельным анализом canvas: было 0 цветных пикселей из 45 000, стало 74 901 из 430 848 (17.4%).

#### 1.3. Полировка Coin Detail (`CoinDetailPage.tsx`, `OrderBookL2.tsx`, `Badge.tsx`)
- Устранён микротекст: нижний порог кегля — 11px (`Badge xs`, метаданные стакана), значения
  индикаторов и заголовки таблиц — 12px, заголовки карточек — 13px.
- Уменьшены избыточные пустые вертикальные области перед disclaimer/footer: отступ страницы
  `space-y-4 → space-y-3.5`, футер `mt-14 py-8 → mt-6 py-6`, внутренние интервалы `space-y-6 → space-y-5`.
- Сохранён визуальный приоритет графика (высота области свечей 380px при полной ширине карточки).
- Количество bordered-карточек **не увеличено**; premium dark стилистика сохранена.

#### 1.4. Новые инструменты регрессионной защиты
- **`scripts/screenshot-qa.mjs`** — браузерный QA-прогон Chromium через Playwright: фактические
  скриншоты (`header` / `viewport` / `full`) и измерения: `document.scrollWidth` vs viewport,
  элементы шапки за пределами вьюпорта, клиппинг контента в контейнерах, **пересечения кластеров шапки**
  (именно этот дефект пропускали прежние assertions), кегль навигации, свободное место в строках,
  пустые вертикальные зоны перед футером. Поддержка `--mode=demo|live`, `--viewports`, `--routes`,
  `--base`, `--tag`, подстановка локальных WOFF2-сабсетов Inter / JetBrains Mono для метрик продакшена.
- **`tests/unit/navigation.test.ts`** — 6 контрактных тестов модели навигации.
- **`e2e/uiRegression.spec.tsx`** расширен до 9 тестов; **`e2e/responsive.spec.tsx`** — с 5 до 7
  контрольных брейкпоинтов (добавлены реальные проблемные ширины 1280 и 1366).
- **Герметичность E2E (`e2e/setup-dom.ts`):** добавлены заглушки `fetch` и `WebSocket`
  (Node.js экспонирует их глобально) — тесты не выполняют реальных сетевых вызовов;
  добавлен экспортируемый `resetBrowserStorage()` с регистрацией в каждом spec-файле
  (ES-модуль кэшируется на процесс воркера, из-за чего хук внутри `setup-dom.ts`
  применялся бы только к первому файлу и режим LIVE протекал в последующие тесты).

### Предыдущие этапы (v0.8.0 — Premium Dark Redesign)
- Архитектурный реинжиниринг хедера (первичные разделы + группированные dropdown `Аналитика ▾` / `Инструменты ▾`).
- Дизайн-система и токены поверхностей (`tailwind.config.js`, `src/index.css`, `docs/DESIGN_SYSTEM.md`).
- Визуальная модернизация Overview, MarketTicker, HeatmapGrid, Futures, Liquidations, Screener, Radar, Tools, PortfolioRisk, Market.

### Предыдущие этапы (Инфраструктура и Аналитика v0.7.1)
- **Этап 17 (Портфельный риск & VaR):** 1-Day VaR (95%/99%), беты к BTC, концентрация HHI, 4 стресс-сценария.
- **Инфраструктура:** Node.js production HTTP/SPA сервер, Nginx конфиг, Systemd юнит, CLI скрипты.
- **Специализированные разделы:** Макро-календарь, L1/L2 экосистемы, матрица корреляций, он-чейн/Netflow,
  дневник трейдера, монетизация/тарифы, AI-ассистент, аудит-лог сетапов.

---

## 2. Что НЕ сделано (Намеренно отложено согласно дорожной карте)
- WebSocket-потоки фактических биржевых ликвидаций и тепловые карты плотности ликвидаций (Этап 6).
- **И отдельно:** ТОРГОВОЕ ИСПОЛНЕНИЕ, ТОРГОВЫЕ БОТЫ, КАСТОДИ И ТОРГОВЫЕ API-КЛЮЧИ ПОЛНОСТЬЮ ИСКЛЮЧЕНЫ И НИКОГДА НЕ БУДУТ РЕАЛИЗОВАНЫ.

---

## 3. Результаты тестов (все гейты пройдены)

- **Актуально на v0.8.50 (2026-09-20, песочница Arena):** typecheck (`npm run typecheck`) — 0 ошибок;
  unit (`npm test`) — **passed без регрессий** (873 → 881 с новыми тестами: финальные цифры в CHANGELOG 0.8.50);
  build (`npm run build`) — чистая production-сборка. (Фактический прогон перед commit; e2e по-прежнему
  не прогонялся — CDN Playwright закрыт в песочнице.)
- **E2E в песочнице НЕ прогонялся:** `npx playwright install chromium` недоступен (CDN Playwright
  закрыт фаерволом контейнера, системные пакеты недоступны). E2E-набор не изменялся
  (кроме строки версии в `e2e/uiRegression.spec.tsx`); прогнать на машине с сетью перед деплоем.
- **Актуально на v0.8.17 (`684aa05`):** typecheck 0 ошибок; unit **34 файла / 333 теста** (из них `tests/unit/strategyArchive/*` —
  реестр 13/13, immutability, sha256-пины, детерминизм/digest, look-ahead guard, комиссии, паритет перезапусков, presentation-модель);
  build чистый; e2e **55** (в т.ч. `/strategies`: 13 карточек, verdict ≠ reproducibility, фильтры, предупреждение V2.8 vs V3.0);
  screenshot QA архива 390/768/1024/1280/1366/1440/1920 — overflow 0px (`screenshots/archive-c8/`).
- Ниже — исторический срез v0.8.8 (сохранён как справка):
- **Typecheck (`npm run typecheck`):** PASSED — 0 ошибок TypeScript (`tsc --noEmit`).
- **Unit Tests (`npm test`):** PASSED — 24 тестовых файла, **145 тестов** (включая 6 новых контрактных
  тестов модели навигации `tests/unit/navigation.test.ts`).
- **Build (`npm run build`):** PASSED — чистая production-сборка (`tsc -b && vite build`):
  - `dist/index.html` (1.48 kB)
  - `dist/assets/index-C8SlWmCO.css` (52.99 kB │ gzip: 9.74 kB)
  - `dist/assets/index-oeKxuew5.js` (757.09 kB │ gzip: 204.94 kB)
  - Предупреждение о размере чанка > 500 kB — известное ограничение (code-splitting отложен), не ошибка.
- **Playwright E2E (`npm run test:e2e`):** PASSED — **48 тестов**, стабильно (3 полных прогона подряд):
  - 20 тестов сетевых маршрутов (`e2e/routes.spec.ts`);
  - 11 тестов пользовательских сценариев (`e2e/flows.spec.tsx`);
  - 8 адаптивных смоук-тестов (`e2e/responsive.spec.tsx`: 390, 768, 1024, 1280, 1366, 1440, 1920);
  - 9 UI-регрессионных тестов (`e2e/uiRegression.spec.tsx`: бюджет ёмкости, минимальный кегль
    в обоих режимах данных, stacking-режим, каскад сжатия контролов, dropdowns, мобильный drawer).
- **Screenshot QA (`node scripts/screenshot-qa.mjs`):** PASSED — **28/28 комбинаций** (2 маршрута ×
  7 viewport'ов × 2 режима данных: demo и live) без единого layout-нарушения:
  - 390×844, 768×1024, 1024×768, 1280×800, 1366×768, 1440×900, 1920×1080;
  - горизонтальный overflow документа: **0px** на всех;
  - элементы шапки за пределами вьюпорта: **0**; клиппинг контента: **0**; наложения кластеров: **0**;
  - кегль навигации: **13px** (14px от 1536px);
  - свободное место в строке шапки с навигацией: **+16px** (при `free = rowW − brand − nav − controls − gaps`);
  - дополнительно проверено по ширине: 320, 344, 360, 390, 414, 480, 540, 640, 700, 768, 834, 900, 960,
    1024, 1080, 1120, 1152, 1200, 1280, 1300, 1366, 1400, 1439, 1440, 1600, 1700, 1800, 1919, 1920, 2200, 2560px;
  - отдельный прогон на **собранном production-бандле** (`vite preview`, порт 4173) — также 0 нарушений.
- **Визуальная проверка скриншотов:** выполнена по каждому контрольному viewport (1024, 1280, 1366, 1440,
  1920 и отдельно 390 / 768) в обоих режимах данных, включая открытые dropdown-меню, компактную панель
  поиска, мобильный drawer и результаты автокомплита.

---

## 4. Версия, статус развертывания и Git состояние
- **Версия:** `0.8.45` (Source Health — circuit breaker REST-источников). Обновлены `package.json`,
  бейджи Header/Footer, `e2e/uiRegression.spec.tsx`, CHANGELOG.
- **Ветка:** `arena/01a0bdd1-cryptora` (от `ed3b4f2` = merge UI-этапов в main).
- Историческая запись v0.8.8 ниже сохранена:
- **Версия (v0.8.8):** corrective: production = только LIVE; поверх v0.8.7 — русификация. Обновлены `package.json`,
  `package-lock.json`, health-эндпоинт `server/productionServer.js`, футер, бейдж версии в шапке, документация.
- **Ветка:** `arena/01a0aaeb-cryptora` (продолжение `arena/01a0a997-cryptora` от `92b30ed / v0.8.6`).
- **Инвариант концепции:** `CRYPTORA DOES NOT EXECUTE TRADES`.
- **Production Deployment Architecture — НЕ ИЗМЕНЯЛАСЬ:** CRYPTORA на VPS обслуживается статически:
  Nginx `:80 → /var/www/cryptora` (артефакты `dist/`). `server/productionServer.js` (порт 3000)
  в рамках этой задачи **не запускался**; VPS **не обновлялся** — обновление выполняет владелец проекта.
- **Фактическая версия production на VPS (`89.125.24.50`): v0.8.4 (`6a01ce1`)** — обновлена и визуально
  проверена владельцем на `/liquidations` до начала работ v0.8.5. Не считать production v0.8.3.
- **Market-data architecture — НЕ ИЗМЕНЯЛАСЬ:** провайдеры, адаптеры, реестр ассетов, realtime-пайплайн
  и бизнес-логика не затронуты. Единственное изменение в слое графиков — явная локаль форматирования
  меток времени в `CandleChart.tsx` (защита от невалидного системного тега локали).
- **Дизайн-система:** `docs/DESIGN_SYSTEM.md` (раздел 3 «Архитектура навигации», таблица брейкпоинтов,
  раздел 9 «Вертикальная ритмика», раздел 10 «Инструменты визуальной проверки»).

---

## 5. Известные ограничения

### 5.1. Ограничения сетевой среды песочницы
- **Внешний доступ к биржевым API:** прямые исходящие вызовы к `api.binance.com`, `api.kucoin.com`
  и `fonts.googleapis.com` блокируются фаерволом контейнера (`SSL_ERROR_SYSCALL` / `ECONNRESET`).
  В режиме `LIVE` терминал честно рапортует об ошибке источника данных без подмены демо-данными.
  В боевой среде VPS с прямым доступом в Интернет шлюз прозрачно проксирует запросы бирж.
- **Playwright-браузеры:** `cdn.playwright.dev` недоступен из песочницы, поэтому штатный
  `npx playwright install chromium` не работает. Для визуального QA в песочнице использован
  локально распакованный Chromium (`@sparticuz/chromium`), подключаемый через переменные окружения
  `CRYPTORA_CHROMIUM_PATH` / `CRYPTORA_CHROMIUM_LD_PATH` — они опциональны, в CI/на VPS
  скрипт использует браузер, установленный Playwright'ом.
- **Browser E2E в песочнице (2026-09-25):** при прогоне `playwright test` в песочнице использован
  ВРЕМЕННЫЙ (не коммитится) конфиг поверх `playwright.config.ts` с `use.launchOptions.executablePath`
  на локально распакованный Chromium, аргументами `@sparticuz/chromium` **без** `--single-process`
  (в lambda-профиле он роняет рендерер на странице с графиком) и `LD_LIBRARY_PATH=/tmp/al2023/lib`
  (библиотеки берутся из `node_modules/@sparticuz/chromium/bin/al2023.tar.br`). Сам пакет
  установлен через `npm install --no-save`, поэтому helper в репозитории не хранится: на VPS/CI
  браузер ставит Playwright. Результат прогона: 97 сценариев passed.
- **Шрифты в песочнице:** Google Fonts недоступен; для совпадения метрик текста с продакшеном
  QA-скрипт подставляет локальные WOFF2-сабсеты Inter / JetBrains Mono (`CRYPTORA_QA_FONTS_DIR`,
  по умолчанию ищется `node_modules/@fontsource/*`).

### 5.2. Технические ограничения
- Размер основного JS-чанка 757 kB (gzip 205 kB) — code-splitting отложен.
- Геометрические инварианты вёрстки в JSDOM не проверяемы: JSDOM не рассчитывает layout.
  Поэтому `e2e/uiRegression.spec.tsx` проверяет контракты (классы, состав, пороги), а реальная
  геометрия проверяется браузерным `scripts/screenshot-qa.mjs`. Это осознанное разделение ролей:
  прежний регресс возник именно из-за доверия к JSDOM-assertions.

---

## 6. Следующий шаг
- **2026-09-23 — production CORS follow-up (реализовано локально в `arena/01a0cd04-cryptora`, не выкачено):** browser REST Binance Spot/Futures и KuCoin переведён на ограниченный same-origin `/api/market` gateway (fixed upstream allowlist, валидируемые параметры, rate limit); прежний generic proxy не возвращён. Проверены KAS background calls и WS route cleanup; см. `docs/MARKET_DATA.md` §5.
- **Нужно отдельно проверить владельцу после review/deploy:** browser Network показывает frontend только `/api/market/*`; Nginx `/api/` направляет в Express на `127.0.0.1:3000`; внешние upstream CORS ошибки Binance/KuCoin исчезают. Деплой на VPS в этом проходе не выполнялся.
- Production `GET /api/auth/session → 401` для гостя — штатно; AuthContext завершает загрузку и не повторяет запрос.
- Происхождение Chrome `contentscript.js` MaxListenersExceededWarning не найдено в `src/`; по filename оно принадлежит browser extension, приложение не изменяло его.
- Исторические задачи аудита (TLS/VPS, V2.1a/V2.1b, etc.) остаются отдельными решениями владельца; этот pass не меняет их.


---

## 7. Commit hash и статус Git remote
- **Актуально:** v0.8.45 (Source Health) на ветке `arena/01a0bdd1-cryptora`; хэш — `git log --oneline -1`.
- Запись хэшей в файле всегда отстаёт на один коммит (самореференция невозможна) —
  актуальные значения берутся командой `git log --oneline -5` в этой ветке.
- **Git remote / push:** ветка отправляется в `origin` (`git push origin arena/01a0bdd1-cryptora`).
