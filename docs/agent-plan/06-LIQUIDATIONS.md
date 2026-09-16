# 06-LIQUIDATIONS — Этап 6: Поток ликвидаций и расчетная тепловая карта

> **Статус:** Выполнен (v0.6.0)  
> ⚠️ **ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Модуль ликвидаций предназначен исключительно для оценки зон каскадного рыночного давления и плечевого перекоса. Терминал не выставляет ликвидационные заявки и не совершает сделок. Обязательно соблюдается методологический дисклеймер: `Actual != Estimated`.

---

## 1. Выполненные задачи

### 1.1. Конвейер ликвидаций (`LiquidationPipeline`)
- Файл: `src/services/liquidations/LiquidationPipeline.ts`
- Прием и парсинг WebSocket сообщений `forceOrder` (Binance USD-M Futures).
- Агрегация скользящих метрик за 24 часа:
  - Суммарный объем принудительных ликвидаций (USD);
  - Объемы ликвидированных длинных (Long) и коротких (Short) позиций;
  - Long/Short ликвидационное соотношение (Ratio);
  - Разбивка по биржам (Binance, Bybit, OKX) и базовым активам (BTC, ETH, SOL и др.).

### 1.2. Расчетная модель кластеров риска (Estimated Liquidation Clusters)
- Математический расчет теоретических зон скопления ликвидаций на основе плечевых мультипликаторов ($10\times, 25\times, 50\times, 100\times$):
  $$\text{Long Liq Price} = \text{Current Price} \times \left(1 - \frac{1}{\text{Leverage}}\right)$$
  $$\text{Short Liq Price} = \text{Current Price} \times \left(1 + \frac{1}{\text{Leverage}}\right)$$
- Расчет плотности риска и ожидаемого ликвидационного объема в долларовом выражении.

### 1.3. Интеграция с UI и `LiveMarketDataProvider`
- Подключение метода `getLiquidations()` к `LiquidationPipeline.getInstance().getLiquidationSnapshot()`.
- Обновление страницы `src/pages/LiquidationsPage.tsx`:
  - Вывод бейджа живого потока `LIVE LIQUIDATIONS STREAM`;
  - Интерактивная тепловая карта расчетных кластеров ликвидаций;
  - Сохранение строгого юридического и методологического дисклеймера: фактические ликвидации бирж четко отделены от расчетных уровней модели.

---

## 2. Верификация
- Vitest: 5 тестов в `tests/unit/liquidations.test.ts`.
- TypeScript: 0 ошибок (`tsc --noEmit`).
- E2E: сквозной тест `Liquidations: verified actual vs estimated disclaimer, ratio gauge and event log` пройден.
