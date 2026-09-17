# INDICATORS — Каталог и спецификация технических индикаторов

> **Статус:** Документация математического аппарата (Этап 1: Документация и демонстрация; Этап 2+: Чистый расчетный движок)

---

## 1. Базовый математический каталог

В CRYPTORA категорически запрещено использовать языковые модели (LLM) для численных расчетов технических индикаторов. Все индикаторы должны вычисляться детерминированными чистыми функциями на языке TypeScript / Rust / Python.

### Каталог индикаторов первой очереди
1. **SMA (Simple Moving Average):**
   $$SMA_t = \frac{1}{n} \sum_{i=0}^{n-1} P_{t-i}$$
   Стандартные периоды: 20, 50, 100, 200.
2. **EMA (Exponential Moving Average):**
   $$EMA_t = \alpha \cdot P_t + (1 - \alpha) \cdot EMA_{t-1}, \quad \alpha = \frac{2}{n + 1}$$
   Стандартные периоды: 9, 21, 50, 200.
3. **RSI (Relative Strength Index):**
   $$RSI = 100 - \frac{100}{1 + RS}, \quad RS = \frac{SmoothedGain}{SmoothedLoss}$$
   Стандартный период: 14. Экстремумы: <30 (перепроданность), >70 (перекупленность).
4. **MACD (Moving Average Convergence Divergence):**
   $$MACD = EMA_{12}(P) - EMA_{26}(P), \quad Signal = EMA_9(MACD), \quad Histogram = MACD - Signal$$
5. **Bollinger Bands (BB):**
   $$Middle = SMA_{20}(P), \quad Upper = Middle + 2\sigma, \quad Lower = Middle - 2\sigma$$
6. **ATR (Average True Range):**
   $$TR = \max(High - Low, |High - Close_{prev}|, |Low - Close_{prev}|)$$
   Период: 14. Мера абсолютной волатильности инструмента.
7. **VWAP (Volume Weighted Average Price):**
   $$VWAP = \frac{\sum (TypicalPrice \cdot Volume)}{\sum Volume}, \quad TypicalPrice = \frac{High + Low + Close}{3}$$

---

## 2. Специализированные рыночные и деривативные индикаторы

После запуска базового расчетного конвейера будут подключены:
1. **CVD (Cumulative Volume Delta):**
   Накопительная разница между объемами агрессивных покупок (рыночный спрос по ask) и агрессивных продаж (рыночное предложение по bid).
2. **Volume Profile (VPVR):**
   Горизонтальное распределение проторгованного объема по ценовым уровням за выбранный период (Point of Control - POC, Value Area High - VAH, Value Area Low - VAL).
3. **Relative Volume (RVOL):**
   Отношение текущего объема бара к среднему объему того же времени суток за N предыдущих дней.
4. **Market Breadth (Широта рынка):**
   Процент активов выше своей 50/200-дневной скользящей средней, соотношение растущих к падающим инструментам (Advance/Decline Ratio).
