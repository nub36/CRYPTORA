# CRYPTORA — Health monitoring, freshness и alert'ы

Документ описывает контракт эндпоинтов здоровья, пороги свежести данных и
правила Telegram-оповещений. Всё, что здесь написано, закреплено тестами
(`tests/unit/health*.test.ts`, `tests/integration/healthEndpointPostgres.test.ts`).

---

## 1. Эндпоинты

### `GET /api/health/live` — liveness

```json
{ "status": "alive", "timestamp": "…", "uptimeSeconds": 1234, "pid": 42 }
```

Всегда **200**, если процесс способен ответить. БД НЕ проверяется сознательно:
liveness-проба, ходящая в базу, перезапускала бы здоровый процесс во время
аварии базы — то есть усиливала бы отказ вместо защиты.

### `GET /api/health/ready` — readiness

```json
{
  "status": "ready | not_ready",
  "timestamp": "…",
  "database": { "status": "ok|error", "latencyMs": 3, "errorCode": null },
  "subsystems": {
    "signalMonitor":     { "initialized": true, "lastCycleAt": "…" },
    "strategyScheduler": { "initialized": true, "lastCycleAt": "…" }
  }
}
```

**200** когда БД доступна И критические подсистемы инициализированы,
иначе **503**. «Инициализирована» = цикл стартовал, а не «успел отработать
удачно»: иначе первая минута после каждого рестарта выглядела бы как авария.

### `GET /api/health` — полный отчёт

```json
{
  "status": "ok | degraded | error",
  "timestamp": "2026-10-05T12:00:00.000Z",
  "uptimeSeconds": 86400,
  "version": "0.9.3",
  "environment": "production",
  "database": {
    "status": "ok | error",
    "latencyMs": 3,
    "errorCode": null,          // TIMEOUT | UNAVAILABLE | null
    "slowThresholdMs": 500
  },
  "marketData": {
    "status": "ok | stale | error",
    "lastSuccessfulUpdate": "…",
    "ageSeconds": 42,
    "staleThresholdSeconds": 900,
    "feeds": {
      "binance-spot-candles": {
        "exchange": "binance", "market": "spot", "kind": "candles",
        "critical": true, "observed": true,
        "status": "ok | stale | error | unobserved",
        "reason": null,
        "sourceTimestamp": "…",   // время БИРЖИ
        "receivedAt": "…",        // время ПРИЁМА
        "ageSeconds": 30, "sourceAgeSeconds": 70,
        "thresholdSeconds": 900, "successes": 120, "failures": 0
      }
      // … остальные потоки
    }
  },
  "signalMonitor": {
    "status": "ok | starting | stale | error",
    "lastCycleStartedAt": "…", "lastCycleCompletedAt": "…",
    "lastSuccessfulCycleAt": "…", "lastCycleAt": "…",
    "ageSeconds": 15, "durationMs": 120, "cycles": 2880,
    "inspectedSignals": 7, "updatedSignals": 1,
    "errors": 0, "consecutiveFailures": 0,
    "reason": null, "staleThresholdSeconds": 300
  },
  "radarMonitor":      { /* та же форма */ },
  "strategyScheduler": { /* та же форма */ },
  "thresholds": { /* действующие пороги */ }
}
```

**HTTP-коды**

| status | HTTP | Когда |
|---|---|---|
| `ok` | 200 | всё здорово |
| `degraded` | 200 | подсистема устарела/сбоит, но запросы обслуживаются |
| `error` | 503 | БД недоступна — работать нечем |

`degraded` намеренно отдаёт **200**: выводить узел из ротации при устаревшем
мониторе означало бы отнять у пользователя работающее чтение.

**Секреты.** В ответе нет и не может быть `DATABASE_URL`, токенов, e-mail,
chat id и текста ошибок драйвера БД. Ошибка базы отдаётся категорией, потому
что сообщение pg содержит хост, порт и имя базы. Это проверяется тестом при
каждом прогоне CI, а не держится на внимательности ревьюера.

**Стоимость запроса.** Один `SELECT 1` с таймаутом + чтение in-memory
телеметрии. Ни обхода таблицы `signals`, ни запросов к биржам.

---

## 2. Контракт свежести рыночных данных

Свежесть описывается **двумя** независимыми временами:

| Поле | Смысл |
|---|---|
| `sourceTimestamp` | время, проставленное БИРЖЕЙ (closeTime последней закрытой свечи, eventTime тикера, момент свипа OI) |
| `receivedAt` | когда наш процесс получил этот ответ |

Данные здоровы, только если свежи **оба**. «HTTP-запрос прошёл» свежестью не
является: биржа может вернуть 200 OK с серией, последняя свеча которой
закрылась три часа назад, а кэш может обслуживать «последний удачный» ответ
после сбоя апстрима.

### Наблюдаемые потоки

| feedId | Биржа / рынок | Тип | Критичен | Где публикуется |
|---|---|---|---|---|
| `binance-spot-candles` | Binance Spot | свечи | да | `marketDataFetcher` (движок и монитор) + шлюз |
| `binance-spot-ticker` | Binance Spot | тикер | да | `radarMonitor.processTicker` |
| `binance-futures-snapshot` | Binance USD-M | тикер/снапшот | нет | `futuresMarketSnapshotPayload` |
| `binance-futures-funding` | Binance USD-M | funding | нет | `futuresMarketSnapshotPayload` |
| `binance-futures-open-interest` | Binance USD-M | open interest | нет | свип OI |
| `kucoin-spot-candles` | KuCoin Spot | свечи/тикеры | нет | шлюз `/api/market/kucoin/*` |

«Критичен» = деградация потока деградирует весь бэкенд. Деривативы
участвуют в аналитике, но сигнальные стратегии на них не строятся, поэтому
их устаревание не переводит сервис в `degraded`.

### Пороги

| Порог | Default | Переменная окружения |
|---|---|---|
| Возраст приёма → `stale` | 900 с | `HEALTH_MARKET_DATA_STALE_SECONDS` |
| Возраст приёма → `error` | 3600 с | `HEALTH_MARKET_DATA_ERROR_SECONDS` |
| Допуск отставания источника, свечи | длительность бара + 600 с | `HEALTH_CANDLE_SOURCE_LAG_SECONDS` |
| Допуск отставания источника, тикер | 120 с | `HEALTH_TICKER_SOURCE_LAG_SECONDS` |
| Допуск отставания источника, деривативы | 300 с | `HEALTH_DERIVATIVES_SOURCE_LAG_SECONDS` |
| Монитор сигналов → `stale` / `error` | 300 / 1800 с | `HEALTH_SIGNAL_MONITOR_STALE_SECONDS`, `…_ERROR_SECONDS` |
| Подряд идущих отказов монитора → `error` | 5 | `HEALTH_SIGNAL_MONITOR_MAX_FAILURES` |
| Radar monitor → `stale` / `error` | 300 / 1800 с | `HEALTH_RADAR_MONITOR_STALE_SECONDS`, `…_ERROR_SECONDS` |
| Планировщик стратегий → `stale` / `error` | 300 / 1800 с | `HEALTH_STRATEGY_SCHEDULER_STALE_SECONDS`, `…_ERROR_SECONDS` |
| Таймаут `SELECT 1` | 2000 мс | `HEALTH_DB_TIMEOUT_MS` |
| Грейс после старта процесса | 180 с | `HEALTH_STARTUP_GRACE_SECONDS` |
| Cooldown Telegram | 1800 с | `HEALTH_ALERT_COOLDOWN_SECONDS` |
| Подтверждений до alert'а | 2 | `HEALTH_ALERT_MIN_OBSERVATIONS` |

**Обоснование.** Монитор сигналов тикает каждые 30 с ⇒ `stale` наступает
после десяти пропущенных тиков, а не после одного. Планировщик тикает каждые
15 с ⇒ после двадцати. Свечи 1h обновляются раз в час, поэтому возраст
источника сравнивается с «длительность бара + допуск», а не с константой.

**Разбор env.** Принимаются только целые положительные значения; `0`
запрещён (порог 0 означал бы «всё всегда просрочено»). Некорректное значение
ИГНОРИРУЕТСЯ с записью в лог — имя переменной печатается, значение нет.
`error`-порог автоматически поднимается до `stale`-порога, если задан ниже.

### Запрет подмены

