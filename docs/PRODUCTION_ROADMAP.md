# CRYPTORA — Production Roadmap & Operational Backlog

> **Основной backlog проекта после PR #12 / #13 / #14.** Живой checklist: следующий coding agent
> берёт задачи отсюда, а не из истории чата. Меняя статус задачи, обновляй её здесь (статус +
> PR/commit) и в `docs/agent-plan/STATUS.md`.
>
> Последнее обновление: 2026-09-24.

## Легенда

| Маркер | Значение |
|---|---|
| `[ ]` | TODO |
| `[~]` | IN PROGRESS — код есть в открытом PR, но не слит и/или не проверен в production |
| `[x]` | DONE — слито в `main` (и, если указано, проверено в production) |
| `[!]` | BLOCKED — указано, что блокирует |

Priority: **P0**: production сломан или Chrome зависает · **P1**: ключевая функциональность и
эксплуатация · **P2**: качество, безопасность, производительность · **P3**: улучшения.

Шаблон задачи: **Priority · Problem · Evidence from production · Desired behavior · Acceptance
criteria · Dependencies · Status · PR/commit**.

---

## 0. Обязательные инварианты (действуют для КАЖДОЙ задачи)

- Не выдавать demo/mock данные за live.
- Не выдавать estimated/calculated liquidation levels за actual liquidation events.
- Не менять алгоритмы стратегий (V3.0 / V3.3 / V2.8), правила входа/выхода и research/backtest
  logic без отдельного разрешения владельца.
- Внутренние timestamps хранятся в UTC; по умолчанию показываются в локальном времени браузера.
- Большой universe не должен порождать сотни REST-запросов (никаких N × candles / N × metadata).
- Любой P0 Chrome hang закрывается только вместе с Browser E2E regression-тестом.
- `main` меняется только через PR и зелёный CI. Агенты не мержат сами.
- Production deploy — только после backup и health checks.
- Production DB migration — только после backup и просмотра `migrate:status`.
- Агенты не запускают production migration и deploy из песочницы; они дают точные команды для VPS.

---

## 1. Уже сделано

### [x] PR #12: market-data gateway и базовая инфраструктура
- **Merge commit:** `1a6f0389cd809a90453cf5d32e9cea48e05b93c9`
- Same-origin market-data gateway (`/api/market/*`), устранены CORS-проблемы Binance/KuCoin.
- Отрисовка свечей на графике ликвидаций; Market Radar; честные подписи Analytics Preview.
- Заготовки: Coin selector, расширенный рынок, логотипы; улучшения локальных candles/WS.

### [x] PR #13: критический Chrome renderer hang
- **Merge commit:** `e82e4ff18d7b8efca488ab6e07fd23068390a7a7`
- **Root cause:** `IndicatorEngine.calculateVolumeProfile()` мог уйти в синхронный бесконечный цикл,
  когда одна сторона value area исчерпана, а следующий bucket имеет нулевой объём.
- Добавлены regression-тест и Browser E2E на переключение таймфреймов.
- Также: Signals → «Открыть актив»; улучшено отображение локального времени; план миграции
  `strategy_settings` (`docs/STRATEGY_SETTINGS_MIGRATION_PLAN.md`).
- **Production:** владелец предварительно проверил переключение таймфреймов BTC/SOL; зависание
  больше не воспроизводится.

### [~] PR #14: полный universe Binance (открыт, не слит)
- https://github.com/nub36/CRYPTORA/pull/14 · ветка `arena/01a0ce81-cryptora`
- Покрывает разделы 2, 3, 4, 5, 6 и часть 8 (вертикальные разрывы). Статусы соответствующих задач
  ниже — `[~]`. После merge и проверки на production перевести их в `[x]` и вписать merge commit.
- Живые счётчики Binance из песочницы не проверены (нет доступа к Binance); Playwright локально
  не запускался. CI зелёный.

---

### [~] PR #15: полный аудит проекта (открыт, не слит)
- `docs/agent-plan/FULL_PROJECT_AUDIT.md`: findings F-01…F-17 по серверному конвейеру сигналов, тестам,
  эксплуатации и фронтенду. Аудит — spec для задачи 9.2; сам по себе код не меняет.
- **Status:** `[~]`. **PR:** #15.

