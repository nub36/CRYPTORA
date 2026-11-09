# Android-приложение CRYPTORA V3.4

React Native 0.88 + Expo SDK 58 + TypeScript. Приложение — только клиент:
оно запрашивает ленту и детали сигналов у backend'а и **не считает стратегию**.
Ни TP/SL, ни статус сделки не выводятся из текущей цены на телефоне.

## Что умеет

- лента сигналов (фильтр «открытые / все», автообновление раз в минуту);
- экран детали: коридор входа, первоначальный стоп, TP1/TP2, факт входа, события
  TP1✓/TP2✓/безубыток/стоп, действующий стоп, исход сделки, журнал с временами UTC;
- вкладка «О приложении»: параметры V3.4 из `/api/v1/meta`, источник данных, свежесть,
  состояние символов, честный статус push;
- явные состояния: загрузка / пусто / ошибка сети / устаревшие данные (баннер);
- регистрация FCM-токена при наличии Firebase-конфигурации.

Ключевые правила, закреплённые тестами:

| Правило | Где проверено |
|---|---|
| Нет `initialStopLoss` → «нет данных», а не цена входа | `__tests__/signalDetail.test.tsx` |
| Нет входа → «входа ещё не было» | там же |
| TP1/TP2/безубыток только по подтверждённым событиям | там же |
| Устаревшие данные помечаются баннером | `__tests__/signalsList.test.tsx` |
| Ошибка сети ≠ пустой список | там же |
| Ошибки API различаются (network/timeout/http/parse/config) | `__tests__/apiClient.test.ts` |
| Push без Firebase — `unavailable`, а не «успех» | `__tests__/notifications.test.ts` |

## Проверки

```bash
cd v34-app/mobile
npm install
npm run typecheck     # tsc --noEmit
npm test              # jest (jest-expo), 7 файлов / 41 тест
```

Проверено в окружении разработки: `tsc` — без ошибок, `jest` — 41/41.

## Адрес backend'а

Задаётся при сборке, не зашит в код:

```bash
EXPO_PUBLIC_API_BASE_URL=https://signals.example.com npx expo start
# или через extra.apiBaseUrl в app.config.js (переменная окружения подставляется туда же)
```

Если адрес пуст, приложение показывает экран «Сервер не настроен» — это ожидаемое
поведение, а не баг.

## Сборка APK

### Вариант A — EAS Build (облако Expo)

```bash
cd v34-app/mobile
npm install -g eas-cli
eas login
eas init                              # создаёт projectId в extra.eas
EXPO_PUBLIC_API_BASE_URL=https://signals.example.com \
  eas build -p android --profile preview
# профиль preview собирает APK (buildType: apk), ссылка на артефакт — в выводе
```

Подпись: EAS управляет keystore (`eas credentials`). Для релиза нужен **ключ владельца**:
загрузить существующий keystore в EAS или передать `credentials.json`. Пароли keystore
никогда не попадают в репозиторий.

### Вариант B — локальная сборка (нужны JDK 17+ и Android SDK)

```bash
cd v34-app/mobile
npx expo prebuild -p android --clean
cd android
# debug-сборка (подписывается debug-ключом, НЕ релиз):
./gradlew assembleDebug
# релизная сборка — только со своим keystore в android/keystore.properties (вне Git):
#   storeFile=... storePassword=... keyAlias=... keyPassword=...
./gradlew assembleRelease
```

Для релизной сборки добавьте в `android/app/build.gradle` `signingConfigs.release`
с чтением `keystore.properties` из переменных окружения — файл ключа в Git не кладётся.

### Вариант C — GitHub Actions

`.github/workflows/v34-android-apk.yml` в корне репозитория собирает **debug** APK и
складывает артефакт. Это проверочная сборка: она подписана debug-ключом и не может
считаться релизом. Релизная подпись требует keystore владельца в секретах CI.

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
| Исходники приложения | готовы, типы и тесты зелёные |
| APK | **не собран**: в окружении разработки нет JDK/Android SDK |
| Подпись | нет keystore владельца; возможна только debug-сборка |
| Push | интеграция написана, доставка не проверялась |
