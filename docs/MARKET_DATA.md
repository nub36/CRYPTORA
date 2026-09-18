# MARKET_DATA — Контракты и управление рыночными данными

> **Статус:** Спецификация контрактов, демонстрационного слоя и спотовых адаптеров (Этап 1 & 2)

---

## 1. Контракт провайдера данных (MarketDataProvider)

Архитектурный интерфейс `MarketDataProvider` определяет метод доступа ко всем рыночным структурам данных:

```typescript
export interface MarketDataProvider {
  readonly isDemo: boolean;

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

## 2. Канонический реестр активов (Asset Registry — Этап 2)

В Этапе 2 подключается начальный контролируемый universe из **25 криптоактивов**:
`BTC`, `ETH`, `SOL`, `BNB`, `XRP`, `ADA`, `DOGE`, `AVAX`, `LINK`, `DOT`,
`SUI`, `NEAR`, `APT`, `RENDER`, `TAO`, `INJ`, `UNI`, `AAVE`, `OP`, `ARB`,
`TIA`, `FET`, `KAS`, `RUNE`, `SEI`.

Каждый инструмент описан в централизованном реестре:
- Канонический тикер (`symbol`: e.g. `BTC`)
- Наименование (`name`: e.g. `Bitcoin`)
- Сектор (`category`: e.g. `Layer 1`, `DeFi`, `AI`, `Layer 2`)
- Символ биржи Binance (`binanceSymbol`: e.g. `BTCUSDT`)
- Символ биржи KuCoin (`kucoinSymbol`: e.g. `BTC-USDT`)
- Порядковый номер в каноническом рейтинге (`rank`: 1..25)

---

## 3. Происхождение данных (Data Provenance)

Каждая запись, поступающая из внешнего биржевого источника, маркируется метаданными происхождения:

```typescript
export interface DataProvenance {
  exchange: 'binance' | 'kucoin' | 'synthetic-demo';
  market: 'spot' | 'futures';
  symbol: string;
  timestamp: number;
  isFallback?: boolean;
}
```

---

## 4. Архитектура адаптеров и Fallback

1. **Primary Source (Binance):**
   - Запросы 24h ticker, klines и метаданных направляются на `https://api.binance.com` (резервный шлюз `data-api.binance.vision`).
   - Ответ проходит runtime-валидацию схемой Zod.
2. **Secondary Source / Fallback (KuCoin):**
   - В случае сетевой ошибки, недоступности пары на Binance или превышения лимитов запросов, опрашивается KuCoin REST API (`https://api.kucoin.com`).
   - При успешном получении устанавливается флаг `isFallback: true` и `exchange: 'kucoin'`.
3. **Разделение DEMO и LIVE:**
   - Если и первичный, и вторичный источники живых данных недоступны, Live-провайдер возвращает явную ошибку / статус недоступности (`unavailable`).
   - **Строго запрещено** скрывать сетевые сбои подмешиванием демонстрационных цифр под вывеской LIVE.