### [~] PR #18: доработка Signals end-to-end (открыт, не слит)
- Ветка `arena/01a0d27d-cryptora` от `origin/main` (`45c01b80`). **Не слита, не задеплоена.**
- **PR:** https://github.com/nub36/CRYPTORA/pull/18 — CI зелёный (Typecheck + Unit + Build, Browser e2e).
- Закрывает задачи 9.1, 9.3 (остатки), 9.4 и остаток пункта 2 из §12.
- **Исправления производства:**
  * **BUG A** — поиск в селекторе монеты: набор `B` давал «Ничего не найдено». Корень: эффект сброса
    `SymbolPickerModal` имел зависимости `[open, onClose]`, а `onClose` передавался инлайн-стрелкой, поэтому
    каждый ререндер родителя (опросы 5 с / 5 с / 60 с) затирал ввод. Исправлено: стабильный `onClose`,
    сброс только на открытии. Дополнительно запрос нормализуется (`BTC/USDT`, `btcusdt` → `BTC`).
  * **BUG B** — два разных блока «сигналов нет» (страничный и в `SignalSummaryCard`) заменены одним
    `signals-empty[data-state]` с явной причиной: `scanner-off` / `empty` / `error` / `market-error`.
  * **BUG C** — плашка «LIVE-скан · каждые 60с» показывалась при выключенных стратегиях. Источник статуса
    теперь серверный `/api/strategies`; ERROR и отказ запроса показываются отдельно и не называются
    «выключено».
  * **BUG D** — техническая метка `LOCAL` убрана со всех графиков, тумблер LOCAL/UTC удалён.
- **Серверный монитор открытых сигналов** (`server/services/signalMonitor/`, миграция 010): тик 30 с
  независимо от браузера, бюджет <= 500 сигналов и <= 64 групп за цикл, lookback <= 1000 баров 1h на группу
  (нет веера N×свечи). Исполнение и исход считает ЗАМОРОЖЕННЫЙ `trackPublishedSetup()` через адаптер; паритет
  зафиксирован тестом. Состояние переживает рестарт (`signal_monitor_state` + `signals.monitor_*`), отказ
  рыночных данных не закрывает сигнал и не роняет тик.
- **Серверная статистика** (`GET /api/signals/statistics`): агрегаты по persisted lifecycle (не по
  браузерному журналу), доля успешных — только по сделкам, `null` выводится прочерком.
- **Часовой пояс:** единый форматтер `src/utils/timePresentation.ts`, зона берётся из ОС/браузера (DST-aware),
  захардкоженных UTC+3 / Europe/Moscow нет; в БД и API время остаётся UTC/ISO.
- **Миграция 010** аддитивная, PostgreSQL-совместимая, 009 не переписана; проверена на настоящем PostgreSQL.
- **Тесты:** `vitest run` — 135 файлов / 1476 тестов passed; `tests/integration` — 130 passed (настоящий
  PostgreSQL); `tsc --noEmit` и `npm run build` — чисто; Browser E2E на реальном Chromium — 94 сценария.
- Математика стратегий не менялась: **STRATEGY MATH MODIFIED: NO**.
- **Status:** `[~]`. **PR:** ожидает ревью владельца.

### [~] PR #16: надёжный конвейер сигналов (открыт, не слит)
- Реализация findings F-01, F-03, F-05, F-06, F-08, F-09, F-10, F-17 из аудита PR #15: настоящий вызов ядра
  (`scanNow`), честные интеграционные тесты, стабильный ключ дедупликации, полная лестница целей, миграция 009,
  перенос жизненного цикла, нормализация таймфреймов/символов/лимитов на границе рыночных данных, обработчик ошибок
  пула PostgreSQL, контракт `GET /api/signals`, исправленные эксплуатационные инструкции и шаблон systemd.
- Математика стратегий не менялась (`STRATEGY MATH MODIFIED: NO`).
- **Status:** `[~]`. **PR:** #16 (ветка `fix/signal-pipeline-foundation` от `origin/main`).

---

## 2. P0/P1: Market universe

### [~] 2.1 Spot universe = активные инструменты из exchangeInfo
- **Priority:** P0/P1
- **Problem:** список монет строился из bulk ticker, где есть исторические и мёртвые записи.
- **Evidence from production:** bulk ticker Binance = **3710** записей, из них с суффиксом `USDT` =
  **746**. Production показывал около **736** строк, включая VEN, XRPBULL, XRPBEAR, XLMUP, XLMDOWN,
  XTZUP, XTZDOWN, YFIUP, YFIDOWN, BCC/BCHABC и другие исторические активы.
- **Desired behavior:** Binance Spot `exchangeInfo` → `quoteAsset=USDT` → `status=TRADING` →
  spot trading разрешён. На сайте доступны все реально активные Spot-активы. Количество
  динамическое.
