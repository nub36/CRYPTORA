# Полная диагностика CRYPTORA — 2026-10-04

## Итоговая оценка

**7.2/10 для production-readiness текущего checkout.**

Это сильный функциональный прототип/рабочий терминал с хорошей архитектурой, большим покрытием тестами и честным разделением live/demo-источников. До 9–10 баллов не хватает прежде всего полностью проходящего интеграционного контура PostgreSQL, реального E2E-прогона в браузере, устранения технического ограничения окружения для embedded PostgreSQL, уменьшения production bundle и явной верификации всех внешних источников в deployment-среде.

Оценка не означает, что сайт «сломанный»: большая часть unit/server/integration-without-Postgres проверок проходит. Но полный CI зелёным не является.

## Что проверено

- структура frontend/backend/shared/tests/docs;
- TypeScript typecheck;
- production build;
- весь Vitest suite;
- стратегии, сигналы, TP/SL, lifecycle, provenance;
- маршруты и основные серверные сервисы по исходникам;
- поиск demo/test/mock/stub/placeholder/TODO/не реализовано;
- fallback и честность источников данных;
- сборка и размер JS-чанков;
- наличие заглушек в UI и сервере.

## Результаты автоматических проверок

| Проверка | Результат |
|---|---:|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| Vitest | 213 passed, 3 failed suites, 2394 passed tests, 28 failed, 167 skipped |
| V3.4 target-quality suite | PASS: 45/45 |
| Production build warning | главный chunk ~956 KB minified |

## Критические найденные проблемы

### P0/P1 — интеграционные тесты PostgreSQL не проходят в данном окружении

`embedded-postgres` не может запустить `initdb`:

```text
libpq.so.5: cannot open shared object file
```

Из-за этого часть интеграционных suite была skipped, а часть упала:

- `signalMonitorPostgres.test.ts` — 41 skipped;
- `schedulerPersistence.test.ts` — 6 skipped;
- `strategyOperations.test.ts` — 47 skipped;
- `radarEventsPostgres.test.ts` — 7 skipped;
- `signalProvenanceQuarantine.test.ts` — 1 failed, остальные skipped;
- `signalProvenanceAuditSql.test.ts` — 1 failed, остальные skipped;
- `strategyTestRuns.test.ts` — 26 failed из-за отсутствующего DB harness/app client после невозможности поднять PostgreSQL.

Это не доказательство ошибки бизнес-кода PostgreSQL, но это **блокер полного подтверждения production correctness**. Нужно либо установить `libpq5` в CI/runner, либо использовать доступный PostgreSQL service container, либо исправить embedded-postgres runtime.

### P1 — полный тестовый прогон не зелёный

Команда `npm test -- --run` завершается с ошибкой. Нельзя заявлять, что сайт полностью проверен, пока DB suite не выполняется в рабочем окружении.

### P2 — большой основной JS chunk

Vite сообщает chunk около **956.52 kB minified**. Это ухудшает первый запуск, особенно мобильный/медленный интернет. Следует разделить тяжёлые разделы через dynamic import/manual chunks: charts, Strategy Lab, Signals, Liquidations, Futures.

## Что сделано хорошо

### Архитектура

- frontend и backend разделены;
- серверные стратегии используют собранное настоящее ядро из `src`, а не вторую ручную реализацию формул;
- есть строгие registry/catalog/check-ограничения стратегий;
- присутствует provenance-защита сигналов;
- есть audit log, миграции и отдельные сервисы lifecycle;
- стратегия V3.4 изолирована и не меняет V3.0/V3.3/V2.8.

### Данные

- live/demo разделены;
- stale/unavailable состояния представлены явно;
- в документации зафиксировано, что demo/примерные значения не должны маскироваться под live;
- есть нормализация символов и источников;
- предусмотрены Binance/KuCoin fallback-пути;
- присутствуют проверки закрытых свечей и look-ahead bias.

### Сигналы и стратегии

- V3.4 подключена в catalog, engine, persistence, monitor и UI;
- TP ladder проходит через `targets`, а `tp1/tp2` являются производными;
- V3.4 имеет проверки качества TP1/TP2, стопа и геометрии;
- есть тесты provenance и конкурентных запусков;
- есть отдельные проверки lifecycle и parity.

