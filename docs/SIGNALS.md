# SIGNALS — LIVE-сетапы архивных стратегий и неизменяемый журнал

> **КРИТИЧЕСКОЕ ПРАВИЛО:**  
> Сигналы в CRYPTORA — это **НЕ** кнопка «Купи/Продай» с фальшивым маркетингом «98% точности».  
> Любой аналитический сетап строится на формализованной проверяемой логике с неизменяемым журналом и фиксацией опровергающих факторов.  
> **CRYPTORA DOES NOT EXECUTE TRADES.**

---

## 1. Что именно работает в LIVE (v0.8.45)

Три стратегии исследовательского архива запускаются на **фактических закрытых свечах** биржи (Binance / KuCoin через
`LiveMarketDataProvider`) без изменения правил. LIVE-движок — это **детерминированный реплей архивного раннера** на
окне последних закрытых баров, а не отдельная «упрощённая» реализация.

| Стратегия | Что вызывается (frozen, без изменений) | Вход | Вердикт исследования |
|---|---|---|---|
| **V3.0 HTF Liquidation Trap** | `detectTrap` → `buildPending` → `corridorStep` → `manageTrade` (v30Core) | лимитный коридор close ± 0.10 ATR, 3 бара, худшая граница | VALIDATED (3 из 6 символов) |
| **V3.3 HTF Zone Mitigation** | `buildZones` → `trackZone` → `absorption` → коридор → `manageTrade` (v33Core), вариант `while-protective-displacement` | лимитный коридор, 3 бара | TRAIN-ONLY, не валидировано |
| **V2.8 Zero-fee Sniper + Trailing** | `evaluateV2` @4839074 + `extremePoolKind`/`baseSniper` + `resolveEntry`/`executableLadder` + `trackOutcome` (слот) + `simulateTrailing` — через архивную обёртку `v28Live.ts` | OPEN бара N+1 | GROSS-ONLY (fees = 0), при 2/5 bps net-отрицательна |

Файлы: `src/services/signals/live/LiveSignalEngine.ts`, `live/replays/{v30,v33,v28}LiveReplay.ts`, `live/lifecycle.ts`,
`src/services/strategyArchive/definitions/v2_8-zero-fee-sniper-trailing/v28Live.ts`.

### 1.1. Цикл скана
1. Каждые 60 с (первый — через 5 с после старта LIVE-режима) для BTC, ETH, BNB, SOL, XRP, DOGE запрашиваются
   1000 свечей 1h и 4h (+ 400 свечей 1d для V2.8). **Forming-свеча отбрасывается** (`ohlcvToArchive(c, tf, nowMs)`).
2. Сначала ведутся уже опубликованные сетапы (см. §3) — это дёшево и не зависит от появления нового бара.
3. Если закрылся новый 1h-бар — запускаются реплеи трёх стратегий по всему окну; **в журнал публикуются только сетапы
   последнего закрытого бара** (latency 0 баров). Идентификатор `${strategyId}-${SYMBOL}-${setupOpenTime}`
   детерминирован — повторные сканы не создают дублей.
4. Pending, которые раннер отклонил бы на баре исполнения по геометрии (TP1 позади коридора — в исследовании V3.3 таких
   ≈ 51 %), не публикуются, но видны в «Ретроспективе окна» — счётчики сходятся с воронкой исследования.
5. Ошибки провайдера записываются **по инструменту** в `getStatus()` и показываются на странице; сбой одного символа не
   останавливает остальные. Демо-данные в LIVE-путь не подставляются никогда.

### 1.2. Почему сигналов мало
V3.0 в исследовании давала порядка одного сетапа на инструмент в несколько дней; V3.3 после геометрического фильтра —
реже; V2.8 (sniper) — ещё реже на 1h. Пустой журнал сразу после запуска — норма, а не сбой. Диагностика того, что стратегии
действительно считаются на данных, — блок «Покрытие по инструментам» и «Ретроспектива окна» на `/signals`.

---

## 2. Модель данных журнала (`SignalsAuditLedger`, ключ `cryptora_signals_ledger_v2`)

