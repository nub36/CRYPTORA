# 04-COIN-PAGES — Этап 4: Углубленные карточки активов и Индикаторный движок

> **Статус:** Выполнен (v0.4.0)  
> ⚠️ **ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Стаканы цен L2, временные ряды и расчетные индикаторы служат исключительно для аналитики и визуального наблюдения. Платформа не предоставляет кнопок выставления ордеров и не исполняет сделки.

---

## 1. Выполненные задачи

### 1.1. Биржевой стакан Level 2 (`OrderBookL2`)
- Файл: `src/components/market/OrderBookL2.tsx`
- Интерактивная визуализация биржевого стакана L2:
  - Bids (зеленый) и Asks (красный) с отображением цены, размера и кумулятивной суммы;
  - Визуальные индикаторы относительной глубины (depth bars) для оценки баланса ликвидности;
  - Расчет Mid Price, абсолютного спреда в USD и относительного спреда в базисных пунктах (bps);
  - Интеграция с потоком `depth:<symbol>` через `RealtimeFeedManager`.

### 1.2. Высокопроизводительный индикаторный движок (`IndicatorEngine`)
- Файл: `src/services/indicators/IndicatorEngine.ts`
- Строгие математические расчеты:
  - **SMA** (Simple Moving Average: 20, 50, 200);
  - **EMA** (Exponential Moving Average с коэффициентом сглаживания $\alpha = \frac{2}{N+1}$);
  - **RSI** (Relative Strength Index по методу Уайлдера с 14-периодным сглаживанием);
  - **MACD** (Moving Average Convergence Divergence: 12 EMA - 26 EMA, 9 Signal, Histogram);
  - **Bollinger Bands** (Middle 20 SMA, Upper +2σ, Lower -2σ, Bandwidth %);
  - **ATR** (Average True Range, 14-периодный расчет волатильности);
  - **VWAP** (Volume-Weighted Average Price по типичной цене);
  - **Volume Profile** (Point of Control - POC, Value Area High/Low - VAH/VAL на базе 70% распределения объема);
  - **CVD** (Cumulative Volume Delta — кумулятивная оценка перевеса покупателей/продавцов).

### 1.3. Хранилище временных рядов и детекция пробелов (`TimeSeriesRepository`)
- Файл: `src/services/storage/TimeSeriesRepository.ts`
- Интерфейс `TimeSeriesRepository` и реализация `MemoryTimeSeriesRepository`:
  - Сохранение и автоматическая дедупликация свечей по временной метке `time`;
  - Гарантированная хронологическая сортировка (`oldest -> newest`);
  - Детекция пропусков в истории (`detectGaps`) с фиксацией потерянных интервалов;
  - Ограничение размера кэша с вытеснением старых свечей для безопасности оперативной памяти.

### 1.4. Обновление интерфейса `CoinDetailPage.tsx`
- Динамический пересчет индикаторов на основе загруженных таймсерий свечей;
- Интеграция компонента биржевого стакана L2;
- Детализация рыночных пар (Spot Market) со спредами и объемами;
- Вывод индикатора ATR(14) и VWAP.

---

## 2. Верификация
- Vitest: 87 юнит-тестов успешно пройдены (12 тестовых люксов).
- TypeScript: 0 ошибок (`tsc --noEmit`).
- Production Build: успешно собран.
- Playwright E2E: 31 сквозной тест пройден со 100% успехом.