### Безопасность

- admin endpoints защищены auth/admin middleware;
- есть CSRF/rate-limit/auth validation тесты;
- saved Strategy Lab привязан к owner и проверяет UUID/DSL;
- сервер не должен доверять `strategyId/testRunId` от клиента без валидации;
- есть CSP/security документация и тесты production deployment contracts.

## Demo/test/mock/placeholder аудит

### Реальные demo-механизмы присутствуют

Найдены:

- `src/services/data/DemoMarketDataProvider.ts`;
- QA fixtures и synthetic strategy candles;
- `mode=qa-fixture` для screenshot/QA;
- тестовые seams и `__reset...ForTests`;
- mock/fake providers в тестах.

Это не обязательно баг: demo-слой ожидаем и полезен для локальной разработки. Важно, что он не должен включаться в production молча.

### Проверено отсутствие опасной маскировки

По исходникам найдено много корректных `return null/[]` для состояний «нет данных», но это в основном guards, а не заглушки. Найдены явные safeguards, которые запрещают подставлять данные при ошибке Strategy Lab и market data.

### Что требует ручной проверки deployment

- значение runtime data mode;
- production env для API keys/DB/SMTP/OAuth;
- что demo provider недоступен пользователю в production;
- что пустые страницы показывают «источник недоступен», а не нулевые fake-значения;
- что server scheduler не стартует при отсутствии market data/strategy core;
- что миграции 001–016 реально применены на production DB.

## Функциональная оценка по разделам

| Область | Оценка | Комментарий |
|---|---:|---|
| Market data | 8/10 | хорошая нормализация/fallback, нужен реальный deployment smoke |
| Charts/UI | 8/10 | много тестов, но большой bundle и нужен browser run |
| Signals | 8/10 | хорошая provenance/lifecycle модель, DB suite не подтверждён здесь |
| Strategies | 8/10 | V3.4 и parity хорошо покрыты, production enablement осознанно выключен |
| Strategy Lab | 8/10 | валидация и HTTP security сильные, нужен полноценный DB/browser smoke |
| Auth/security | 8/10 | хорошие контракты и тесты, нужна deployment security проверка |
| Database/migrations | 6/10 | код и DDL выглядят системно, но PostgreSQL runtime не прошёл |
| Performance | 6.5/10 | chunk ~956 KB — заметный долг |
| Production readiness | 6.5/10 | неполный зелёный CI и незапущенные DB integration |
| Документация | 9/10 | очень подробная, но местами отражает планы/исследования, а не live proof |

## Невыполненные или неполностью подтверждённые пункты

1. Полный PostgreSQL integration suite в текущей среде.
2. Полный Playwright E2E run против собранного/запущенного сайта.
3. Browser console/network sweep в live deployment режиме.
4. Проверка всех внешних API с актуальными production env.
5. Проверка реального scheduler + PostgreSQL + market data end-to-end.
6. Проверка production migration status на целевой БД.
7. Разделение крупного frontend bundle.
8. Формальное подтверждение, что demo/QA mode недоступен в production.

## Приоритетный план доведения до 9/10

1. Исправить CI/runtime PostgreSQL (`libpq5` или service container).
2. Добиться 0 failed и 0 unexpected skipped интеграционных тестов.
3. Запустить Playwright на production build и устранить browser console errors.
4. Добавить deployment smoke: live provider, unavailable provider, stale data, DB unavailable.
5. Разделить крупные чанки через route-level lazy loading/manualChunks.
6. Добавить автоматическую проверку: production не использует DemoMarketDataProvider.
7. Проверить миграции и scheduler на staging с реальными закрытыми свечами.
8. Сохранить отчёт покрытия и результаты в CI artifact.

## Вывод

Сайт сделан существенно больше, чем обычный макет: основные страницы, data pipeline, сигналы, стратегии, lifecycle, auth, Strategy Lab, миграции и тесты существуют. Основной недостаток сейчас — не отсутствие функциональности, а **неполная воспроизводимая production-проверка**: PostgreSQL integration не стартует в окружении, а полный тестовый suite красный. Поэтому честная оценка — **7.2/10**, с потенциалом **8.5–9/10** после восстановления DB CI, полного E2E и оптимизации bundle.
