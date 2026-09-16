# 07-INDICATORS — Этап 7: Движок технических индикаторов

> **Статус:** Выполнен (v0.6.0)  
> ⚠️ **ИНВАРИАНТ:** **CRYPTORA DOES NOT EXECUTE TRADES.**  
> Все индикаторы рассчитываются как детерминированные математические функции поверх рядов OHLCV. Индикаторы предназначены исключительно для аналитической визуализации и параметрического скрининга. Терминал не генерирует торговые приказы на основе индикаторов.

---

## 1. Выполненные задачи

### 1.1. Индикаторный движок (`IndicatorEngine`)
- Файл: `src/services/indicators/IndicatorEngine.ts`
- Реализованные математические функции:
  - **SMA** (Simple Moving Average) произвольного периода;
  - **EMA** (Exponential Moving Average) с коэффициентом $\alpha = \frac{2}{N + 1}$;
  - **RSI** (Relative Strength Index) по сглаженному методу Уайлдера (14 периодов);
  - **MACD** (Moving Average Convergence Divergence, 12, 26, 9) с линиями MACD, сигнальной линией и гистограммой;
  - **Bollinger Bands** (20 SMA, $\pm 2\sigma$, %B);
  - **ATR** (Average True Range) для оценки диапазона волатильности;
  - **VWAP** (Volume-Weighted Average Price) со взвешиванием по объемам свечей;
  - **Cumulative Volume Delta (CVD)** для оценки накопленной рыночной дельты;
  - **Volume Profile** с расчетом Point of Control (POC), Value Area High (VAH) и Value Area Low (VAL).

### 1.2. Интеграция с UI
- Построение индикаторных слоев в интерактивных графиках TradingView Lightweight Charts на страницах `OverviewPage.tsx` и `CoinDetailPage.tsx`.

---

## 2. Верификация
- Vitest: 9 тестов в `tests/unit/indicators.test.ts`.
- TypeScript: 0 ошибок (`tsc --noEmit`).
