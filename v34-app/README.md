# CRYPTORA V3.4 — отдельный продукт (backend + Android + лендинг)

Самодостаточный продукт вокруг стратегии **V3.4** из репозитория `nub36/CRYPTORA`.
Существующий CRYPTORA не изменяется: код стратегии скопирован в этот каталог
замороженным снимком, вся продуктовая обвязка написана заново.

```
v34-app/
├── packages/v34-core/   точные копии логики V3.4/V3.3 + движок скана
├── server/              backend: Binance → V3.4 → SQLite → REST API
├── mobile/              React Native + Expo + TypeScript приложение
├── landing/             статический лендинг со скачиванием APK
└── deploy/              systemd, nginx, установка на новый VPS
```

## Что именно считается стратегией

| Параметр | Значение |
|---|---|
| id | `V3_4_HTF_ZONE_MITIGATION_QUALITY` |
| версия | `3.4` |
| таймфреймы | исполнение `1h`, контекст `4h` |
| символы | BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, DOGEUSDT |
| скан | каждые 60 с, прогрев 60 баров |
| гейты V3.4 | коридор +0.25·ATR к 0.10·ATR от V3.3; TP1 ≥ 0.50R, TP2 ≥ 1.00R |
| бейдж | `DERIVED_NO_BACKTEST` — производная логика, **не** проверенный бэктест |
| frozen settings | sha256 `92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9` |

V3.4 = V3.3 replay + два отличия: расширенный коридор входа и гейты качества целей.
Числа не менялись и не «улучшались»: копии сверены побайтово, кроме строк импорта
(см. `packages/v34-core/test/parity.sources.test.ts`).

## Данные рынка

Публичные свечи Binance spot: `GET https://api.binance.com/api/v3/klines`
(`1h`/`4h`, до 1000 баров за запрос). API-ключи не нужны и не используются.
Ордера не выставляются, к торговому счёту сервер не подключается.

## Быстрый старт (локально)

```bash
cd v34-app
npm install
npm test                 # ядро + сервер
npm run typecheck        # ядро + сервер
npm run lint             # eslint по ядру, серверу и мобильному коду
npm run build            # server/dist/server.mjs
NODE_OPTIONS=--experimental-sqlite V34_PORT=8080 V34_STATIC_DIR=./landing npm start
# http://127.0.0.1:8080/            — лендинг
# http://127.0.0.1:8080/api/v1/meta — описание стратегии и состояние данных
```

Мобильное приложение (отдельная установка, не входит в npm workspaces):

```bash
cd v34-app/mobile
npm install
npm run typecheck
npm test
EXPO_PUBLIC_API_BASE_URL=https://signals.example.com npx expo start
```

## Проверки

| Что | Команда | Результат |
|---|---|---|
| Парити с оригиналом | `cd packages/v34-core && npx vitest run` | 9 файлов, 67 тестов |
| Backend/API | `cd server && NODE_OPTIONS=--experimental-sqlite npx vitest run` | 8 файлов, 70 тестов |
| Типы (ядро+сервер) | `npx tsc --noEmit -p packages/v34-core/tsconfig.json` и `-p server/tsconfig.json` | без ошибок |
| Сборка | `npm run build` | `server/dist/*.mjs` |
| Линт | `npm run lint` | без ошибок |
| Android-экраны | `cd mobile && npx jest` | 7 файлов, 41 тест |
| Типы приложения | `cd mobile && npx tsc --noEmit -p tsconfig.json` | без ошибок |

## API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/health` | живость процесса |
| GET | `/api/v1/meta` | стратегия, источник данных, свежесть, состояние символов, push |
| GET | `/api/v1/signals` | лента: `status`, `direction`, `symbol`, `limit` ≤ 100, `cursor` |
| GET | `/api/v1/signals/:id` | уровни, события, прогресс TP1/TP2, действующий стоп |
| POST | `/api/v1/devices` | регистрация FCM-токена (rate-limited) |
| GET | `/api/v1/apk` | манифест APK: версия, размер, SHA-256 или честное «нет» |

Принципы, которые зафиксированы тестами:

- клиент ничего не считает: нет SL на сервере — в ответе `initialStopLoss: null`, и UI
  показывает «нет данных», **никогда** цену входа;
- `currentStop` появляется только когда безубыток подтверждён событием и позиция открыта;
- устаревшие данные помечаются `stale: true` + причина; свежими не выдаются;
- ошибки различаются: `network` / `timeout` / `http` / `parse` / `config`.

## Push-уведомления

Реальная отправка через FCM (`jose` + OAuth сервисного аккаунта). Пока не заданы
`V34_PUSH_ENABLED=true`, `V34_FCM_PROJECT_ID`, `V34_FCM_SERVICE_ACCOUNT_FILE`,
сервер отвечает `configured:false` и перечисляет отсутствующие настройки, а приложение
честно показывает «push не настроен». Доставка на реальное устройство **не проверялась** —
в окружении разработки нет ни Firebase, ни собранного APK.

## Статус сборки APK

APK в репозитории нет и в окружении разработки быть не может: нет JDK/Android SDK.
См. `mobile/README.md` — там точный порядок сборки, подписи и что нужно от владельца.

## Развёртывание

Ничего не развёрнуто: доступ к VPS (`v34-app-vps`) не предоставлен, домен не выдан.
Все конфиги и скрипты лежат в `deploy/`, там же таблица «что сделано / что нужно».
