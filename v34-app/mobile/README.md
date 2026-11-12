# Android-приложение CRYPTORA V3.4

React Native 0.88 + Expo SDK 58 + TypeScript. Приложение — только клиент:
оно запрашивает пары, свечи и сигналы у **нового** backend'а продукта V3.4 и
**не считает стратегию**. Ни TP/SL, ни безубыток, ни lifecycle не выводятся из
текущей цены на телефоне.

## Что умеет

- **«Пары»** — пары канонической конфигурации V3.4 (их отдаёт `/api/v1/meta`),
  график выбранной пары (свечи с `/api/v1/candles` от backend'а) и сигналы
  именно этой пары;
- уровни на графике — только серверные: коридор входа, `initialStopLoss`,
  TP1/TP2, действующий стоп BE. Нет стопа на сервере — нет линии стопа;
- **«Сигналы»** — общая лента (фильтр «открытые / все», автообновление раз в минуту);
- экран детали: коридор входа, первоначальный стоп, TP1/TP2, факт входа, события
  TP1✓/TP2✓/безубыток/стоп, действующий стоп, исход сделки, журнал с временами UTC;
- вкладка «О приложении»: параметры V3.4 из `/api/v1/meta`, источник данных, свежесть,
  состояние символов, честный статус push;
- явные состояния: загрузка / пусто / ошибка сети / устаревшие данные (баннер);
- регистрация FCM-токена при наличии Firebase-конфигурации.

Если адрес backend'а не задан при сборке, приложение открывается и показывает
«Сервер не настроен». Если сервер недоступен — «Сервер недоступен» с причиной.
Ни в одном из этих случаев не показываются «примерные» пары, свечи или сигналы.

Ключевые правила, закреплённые тестами:

| Правило | Где проверено |
|---|---|
| Нет `initialStopLoss` → «нет данных», а не цена входа | `__tests__/signalDetail.test.tsx`, `__tests__/chartLevels.test.ts` |
| Нет входа → «входа ещё не было» | `__tests__/signalDetail.test.tsx` |
| TP1/TP2/безубыток только по подтверждённым событиям | `__tests__/signalDetail.test.tsx` |
| Нет SL/BE на сервере → нет линий на графике | `__tests__/chartLevels.test.ts`, `__tests__/marketScreen.test.tsx` |
| Пары берутся из `/api/v1/meta`, а не из локального списка | `__tests__/marketScreen.test.tsx` |
| Смена пары перезапрашивает график и сигналы этой пары | `__tests__/marketScreen.test.tsx` |
| Ошибка сервера ≠ пустой список пары | там же |
| Ошибка графика не скрывает серверные сигналы | там же |
| Ошибки API различаются (network/timeout/http/parse/config) | `__tests__/apiClient.test.ts` |
| Свечи не пересчитываются на клиенте (форма проверяется) | `__tests__/apiClient.test.ts` |
| Bundle встроен в APK, CI собирает release и запускает эмулятор | `__tests__/standaloneApk.test.ts` |
| Push без Firebase — `unavailable`, а не «успех» | `__tests__/notifications.test.ts` |

## Проверки

```bash
cd v34-app/mobile
npm ci
npm run typecheck     # tsc --noEmit
npm test              # jest (jest-expo), 11 файлов / 83 теста
```

## Адрес backend'а

Задаётся при сборке, не зашит в код:

```bash
EXPO_PUBLIC_API_BASE_URL=https://signals.<ваш-домен>.fi npx expo start
# или через extra.apiBaseUrl в app.config.js (переменная окружения подставляется туда же)
```

Если адрес пуст, приложение показывает экран «Сервер не настроен» — это ожидаемое
поведение, а не баг.

## Standalone APK — без Metro

**Почему это отдельный раздел.** Debug-вариант React Native не содержит JS bundle:
он ищет Metro по adb-реверсу или сети. Установленный на телефон debug APK в этом
случае показывает `Unable to load script` и требует компьютер. Именно это и было
дефектом V3.4. Приложение должно запускаться **само**: без Metro, ПК, USB и LAN.

Правильный вариант — **release**: Metro-бандлер запускается на CI, результат
(Hermes-байткод) встраивается в APK как `assets/index.android.bundle`. Телефон
читает его локально и в сеть за кодом не ходит.

### Проверка, что bundle действительно внутри

```bash
node scripts/verify-standalone-apk.cjs android/app/build/outputs/apk/release/app-release.apk
# [OK] JS bundle встроен в APK — assets/index.android.bundle: 2xxxxxx Б, hermes
# ИТОГ: APK самостоятельный — JS bundle внутри, Metro не требуется.
```

Скрипт читает APK как zip (без внешних зависимостей) и проверяет: валидный архив,
`AndroidManifest.xml`, `classes.dex`, наличие и размер bundle, что содержимое —
Hermes-байткод или JS. На APK из debug-сборки он падает с прямым объяснением про
Metro. Та же проверка выполняется в CI **до** загрузки артефакта, поэтому
«APK собрался, но просит Metro» не может пройти незамеченным.

### Локальная сборка (нужны JDK 17+ и Android SDK)

```bash
cd v34-app/mobile
npm ci
npx expo prebuild -p android --clean --no-install
cd android
./gradlew assembleRelease          # standalone: bundle внутри
# проверка:
node ../scripts/verify-standalone-apk.cjs app/build/outputs/apk/release/app-release.apk
```

Подпись. Expo-шаблон подписывает release **стандартным debug-keystore из Android
SDK** (`android/app/debug.keystore`), если не настроен `signingConfigs.release`.
Это проверочная подпись, а не ключ владельца: такой APK ставится на телефон, но
**не является релизом** и не публикуется как релиз. Обновление поверх прежней
debug-сборки проходит: ключ тот же. Для настоящей публикации нужен keystore
владельца (`keystore.properties` вне Git / секреты CI) — в репозитории его нет и
быть не может.

### CI и эмулятор

`.github/workflows/v34-android-apk.yml`:

1. typecheck + jest (включая `__tests__/standaloneApk.test.ts`);
2. `expo prebuild` → `./gradlew assembleRelease`;
3. `scripts/verify-standalone-apk.cjs --min-bundle-bytes 200000`;
4. `aapt2 dump badging` / `apksigner verify`: package id, версия, подпись, SHA-256,
   проверка что APK **не** `debuggable`;
5. артефакт `v34-app-standalone-apk` (`app-release.apk` + `apk-facts.txt`);
6. job `emulator-smoke`: `adb install` + запуск на эмуляторе **без Metro**;
   `scripts/emulator-smoke.sh` проверяет, что процесс жив, экран приложения
   отрисован, а в logcat нет `Unable to load script`, попыток подключиться к
   dev-серверу и `FATAL EXCEPTION`.

Что CI **не** делает: не публикует APK как релиз, не выкладывает его на лендинг,
не требует keystore владельца и не имеет доступа к VPS.

### Ручная установка на телефон

```bash
adb install -r app-release.apk     # или скачать артефакт и открыть на телефоне
```

Metro, компьютер и USB после установки не нужны. Если backend ещё не развёрнут
или адрес не задан при сборке, приложение откроется и покажет «Сервер не настроен»
— это штатное поведение.

## Firebase / push

Чтобы уведомления действительно доходили, нужно **всё** перечисленное:

1. Firebase-проект и Android-приложение с package `com.nub36.cryptora.v34`.
2. `google-services.json` в `v34-app/mobile/` при сборке (в Git не попадает — см.
   `.gitignore`), подключение через плагин `expo-notifications`/`google-services`.
3. На сервере: `V34_PUSH_ENABLED=true`, `V34_FCM_PROJECT_ID`,
   `V34_FCM_SERVICE_ACCOUNT_FILE` (JSON сервисного аккаунта вне Git).
4. Проверка на реальном устройстве: регистрация токена → `POST /api/v1/devices` →
   публикация сигнала → факт доставки. **В окружении разработки это не проверялось.**

Без пунктов 1–3 приложение показывает «push не настроен» — это правда, а не заглушка.

## Статус

| Артефакт | Состояние |
|---|---|
| Исходники приложения | пары, график, сигналы; типы и тесты зелёные |
| Standalone APK | собирается release-вариантом в CI, bundle проверяется скриптом |
| Подпись | проверочная: стандартный debug-keystore; ключ владельца не используется |
| Push | интеграция написана, доставка не проверялась |
