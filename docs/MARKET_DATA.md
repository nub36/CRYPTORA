# MARKET_DATA — Контракты и управление рыночными данными

> **Статус:** Спецификация контрактов и демонстрационного слоя (Этап 1 & 2)

---

## 1. Контракт провайдера данных (MarketDataProvider)

Архитектурный интерфейс `MarketDataProvider` определяет метод доступа ко всем рыночным структурам данных:

```typescript
export interface MarketDataProvider {
  // Обзор рынка
  getMarketOverview(): Promise<MarketOverviewData>;

  // Список активов для таблицы котировок
  getAssets(category?: AssetCategory): Promise<AssetSummary[]>;

  // Детализированные данные одного инструмента
  getAssetDetail(symbol: string): Promise<AssetDetail | null>;

  // Свечные данные для графиков
  getCandles(symbol: string, timeframe: Timeframe): Promise<OHLCV[]>;

  // Деривативный срез
  getFuturesList(): Promise<FuturesAsset[]>;

  // Сводка и поток ликвидаций
  getLiquidations(): Promise<LiquidationData>;

  // Поток аномальных событий радара
  getRadarEvents(): Promise<RadarEvent[]>;

  // Фильтрация скринера
  getScreenerResults(filters: ScreenerFilters): Promise<AssetSummary[]>;
}
```

---

## 2. Гарантии Demo-слоя (Этап 1)

1. **Детерминированность:**  
   Данные не генерируются через `Math.random()`. Все значения (цены, объемы, история свечей, значения RSI) зафиксированы в типизированных структурах.
2. **Маркировка:**  
   Каждый объект данных содержит системный флаг `isDemo: true`, а также временную метку фиксации `demoTimestamp`.
3. **Реалистичность соотношений:**  
   Котировки и капитализации отражают реальный баланс криптовалютного рынка (BTC > ETH > SOL > BNB), значения Funding Rate находятся в реалистичном коридоре (обычно от -0.1% до +0.1%), показатели RSI математически согласованы с направлением тренда на свечах.