```typescript
interface AnalyticalSetup {
  id: string;                 // `${strategyId}-${SYMBOL}-${setupOpenTime}`
  strategyId: string;         // V3_0_HTF_LIQUIDATION_TRAP | V3_3_HTF_ZONE_MITIGATION | V2_8_ZERO_FEE_SNIPER_TRAILING
  strategyVersion: string;
  symbol: string;             // BTC/USDT
  direction: 'LONG' | 'SHORT';
  timeframe: '1h';
  setupOpenTime: number;      // openTime закрытого бара сетапа (ms UTC)
  entryType: 'LIMIT_CORRIDOR' | 'MARKET_NEXT_OPEN';
  entryZone: [number, number];
  invalidationLevel: number;  // стоп
  targets: number[];          // TP1, TP2 (V2.8 — лестница frozen-движка, ориентир)
  riskRewardRatio: number;
  confirmingFactors: string[];
  invalidationFactors: string[];
  exitRule: string;
  validForBars: number | null;
  createdAt: string;          // ISO UTC публикации
  latencyBars: number;        // 0
  status: 'ACTIVE' | 'FILLED' | 'TARGET_REACHED' | 'INVALIDATED' | 'CLOSED' | 'EXPIRED' | 'CANCELLED' | 'UNRESOLVED';
  fill?: { price; at; barOpenTime; stop?; targets? };   // исполнение (уровни после сдвига на дельту исполнения)
  closedAt?; exitReason?; exitPrice?; resultR?; netResultR?; pnlResultPct?; barsHeld?;
  prevHash: string;           // 'GENESIS' или auditHash предыдущей записи
  auditHash: string;          // sha256(issuance + prevHash) — фиксируется при публикации
  outcomeHash?: string;       // sha256(outcome) — фиксируется один раз при исходе
}
```

---

## 3. Жизненный цикл опубликованного сетапа (`live/lifecycle.ts`)

Исход считается по **опубликованным (уже захэшированным) уровням**, а не повторным прогоном стратегии, теми же
frozen-функциями архива:

- **V3.0 / V3.3 (LIMIT_CORRIDOR):** `corridorStep` на барах N+1…N+3 (исполнение по худшей границе, отмена при касании
  стопа, `REJECTED_GEOMETRY`, истечение) → `manageTrade` соответствующей версии (стоп раньше целей, TP1 → 50 % и BE со
  следующего бара, TP2, таймаут 50 / 48 баров).
- **V2.8 (MARKET_NEXT_OPEN):** `v28EntryAtNextOpen` (OPEN N+1, сдвиг стопа/целей на дельту исполнения, `executableLadder`,
  rr1 ≥ min_rr) → `v28TrailOutcome` (Trail V2.5: BE при MFE ≥ 1R, трейлинг 1R шагом 0.25R, таймаут 10 баров).

Статусы: `ACTIVE → FILLED → TARGET_REACHED | INVALIDATED | CLOSED` (сделка была) или `ACTIVE → EXPIRED | CANCELLED`
(сделки не было). `UNRESOLVED` — бар сетапа вышел за окно данных до исхода (честно помечается, не считается сделкой).

---

## 4. Принцип неизменяемости (Immutable History)

1. **Никакого переписывания задним числом:** публикация хэшируется цепочкой в момент закрытия бара; `verifyIntegrity()`
   ломается при любом изменении уровней или исхода. Метод `expireStale()` прежних версий удалён — он переписывал записи.
2. **Неудачные сигналы сохраняются навсегда:** удаление или редактирование записей API не предусмотрено.
3. **Честная статистика:** «Доля сделок с R > 0» считается только по сделкам с исходом; отмены/истечения — отдельно;
   net R учитывает комиссии 2/5 bps (maker вход / taker выход).

---

## 5. Отсутствие автоматического исполнения (No Auto-Execution)

- Сетапы — структурированные наблюдения для человека. Платформа **не отправляет ордера** и не хранит торговые ключи.
- Любое торговое решение принимается пользователем самостоятельно на внешних площадках.

---

## 6. Ограничения и честные оговорки

- Журнал хранится в **localStorage браузера** — это не серверный трек-рекорд; другой браузер = другой журнал.
- LIVE-эмиссия в песочнице сборки не воспроизводима (нет доступа к биржам); проверено паритетом реплеев с архивными
  раннерами и сквозным тестом на mock-«бирже» (`tests/unit/signals/*`).
- V2.8 в LIVE — только 1h-подмножество исследования (15m/30m/4h не сканируются); все цифры V2.8 — GROSS.
- Окно данных конечно (≤ 1000 баров 1h): зоны V3.3, известные до начала окна, отбрасываются правилом прогрева (как
  `zonesSkippedByWarmup` в источнике), поэтому первые сканы после старта могут пропустить сетапы по очень старым зонам.