- **Acceptance criteria:**
  - Нет захардкоженных 25 / 50 / 736.
  - Мёртвые тикеры из списка выше отсутствуют на /market, в селекторах и в скане.
  - Если exchangeInfo недоступен, исторические тикеры не используются.
  - На production `GET /api/market/universe/spot` → `.count` совпадает с числом строк /market
    (по всем страницам).
- **Dependencies:** market-data gateway (PR #12).
- **Status:** `[~]` реализовано в PR #14, не слито, production count не проверен.
- **PR/commit:** #14.

### [~] 2.2 Futures universe = все активные USD-M USDT контракты
- **Priority:** P1
- **Problem / Evidence:** production /futures показывает около **25** контрактов, что слишком мало.
- **Desired behavior:** Binance USD-M `fapi/v1/exchangeInfo` → активные USDT-контракты → полный
  актуальный поддерживаемый universe. Spot и Futures universe раздельные.
- **Acceptance criteria:** `GET /api/market/universe/futures` отдаёт `activeUsdtContracts`,
  `perpetualCount` и `count`. /futures показывает `count` строк. Квартальные контракты и spot-данные
  не смешиваются. В отчёте явно указано, что именно показывает UI (сейчас: только PERPETUAL).
- **Dependencies:** 2.1 (общий gateway), раздел 4 (производительность).
- **Status:** `[~]` PR #14. **PR/commit:** #14.

---

## 3. P1: Admin Scan Universe

### [~] 3.1 Скан-вселенная на сервере
- **Priority:** P1
- **Problem:** скан-вселенная хранилась в localStorage браузера админа; админка управляла
  «доступностью монет» вместо скана.
- **Desired behavior:**
  - Все активные assets автоматически доступны пользователям сайта; админ управляет только Scan
    Universe.
  - Admin → Монеты показывает «Доступно на рынке: N» и «В скане: M», ищет любую активную монету,
    умеет Add to scan / Remove from scan.
  - Хранение серверное и постоянное (PostgreSQL), не localStorage.
  - Удаление из скана не удаляет актив с сайта.
  - Delisted-инструмент перестаёт сканироваться, даже если он сохранён в списке.
- **Acceptance criteria:** изменения переживают перезагрузку и видны в другом браузере; записываются
  в `audit_log`; шедулер сканирует `saved ∩ active`; при недоступном exchangeInfo скан пропускается
  с явной ошибкой. Алгоритмы стратегий не изменены.
- **Dependencies:** 2.1; раздел 7 (миграции на production, нужна `008_scan_universe`).
- **Status:** `[~]` PR #14 (миграция 008, `/api/admin/scan-universe`, `/api/strategies/scan-universe`).
- **PR/commit:** #14.

---

## 4. P1: Производительность на большом universe

### [~] 4.1 Без регрессий на сотнях активов
- **Priority:** P1
- **Problem:** рост universe в 20–30 раз может вернуть зависания и лавину запросов.
- **Desired behavior / Acceptance criteria:**
  - Не делать 500 candle REST-запросов для 500 активов: каталог = exchangeInfo + bulk ticker.
  - Metadata и логотипы: lazy, кэш, ограниченная параллельность.
  - Candles загружаются только для открытого или реально нужного актива.
  - Market/Futures: пагинация или виртуализация.
  - Search: debounce.
  - Запросы: dedupe и защита in-flight (single-flight).
  - Тест фиксирует отсутствие N × candles; P0-тест из PR #13 остаётся зелёным.
- **Dependencies:** 2.1, 2.2.
- **Status:** `[~]` PR #14 (пагинация, single-flight, ограничение OI). Debounce поиска в селекторах
  отдельно не проверен, проверить при ревью.
- **PR/commit:** #14.

---

## 5. P1: Логотипы и metadata

### [~] 5.1 Системный маппинг symbol → name/logo/metadata
- **Priority:** P1
- **Problem:** у динамических активов часто показывается буквенный аватар.
- **Desired behavior:** lazy, кэш, ограниченная параллельность. Не хардкодить сотни URL. Не делать
  сотни запросов к CoinGecko при рендере. Буквенный аватар — последний fallback.
- **Acceptance criteria:** браузер делает не больше одного запроса metadata за сессию (кэш на
  сервере); после ошибки срабатывает backoff без retry storm. На production проверены логотипы BTC,
  ETH, SOL, LTC, BCH, ZEC, PEPE, USDC и нескольких динамических активов.
- **Dependencies:** доступность CoinGecko с VPS.
- **Status:** `[~]` PR #14 (`/api/market/metadata/assets`), на production не проверено.
- **PR/commit:** #14.

---

## 6. P1: Селекторы

### [~] 6.1 Coin Selector (/coin/:symbol)
- Полный активный Spot universe, поиск по тикеру и имени, логотип. Не canonical 25.
- **Status:** `[~]` PR #14.

### [~] 6.2 Liquidations Selector
- Активный поддерживаемый universe ∩ наличие свечей; поиск по тикеру и имени; логотип. Не canonical 25.
- Не ломать candles, events, markers и потоки Binance/Bybit/OKX.
- **Status:** `[~]` PR #14. Пересечение с поддержкой свечей проверить на production для
  низколиквидных активов.

---

## 7. P1: База данных и стратегии

### [ ] 7.1 Применить миграции на production
- **Priority:** P1
- **Evidence from production:** `relation "strategy_settings" does not exist`, при этом подключение
  к БД работает. Миграция `006_strategy_settings` в репозитории есть.
- **Вероятная причина** (анализ PR #14): `scripts/migrate.mjs` и `server/config.js` не читают `.env`.
  Без экспортированного `DATABASE_URL` миграции применяются к БД по умолчанию, а не к production.
- **Процедура (выполняет владелец на VPS):**
  ```bash
  cd /root/CRYPTORA
  set -a; . ./.env; set +a            # или export DATABASE_URL='postgresql://…'
  echo "$DATABASE_URL"                # убедиться, что это production
  pg_dump "$DATABASE_URL" -Fc -f /root/cryptora-$(date +%F-%H%M).dump
  npm run migrate:status
  npm run migrate
  npm run migrate:status              # 006, 007, 008 (PR #14), 009 (PR #16), 010 (PR #18) applied
  psql "$DATABASE_URL" -c 'SELECT strategy_id, enabled FROM strategy_settings'   # 3 строки, disabled
  psql "$DATABASE_URL" -c '\d signals'
  sudo systemctl restart cryptora
  curl -s http://127.0.0.1:3000/api/strategies | head -c 400
  journalctl -u cryptora -n 100 --no-pager | grep -iE 'strateg|schedul|error'
  ```
- **Acceptance criteria:** есть backup; `migrate:status` без pending; в `strategy_settings`
  3 строки, все disabled (сиды 006 не включают стратегии); таблица `signals` (007) существует и расширена 009
  (`targets NUMERIC[]`, `chain_version`, `fill_*`, `result_r`/`net_result_r`, `outcome_hash`, домен `status` из
  восьми состояний, индекс `idx_signals_symbol_status_created`); `/api/strategies` отвечает 200 и отдаёт
  `execTimeframe: "1h"`; журнал шедулера без повторяющихся ошибок БД.
- **Про 009:** миграция аддитивная (007 не переписана), расширение `CHECK` выполнено двумя шагами
  (`NOT VALID` → `VALIDATE CONSTRAINT`), `CREATE INDEX CONCURRENTLY` невозможен внутри транзакции раннера —
  таблица `signals` на production пуста, поэтому сборка индекса мгновенна. Применение проверено на настоящем
  PostgreSQL в `tests/integration/migrationsPostgres.test.ts` (все 9 файлов, идемпотентно).
- **Критично:** не менять алгоритмы V3.0/V3.3/V2.8, entry/exit, research/backtest logic.
- **Dependencies:** доступ к VPS; раздел 12 (безопасность миграций).
- **Status:** `[ ]`. **PR/commit:** процедура задокументирована в PR #14 и здесь.

---

## 8. P1: Ликвидации

- `[x]` Candles работают.
- `[x]` Actual events поступают.
- `[x]` Markers работают.
- `[x]` Потоки Binance/Bybit/OKX работают.

### [~] 8.1 Убрать большие пустые вертикальные области
- **Priority:** P1 · **Status:** `[~]` PR #14 (карточки стекаются, `items-start`, убран
  `min-h-[184px]`). Проверить на production на desktop, tablet и mobile.

### [ ] 8.2 Фильтры
- **Priority:** P1
- Фильтры по символу, бирже и минимальной сумме **$1K / $10K / $100K / $1M**.
- **Note:** в v0.9.3 есть локальные фильтры журнала (биржа, сторона, минимальный размер). Сверить
  пороги с этим списком и добавить фильтр по символу, где его нет.
- **Acceptance criteria:** фильтрация не порождает сетевых запросов; фильтры работают вместе.

### [ ] 8.3 Короткая серверная история actual events
- **Priority:** P1/P2
- **Problem:** после F5 история ликвидаций у пользователя обнуляется.
- **Desired behavior:** сервер хранит ограниченное окно последних actual events (например, N событий
  или T минут) и отдаёт его при загрузке страницы.
- **Acceptance criteria:** после F5 журнал восстанавливается; calculated liquidation levels не
  смешиваются с actual events; объём хранения ограничен.

---

## 9. P1: Сигналы

- `[x]` «Открыть актив» (PR #13).

### [~] 9.1 Signal Detail и расширенный контекст
- **Priority:** P1
- Показывать: symbol, strategy, timeframe, event time, entry, invalidation, state, outcome, exit reason.
- Только реальные данные.
- Явно различать: new signal / entry executed / exit / research/history / live observation.
- **Acceptance criteria:** ни одно поле не заполняется выдуманными значениями; при отсутствии данных
  показывается «—» с пояснением. Логика стратегий не меняется.
- **Dependencies:** 7.1 (серверные `signals`), если источником станет `/api/signals`.
- **Status:** `[~]` — `SignalDetailsPanel` показывает монету, направление, стратегию с версией, таймфрейм
  исполнения, время сигнала, вход (зона), стоп, всю лестницу `targets[]`, статус и подсказку о его источнике,
  время исполнения, исход (gross/net R, причина выхода, баров в позиции), аналитику и целостность. Остаток:
  серверный архив исходов старше окна реплея (см. §12 в `docs/STRATEGY_OPERATIONS.md`) и наполнение
  `pnl_result_pct` в серверном пути. **PR:** #18.

### [x] 9.2 Фундамент серверного конвейера сигналов (до Signals UI)
- **Priority:** P1 (блокирует 9.1 и любой Signals V2 UI)
- **Problem (аудит PR #15):** серверный движок вызывал несуществующий метод ядра `scanOnce()` (F-01) — каждый скан
  падал с TypeError при живом планировщике; интеграционный контракт ядра молча пропускался и отчитывался как passed
  (F-03); ключ дедупликации брался из времени публикации, а не из `setupOpenTime` (F-05); третья и последующие цели
  терялись при сохранении (F-06); домен `status` не покрывал состояния, которые ядро уже определяет (F-08);
  дневной таймфрейм `'1D'` уходил в Binance как есть (F-09), а `limit` свечей терялся в адаптере провайдера (F-10);
  у пула PostgreSQL не было обработчика `'error'`, из-за чего `FATAL 57P01` на простаивающем клиенте завершал
  процесс и красил CI при всех прошедших тестах (F-17).
- **Desired behavior:** скан действительно исполняет ядро, сигнал сохраняется один раз и без потерь, состояние
  сигнала отражает то, что система уже определила, лента API ограничена и детерминирована, отказ БД/рынка не роняет
  процесс и не маскируется.
- **Acceptance criteria (все выполнены в PR #16):**
  * движок вызывает `scanNow()`; контракт проверяется тестом, который РЕАЛЬНО исполняется в окружении node
    (10 тестов `strategyEngineCore.test.ts` + 12 `strategyEngineScan.test.ts`);
  * отказ рыночных данных — `MARKET_DATA_UNAVAILABLE` до скана, а не «сетапов нет»;
  * дедупликация по `(strategy_id, symbol, timeframe, setupOpenTime)`; новый бар — новый сигнал;
  * `targets NUMERIC[]` хранит всю лестницу, `tp1`/`tp2` производны; сквозная проверка strategy → БД → API;
  * жизненный цикл: ACTIVE → FILLED → {TARGET_REACHED | INVALIDATED | CLOSED | EXPIRED | CANCELLED | UNRESOLVED},
    монотонно, значениями ядра; неизвестный исход не подменяется текущим временем;
  * `GET /api/signals`: фильтры (symbol/strategy/status/open/direction), `limit` ≤ 200, `offset` ≤ 5000,
    newest-first, `total` + `appliedFilters` + домен состояний в ответе, 400 с кодом вместо тихой пустоты;
  * `pool.on('error')` со структурированной записью без секретов; `closePool()` терминален; остановка закрывает
    пул последним шагом; восемь подряд прогонов интеграционного набора — 109 passed, 0 skipped, 0 unhandled errors
    (один из прогонов — с удалённым `.generated/`, т.е. холодная сборка бандла ядра);
  * сквозной сценарий автоматизирован: `tests/integration/schedulerPersistence.test.ts` на настоящем PostgreSQL
    и настоящем скомпилированном ядре проходит цепочку «включённая стратегия (админ-API) → `StrategyScheduler.tick()`
    → `scanNow()` → `last_scan_at` продвинулся / `last_error` = null → повторный цикл уважает интервал и не дублирует
    строки → отказ рынка виден в `last_error` и в статусе `ERROR` → запись `buildSignalRecord()` доходит до БД и API
    со всей лестницей целей» (подменяется только сетевой слой рыночных данных);
  * `npm ci --omit=dev` больше не молчит: отсутствие esbuild даёт явное сообщение (ядро собирается из `src/`).
- **Остаток работы (не входит в PR #16):** realtime-мониторинг позиции, архивная синхронизация исходов старше окна
  реплея, заполнение `pnl_result_pct` в серверном пути, включение стратегий в production.
  Перевод страницы `/signals` на `GET /api/signals` и Signals V2 UI выполнены в задаче 9.3. Дизайн —
  `docs/agent-plan/SIGNALS_V2_HANDOFF.md`.
- **Dependencies:** 7.1 (миграции на production), раздел 12.1 (deploy).
- **Status:** `[x]`. **PR/commit:** #16 (слит в `main`), ветка `fix/signal-pipeline-foundation`.

### [~] 9.3 Signals V2 UI — график, селектор монет, человекочитаемый мобильный экран
- **Priority:** P1 (закрывает пользовательскую часть поверх фундамента 9.2)
- **Source of truth:** `GET /api/signals` (контракт 9.2). Фронтенд ничего не генерирует и не досчитывает:
  вход/стоп/цели, статусы и R отображаются как их сохранил сервер.
- **Сделано (эта ветка `feat/signals-v2-ui`):**
  * порядок блоков на мобильном: селектор монеты → сводка сигнала → свечной график → уровни выбранного
    сигнала → история → сворачиваемые «Статистика и аудит»;
  * селектор — полный активный Spot-universe (лениво, кэш), НЕ админ-вселенная скана; чипы монет с сигналами;
  * `CandleChart` расширен аддитивными `markers`/`levelLines`/`onMarkerClick` — существующие потребители
    (/coin, /overview) не меняются; маркеры истории и линии уровней ВЫБРАННОГО сигнала;
  * произвольная длина `targets[]` (0/1/3/5) рисуется фактическим массивом; эффективные уровни после
    исполнения — отдельный набор;
  * таймфрейм сигнала (исполнения, у всех трёх стратегий `1h`, V2.8 — не «15m») отделён от таймфрейма графика,
    рассогласование помечается честно;
  * статусы — человеческим языком из домена сервера; неизвестный статус не подменяется; рядом со статусом —
    подсказка «статус отражает последнее зафиксированное сервером состояние»;
  * защита от гонок (смена монеты/таймфрейма отменяет устаревшие запросы) и запрет веера: свечи — только
    выбранный символ и таймфрейм, один запрос на переключение;
  * R — второстепенная метрика в деталях, с объяснением (1R = риск между входом и стопом), формулы не
    пересчитываются; аудит/целостность перенесены в сворачиваемый второстепенный блок.
- **Не входит (остаток):** расширение `CandleChart` маркерами/линиями для других страниц, включение
  стратегий в production. Realtime-мониторинг позиции и честный статус сканирования закрыты в PR #18 (9.4).
- **Acceptance criteria:** уровни и статусы только из API; нет арифметики над ценами на клиенте; один запрос
  свечей на выбранный символ/таймфрейм; пустые/ошибочные состояния честные; математика стратегий не тронута
  (нулевой diff по `src/services/strategyArchive/**`, `src/services/signals/**`); Liquidation X и /coin не сломаны.
- **Dependencies:** 9.2 (слит).
- **Status:** `[~]`. **PR/commit:** ветка `feat/signals-v2-ui` (от актуального `origin/main` после слияния #16).

### [~] 9.4 Сигналы end-to-end: монитор, статистика, часовой пояс, честные состояния
- **Priority:** P1 (закрывает остаток 9.3 и пользовательские дефекты производства)
- **Problem (evidence from production):**
  * поиск в селекторе монеты: ввод `B` при ~493 активных Spot USDT инструментах давал «Ничего не найдено»
    (BUG A — сброс запроса при ререндере родителя);
  * на экране одновременно два разных блока «сигналов нет» (BUG B);
  * плашка «LIVE-скан · каждые 60с» при всех выключенных стратегиях (BUG C);
  * техническая метка `LOCAL` на графиках (BUG D);
  * статус сигнала двигался только реплеем окна скана и только при открытой вкладке: сетап, не дождавшийся
    входа, мог остаться `ACTIVE` после выключения стратегии;
  * метрики на UI считал браузерный журнал, а не persisted lifecycle.
- **Desired behavior:** сервер сам отслеживает опубликованные сигналы и переживает рестарт и отказ рынка;
  статистика — агрегат по PostgreSQL; статус сканирования — факт с сервера; время — в поясе пользователя.
- **Acceptance criteria (все выполнены в PR #18):**
  * селектор ищет по полному активному Spot-universe, запрос переживает backspace и ререндеры, поддерживает
    `B`/`BT`/`BTC`/`btc`/`BTC/USDT`/`SOL`/`ETH`/`1000SHIB`/`PEPE`; поиск локальный, после загрузки реестра;
  * пустое состояние одно, причина явная (сканер выключен / лента пуста / запрос упал / рынок недоступен);
  * статус сканера: 0 включенных → «выключено», N → фактический интервал, ERROR → отдельно, отказ запроса →
    «недоступен» (не «выключено»); строка «LIVE-скан» отсутствует во всех состояниях;
  * метки `LOCAL` нет ни на одном графике; время — пояс браузера/ОС, DST учитывается, один форматтер;
  * монитор: независим от браузера, переживает рестарт и отказ рыночных данных, паритет с замороженным
    `trackPublishedSetup()` (включая same-bar TP/SL), бюджет цикла ограничен константами (нет N×свечи);
  * миграция `010_signal_monitor_bookkeeping.sql` аддитивная, 009 не тронута, применена на настоящем PostgreSQL;
  * `/api/signals/statistics` — агрегаты persisted lifecycle, знаменатель доли успешных только по сделкам,
    `null` ≠ 0; пользовательских эндпоинтов, меняющих состояние стратегий, не добавлено;
  * UI: лента 60 с, статус сканера 15 с, статистика 60 с, пауза при скрытой вкладке, отмена устаревших запросов;
  * Browser E2E на реальном Chromium покрывает сценарии A–P (`e2e/signalsV2.spec.ts`).
- **Dependencies:** 9.2, 9.3, 7.1 (миграции на production).
- **Status:** `[~]`. **PR:** #18 — https://github.com/nub36/CRYPTORA/pull/18
  (ветка `arena/01a0d27d-cryptora`, CI зелёный).

---

## 10. P1: Свежесть данных

### [ ] 10.1 Бейджи LIVE / STALE / DEGRADED с возрастом данных
- Возраст в виде `2s`, `35s`, `3m` для ticker, candles, OI, funding, liquidations.
- **Acceptance criteria:** пороги описаны в коде и документации; при остановке источника бейдж
  становится STALE.

### [ ] 10.2 Переподключение WS
- После disconnect: REST catch-up → возобновление WS.
- **Acceptance criteria:** production/browser test обязателен (эмуляция offline → online), без
  пропусков свечей и без дублей.

---

## 11. P1: Наблюдаемость

- `[ ]` **11.1 Admin/System: статус источников данных.** Binance Spot REST, Binance Spot WS, Binance
  Futures, Bybit liquidation stream, OKX liquidation stream, CoinGecko, PostgreSQL. Для каждого:
  status, latency, last success, last error, staleness.
- `[ ]` **11.2 Разделить `/health` и `/ready`** при необходимости: liveness отдельно, readiness с БД
  и миграциями.
- `[ ]` **11.3 Frontend error reporting.**
- `[ ]` **11.4 Метрики gateway:** errors, latency, rate-limit, timeouts.

---

## 12. P1: Deployment

### [ ] 12.1 Исправить production deploy pipeline
- **Текущий VPS:** repo `/root/CRYPTORA`; frontend раздаётся из `/var/www/cryptora`; backend —
  systemd `cryptora.service` → `server/index.js`; Nginx `cryptora.duckdns.org`,
  `/api` → `127.0.0.1:3000`.
- **Note (закрыто в PR #16):** шаблон `systemd/cryptora.service` в репозитории запускал
  `server/productionServer.js` (legacy static-сервер без БД, auth и движка стратегий), расходясь с VPS.
  Шаблон приведён к фактической схеме: `ExecStart=… server/index.js`, `EnvironmentFile=-.env`,
  `HOST=127.0.0.1` (nginx проксирует `/api`), `ReadWritePaths` для esbuild-бандла ядра. Документация
  (`docs/STRATEGY_OPERATIONS.md` §10, `docs/DEPLOYMENT.md`) больше не рекомендует `npm start` для бэкенда.
- **Problem:** `scripts/deploy.sh` запускает интеграционные тесты с embedded PostgreSQL, которые на
  VPS падают с `initdb EACCES`, хотя GitHub CI проходит.
- **Desired behavior:** разделить CI tests (GitHub), production build и deployment smoke tests (VPS).

### [ ] 12.2 Надёжный (автоматизированный) deploy
- backup → fetch → `git merge --ff-only` → build → atomic frontend swap → backend restart →
  health → gateway smoke → rollback при провале.
- **Acceptance criteria:** провал любого шага оставляет production на предыдущей версии; есть
  документированная команда rollback.

---

## 13. P1: Версия production

### [ ] 13.1 Endpoint версии
- `/api/health` или отдельный endpoint отдаёт app version, Git SHA, build time и environment.
- У frontend есть build ID (например, в footer или meta).
- **Acceptance criteria:** по production можно однозначно определить задеплоенный commit.

---

## 14. P1: Безопасность миграций

### [ ] 14.1 Обнаруживать pending critical migrations
- Startup/readiness обнаруживает pending critical migrations и сообщает о них явно.
- Шедулер не должен писать одну и ту же ошибку БД каждые 15 секунд бесконечно: backoff или
  остановка с понятным статусом.
- Destructive migrations не применяются автоматически без политики проекта.

---

## 15. P2: Безопасность

- `[ ]` **15.1 npm audit.** На VPS `npm ci` сообщил о 7 уязвимостях: 5 moderate, 1 high, 1 critical.
  НЕ запускать `npm audit fix --force` автоматически. Исследовать: какой пакет, prod или dev
  зависимость, эксплуатируемость, безопасное обновление.
- `[ ]` **15.2 Bind backend.** Node слушает `0.0.0.0:3000`. Если внешний доступ не нужен, слушать
  `127.0.0.1` или закрыть внешний 3000 firewall'ом.
- `[ ]` **15.3 Проверить firewall.**
- `[ ]` **15.4 Проверить реальные production CSP и security headers.** Важно: активный Nginx на VPS
  отличается от шаблона в репозитории и управляется Certbot. Не перезаписывать TLS-конфигурацию
  шаблоном.

---

## 16. P2: Bundle и производительность

- `[ ]` **16.1 Main JS bundle ~897–900 KB.** Вынести тяжёлые части в lazy/dynamic import. CoinPage не
  грузит код Admin/Strategies, и наоборот. Установить performance budgets (проверка в CI).
- `[ ]` **16.2 CoinPage budgets:** время переключения таймфрейма, число подписок, освобождение памяти,
  число рендеров и callback'ов. Regression-тест PR #13 сохраняется.

---

## 17. P2: Невалидные и delisted активы

- `[ ]` **17.1 `/coin/UNKNOWN`:** быстрое сообщение «Инструмент не поддерживается» без retry storm.
- `[~]` **17.2 Delisted asset:** убирается из active universe и из выполнения скана (PR #14). НЕ
  удалять исторический журнал и сигналы, проверить отдельно.

---

## 18. P2: Семантика Futures/Spot

- `[ ]` **18.1 Аудит:** spot price, mark price, index price, futures volume, spot volume, OI и funding
  не смешиваются. У каждого блока есть provenance/source.

---

## 19. P2: UI и layout

- `[~]` **19.1** Большие пустые области на /liquidations (см. 8.1).
- `[ ]` **19.2** Проверить responsive: desktop, tablet, mobile.
- `[ ]` **19.3** Состояния error/empty/loading не создают огромных пустых карточек.

---

## 20. P2: Production audit

### [ ] 20.1 READ-ONLY browser audit после ключевых исправлений
- Маршруты: `/`, `/market`, `/futures`, `/coin/BTC`, `/coin/SOL`, `/liquidations`, `/radar`,
  `/signals`, `/strategies`, `/admin`.
- Собрать: console errors, failed network requests, API latency, stale data, layout regressions,
  broken navigation.
- Классифицировать находки P0/P1/P2/P3 и занести сюда отдельными задачами.
- Не исправлять всё одним огромным PR.
- **Dependencies:** разделы 2–8 слиты и задеплоены.

---

### [~] 20.2 Скриншоты Signals (артефакт, не в git)
- `CI=1 npx playwright test e2e/signalsV2.spec.ts` пишет в `e2e/screenshots/` (в `.gitignore`):
  desktop и mobile экраны, поиск селектора (`B`, `BTC`), сканер выключен/включен/ошибка, сигнал в ожидании
  входа, исполненный и терминальный, панель статистики, история, график с уровнями Entry/Stop/TP1..TP3,
  экран в токийском поясе без метки «LOCAL».

---

## Рекомендуемый порядок

1. Ревью и merge PR #14 → deploy по процедуре 12.x → миграции 7.1 → проверка счётчиков 2.1/2.2.
2. 13.1 (версия) и 14.1 (безопасность миграций): без них сложно проверить всё остальное.
3. 12.1/12.2 deploy pipeline → 15.x security.
4. 10.x, 11.x, 8.2/8.3, 9.1.
5. 16.x, 17.x, 18.x, 19.x → 20.1 production audit.