Устаревшие данные помечаются `stale` и остаются устаревшими. Автоматической
подстановки demo/фикстурных данных вместо реальных нет ни в одном пути —
это была бы фальсификация рынка, а не деградация.

---

## 3. Телеметрия циклов

Каждый периодический цикл публикует:

`lastCycleStartedAt` · `lastCycleCompletedAt` · `lastSuccessfulCycleAt` ·
`durationMs` · `cycles` · `inspectedSignals` · `updatedSignals` · `errors` ·
`consecutiveFailures`

| Подсистема | Что считается «циклом» | Где |
|---|---|---|
| `signalMonitor` | тик наблюдения за открытыми сигналами (30 с) | `signalMonitor.finishTick` |
| `strategyScheduler` | тик планировщика (15 с) | `StrategyScheduler.tick` |
| `radarMonitor` | обновление эффективной Scan Universe | `RadarMonitor.refreshUniverse` |

`lastSuccessfulCycleAt` двигается ТОЛЬКО при успешном цикле. Цикл, который
отработал, но ничего не смог сделать из-за отказа зависимости, успешным не
считается — иначе `stale` был бы недостижим при постоянной аварии.

**Отдельного таймера ради health НЕТ.** Телеметрию публикуют уже
существующие циклы; health только читает её из памяти.

---

## 4. Telegram alert'ы

### Доставка

Используется СУЩЕСТВУЮЩИЙ слой `notificationChannels.deliverSavedTelegram`:
тот же бот, та же расшифровка токена, тот же `notification_delivery_log`.
Второго бота не заводится.

Получатели — пользователи с `role = 'admin'` и включённым Telegram-каналом.
Health — операционное событие; рассылать его всем пользователям было бы и
шумом, и раскрытием эксплуатационного состояния.

### Коды

`DATABASE_DOWN` · `MARKET_DATA_STALE` · `SIGNAL_MONITOR_STALE` ·
`RADAR_MONITOR_STALE` · `STRATEGY_SCHEDULER_STALE` · плюс восстановление
`<CODE>_RECOVERED`.

### Формат

```
🔴 CRYPTORA HEALTH
Signal monitor stale
Last cycle: 8m 42s ago
status: stale
```

```
🟢 CRYPTORA RECOVERED
Signal monitor healthy again
Degraded for: 15m 0s
```

### Правила тишины

1. **Подтверждение** — проблема должна наблюдаться `alertMinConsecutiveObservations`
   циклов подряд (по умолчанию 2). Одиночный провал тика человека не будит.
2. **Дедупликация** — пока состояние проблемы не изменилось, повторное
   сообщение не формируется.
3. **Cooldown** — повтор по той же проблеме не раньше, чем через
   `alertCooldownSeconds` (30 минут). При непрерывной аварии приходит не
   больше двух сообщений в час на проблему.
4. **Восстановление** — проблема, о которой СООБЩАЛИ, получает ровно одно
   `RECOVERED`. Проблема, о которой не сообщали (не прошла подтверждение),
   ложного «восстановления» не порождает.
5. **Неудачная доставка не считается доставкой** — cooldown не включается,
   иначе проблема, о которой никто не узнал, замолчала бы на 30 минут.
6. `starting` (грейс-период после рестарта) проблемой не считается: каждый
   деплой иначе слал бы ложную тревогу.

### Устойчивость

Alert'ы висят на уже работающем цикле монитора сигналов
(`notifyHealthCycle`) и троттлятся до одной проверки в минуту. Хук
fire-and-forget: любая ошибка Telegram, сети или БД поглощается и не может
прервать наблюдение за сигналами.

---

## 5. Read-only диагностика

```bash
npm run audit:production-health        # PASS / WARN / FAIL
npm run audit:production-health -- --json
AUDIT_VERBOSE=1 npm run audit:production-health
```

Проверяет: подключение к БД · статус миграций · полноту provenance ·
невозможный порядок временны́х меток · дубликаты · аномалии открытых
сигналов · телеметрию монитора · свежесть рыночных данных по следам в БД ·
согласованность статистики.

Скрипт выполняется внутри `BEGIN READ ONLY … ROLLBACK`, пропускает только
`SELECT/WITH/SHOW/TABLE` и маскирует DSN. Код выхода: `0` для PASS/WARN,
`1` для FAIL.
