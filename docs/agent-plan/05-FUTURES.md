# 05-FUTURES — Этап 5: Деривативный конвейер (OI, Funding, Basis)

> **Статус:** Выполнен (v0.5.0)  
> ⚠️ **ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Деривативные потоки, ставки финансирования и открытый интерес используются исключительно для мониторинга макроструктуры рынка, левереджа и аналитических наблюдений. Терминал не исполняет фьючерсные ордера, не открывает маржинальные позиции и не принимает торговые API-ключи.

---

## 1. Выполненные задачи

### 1.1. Адаптер публичных фьючерсных данных (`BinanceFuturesAdapter`)
- Файл: `src/services/data/adapters/BinanceFuturesAdapter.ts`
- Подключение к публичному REST API Binance USD-M Futures (`https://fapi.binance.com`) без авторизации и API-ключей.
- Эндпоинты с Zod-валидацией схем (`derivativesSchemas.ts`):
  - `GET /fapi/v1/premiumIndex`: Mark Price, Index Price, Last Funding Rate, Next Funding Time;
  - `GET /fapi/v1/openInterest`: количество открытых контрактов;
  - `GET /fapi/v1/ticker/24hr`: суточный объем перп-контрактов и процент изменения цены.
- Обработка ошибок сетевого уровня, лимитов (HTTP 429/418) и таймаутов через `AdapterError`.
- Инъекция сетевого вызова (`fetchFn`) для детерминированного тестирования без внешних зависимостей.

### 1.2. Расчетный движок деривативов (`DerivativesEngine`)
- Файл: `src/services/derivatives/DerivativesEngine.ts`
- **Годовая ставка фандинга (Annualized Funding Rate / APR):**
  $$\text{APR} = \text{FundingRate}_{8h} \times 3 \times 365$$
  (например, $0.01\% \times 1095 = 10.95\%$).
- **Базис (Contango vs Backwardation):**
  $$\text{Basis \%} = \frac{\text{MarkPrice} - \text{IndexPrice}}{\text{IndexPrice}} \times 100\%$$
  - Положительный базис ($> +0.02\%$) классифицируется как **CONTANGO** (фьючерс торгуется с премией к споту).
  - Отрицательный базис ($< -0.02\%$) классифицируется как **BACKWARDATION** (фьючерс торгуется с дисконтом к споту).
- **Открытый интерес в USD:**
  $$\text{OI}_{USD} = \text{Contracts} \times \text{MarkPrice}$$
- **Нормализация в каноническую модель `FuturesAsset`:**
  - Фиксация происхождения данных: `provenance: { exchange: 'binance', market: 'futures', symbol, timestamp }`.
  - Маркировка `isDemo: false`.
- **Агрегированный макро-обзор деривативов (`calculateAggregatedOverview`):**
  - Суммарный открытый интерес (USD);
  - Суммарный 24h объем деривативов;
  - Средневзвешенная ставка финансирования (8h и APR);
  - Общий рыночный режим (CONTANGO / BACKWARDATION / NEUTRAL);
  - Количество инструментов с экстремальным фандингом и потенциалом Short Squeeze.

### 1.3. Интеграция с провайдером живых данных (`LiveMarketDataProvider`)
- Обновлен метод `getFuturesList()`:
  - Параллельный опрос метрик финансирования и объемов;
  - Маппинг канонических активов;
  - Кэширование с TTL для защиты от лимитов биржи;
  - Изоляция сбоев: при недоступности возвращается прозрачный fallback.

### 1.4. Обновление пользовательского интерфейса `FuturesPage.tsx`
- Переключение в режим `LIVE DERIVATIVES (BINANCE FUTURES)`;
- Вывод расчетных макро-карточек: Суммарный OI, суточный объем, средний фандинг (8h / APR), рыночный режим;
- Быстрые фильтры фандинга (Все / Лонг > 0 / Шорт < 0 Short Squeeze Watch);
- Маркировка строк таблицы бейджем `LIVE`.

---

## 2. Верификация
- Vitest: 96 юнит-тестов успешно пройдены (13 тестовых люксов).
- TypeScript: 0 ошибок (`tsc --noEmit`).
- Production Build: успешно собран.
- Playwright E2E: 31 сквозной тест пройден со 100% успехом.
