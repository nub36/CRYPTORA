# READ-ONLY аудит жизненного цикла на боевом сервере — инструкция

**Дата:** 2026-09-30 · **Ветка:** `arena/01a0f0b2-cryptora` · **Скрипт:** `scripts/audit-production-lifecycle.mjs`

Этот документ описывает, как снять диагностику с боевого CRYPTORA, **ничего в нём не меняя**.
Ни одна строка продакшена не правится: ни сигналы, ни настройки, ни сервис.

---

## 1. Что скрипт делает

| Шаг | Источник | Действие |
|---|---|---|
| 1 | `information_schema.columns` | Читает **фактическую** схему `signals` и `signal_monitor_state`. Имена колонок не предполагаются: выбираются только те, что реально есть. |
| 2 | `server/services/strategyEngine/strategyCoreBundle.js` | Загружает **замороженное ядро** — ту же `trackPublishedSetup`, которой сервер ведёт позиции. |
| 3 | `server/services/signalMonitor/signalTradeManager.js` | Переводит строку БД в вход ядра штатным `toPublishedSetup`. Второй стратегической математики в скрипте нет. |
| 4 | `server/services/strategyEngine/marketDataFetcher.js` | Тянет klines тем же продакшен-фетчером (только GET). |
| 5 | ядро | Свечи готовятся как в мониторе: `ohlcvArrayToArchive` → отбрасывание формирующейся свечи по `isClosed` → сортировка → дедуп по `openTime`. |
| 6 | SELECT | APT, SOL SHORT, поиск SOL LONG **по уровням, а не по угаданному id**, глобальный обход всех `ACTIVE`/`FILLED`. |

Отдельно помечено, что считает сам скрипт: **«ХРОНОЛОГИЯ КАСАНИЙ»** — это наблюдение
(«когда `high` впервые дошёл до опубликованного `tp1`»), а не решение. Решение всегда
за строкой **«ЯДРО (frozen)»**.

## 2. Контракт безопасности

Проверяется машиной, а не обещанием — тест
`tests/integration/auditProductionLifecycleScript.test.ts` поднимает настоящий PostgreSQL,
применяет настоящие миграции, снимает дамп таблиц до и после запуска и требует
побайтового совпадения.

* `BEGIN READ ONLY`; перед первым чтением сверяется `SHOW transaction_read_only = on`, иначе аварийная остановка.
* Каждый SQL проходит через `sel()`: разрешены только `SELECT` / `WITH` / `SHOW` / `TABLE`; `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`, `GRANT`, `COPY` до сервера не доходят — процесс падает.
* `SET LOCAL statement_timeout` и `idle_in_transaction_session_timeout`.
* Завершение — `ROLLBACK`.
* Отдельный `pg.Client`, пул приложения не занимается.
* Секреты не печатаются: DSN маскируется (`postgresql://***@host:port/db`), `.env` не выводится, `metadata` в отчёт не попадает, а весь вывод дополнительно прогоняется через маскирующий фильтр (URL с паролем, `password=`/`token=`/`secret=`, JWT, длинные hex).

**Единственная запись на диск вне `/tmp`:** `loadStrategyCore()` может пересобрать
`server/services/strategyEngine/.generated/strategyCore.mjs`, если бандл устарел
относительно `src/services`. Это локальный кэш сборки (атомарная запись через
временный файл + rename), не данные продакшена. На нормально задеплоенном сервере
бандл свежий и пересборки не происходит. Если такое поведение нежелательно —
запускайте с `--noMarket`: вердикты ядра будут помечены как недоступные, но SQL-часть
отчёта (невозможные статусы, дубли, пересечения LONG/SHORT, телеметрия монитора)
останется полной.

## 3. Флаги

| Флаг | Смысл | По умолчанию |
|---|---|---|
| `--root <путь>` | каталог установки CRYPTORA | `process.cwd()` |
| `--timeout <строка>` | `statement_timeout` | `20s` |
| `--maxGroups <n>` | сколько групп «символ × таймфрейм» опрашивать на бирже | `64` |
| `--staleMinutes <n>` | порог `MONITOR_STALE` | `10` |
| `--noMarket` | не ходить на биржу и не собирать ядро | выкл. |
| `--aptId` / `--solShortId` | переопределить целевые id | из задачи |

## 4. Запуск

Скрипт берётся из ветки без переключения рабочего дерева: `git fetch` кладёт объекты
в `.git`, `git show` печатает файл в `/tmp`. Задеплоенный код при этом не меняется.

```
cd /opt/cryptora \
  && git fetch origin arena/01a0f0b2-cryptora \
  && git show origin/arena/01a0f0b2-cryptora:scripts/audit-production-lifecycle.mjs > /tmp/cryptora-audit.mjs \
  && node /tmp/cryptora-audit.mjs --root "$PWD" > /tmp/cryptora-lifecycle-audit.txt 2>&1 \
  ; echo "exit=$?"; wc -l /tmp/cryptora-lifecycle-audit.txt
```

Если `DATABASE_URL` живёт в unit-файле systemd, а не в `.env`, скрипт сам прочитает
`.env` каталога установки; при необходимости передайте переменную явно:
`DATABASE_URL="$(sudo systemctl show cryptora -p Environment --value | tr ' ' '\n' | sed -n 's/^DATABASE_URL=//p')" node /tmp/cryptora-audit.mjs --root "$PWD"`.

## 5. Что вернуть

Только содержимое `/tmp/cryptora-lifecycle-audit.txt`. Файл уже санитизирован.
Разделы 1–6 — доказательная база, раздел 7 — краткий отчёт в согласованном формате
(APT / SOL LONG / SOL SHORT / SOL OVERLAP / OPPOSITE SIGNAL POLICY / GLOBAL и пять
строк-подтверждений `PRODUCTION DB WRITES: 0` … `DEPLOYED: NO`).

## 6. Чего скрипт НЕ делает

Не чинит найденное. Ни одна аномалия не исправляется — только перечисляется с
доказательством (id + вердикт ядра + данные строки). Решение о лечении принимается
человеком после чтения отчёта.
