# CRYPTORA — АУДИТ СТРАТЕГИИ И TAKE-PROFIT ЛОГИКИ

**Дата:** 2026-09-30
**Ветка:** `arena/01a0f0b2-cryptora`
**Базовый коммит:** `f368b84dff67431fdc682620d038257172d711dc` (= `origin/main`)
**Характер работы:** ИССЛЕДОВАНИЕ. Формулы стратегий, настройки, сигналы и БД не изменялись.

---

## 0. ГРАНИЦЫ ДОСТОВЕРНОСТИ (прочитать первым)

Из этой рабочей среды **недоступны**:

| Источник | Статус | Проверка |
|---|---|---|
| Production PostgreSQL | НЕДОСТУПЕН | `DATABASE_URL` не задан ни в окружении, ни где-либо вне `.env.example` |
| Production API `https://cryptora.duckdns.org` | НЕДОСТУПЕН | `fetch` → `ERR fetch failed`; исходящая сеть закрыта, кроме npm-registry |
| Binance / любой источник OHLCV | НЕДОСТУПЕН | `https://api.binance.com/api/v3/ping` → сеть закрыта |
| Датасет исследования (`nub36/svechnoy-suslik-binance-data`) | НЕДОСТУПЕН | внешний git-репозиторий; в CRYPTORA не вендорится |

Из этого следует жёсткое правило, которого придерживается весь отчёт:

* **формулы, якоря, семантика TP1/TP2 и lifecycle** — установлены ТОЧНО, по коду
  (это статический анализ, сеть для него не нужна);
* **распределения R и hit-rate по СОХРАНЁННЫМ PRODUCTION-сигналам** — `NOT AVAILABLE`,
  потому что ни одна строка production-БД в этой среде не читается. Ни одна цифра
  «по продакшену» в отчёте не выдумана;
* **фактические распределения R и hit-rate** приводятся по **архивным артефактам
  исследования, лежащим в репозитории** (`src/services/strategyArchive/results/**`).
  Это те самые прогоны, из которых заморожены V3.0/V3.3, и они воспроизводятся
  раннером `scripts/strategy-archive/reproduce.mjs`. Каждая такая цифра помечена
  источником-файлом.

Чтобы аудит стал воспроизводимым на реальных данных, добавлен READ-ONLY инструмент
`npm run diagnose:strategy-targets` (§14) — на проде он даст ровно те разрезы, которые
здесь помечены `NOT AVAILABLE`.

---

## 1. BASELINE / VERSION AUDIT

```
git status --porcelain      → (пусто, дерево чистое на момент старта)
git branch --show-current   → arena/01a0f0b2-cryptora
git rev-parse HEAD          → f368b84dff67431fdc682620d038257172d711dc
git rev-parse origin/main   → f368b84dff67431fdc682620d038257172d711dc
```

### Версии, которые МОГУТ создавать сигналы

Источник истины — `server/services/strategyCatalog.js` + CHECK в миграции 006.
Стратегий ровно **три**, четвёртая не появится через API (id зашиты в PRIMARY KEY/CHECK):

| registry id | version | exec TF | context TF | badge |
|---|---|---|---|---|
| `V3_0_HTF_LIQUIDATION_TRAP` | `3.0` | 1h | 4h | RESEARCH (валидирована) |
| `V3_3_HTF_ZONE_MITIGATION` | `3.3` | 1h | 4h | TRAIN_ONLY (**не валидирована**) |
| `V2_8_ZERO_FEE_SNIPER_TRAILING` | `2.8` | 1h | 4h, 1D | GROSS_ONLY |

Миграция 006 засевает все три со `enabled = FALSE`; включение — только через админ-путь.
Какие из них включены на проде **прямо сейчас — NOT AVAILABLE** (нужна production-БД);
`GET /api/strategies` отдаёт это без секретов.

Архив `src/services/strategyArchive/definitions/**` содержит ещё 10 версий (V2.1a…V3.2) —
они **не подключены** к живому движку: `LiveSignalEngine` вызывает только `runV30`,
`runV33`, `runV28`. Сигналы они создавать не могут.

### Почему на UI видно «V3.3» и «v3.3» одновременно

**Это duplicate UI label, а не две версии.** Одна строка собирается из двух разных полей:

```ts
// src/utils/serverSignalText.ts:296
export function strategyText(strategyId, strategyVersion) {
  const short = strategyShortLabel(strategyId);          // 'V3_3_HTF_ZONE_MITIGATION' → 'V3.3'
  return strategyVersion ? `${short} · v${strategyVersion}` : short;   // + 'v3.3'
}
```

* `V3.3` (первая часть) — производная от **`signals.strategy_id`**, витринная метка
  из `STRATEGY_SHORT_MAP` (`src/utils/signalText.ts:118`);
* `v3.3` (вторая часть) — колонка **`signals.strategy_version`**, то есть
  **signal provenance / model version**, которую поставил сам реплей
  (`V33_STRATEGY_VERSION = '3.3'`).

Семантически это два РАЗНЫХ поля, которые сегодня совпадают по значению. Смысл
установлен, **изменение не вносилось** (см. §16 «Рекомендации»).

---

## 2. ТОЧНАЯ TP/SL МАТЕМАТИКА

### Полный pipeline

```
Binance klines
  → server/services/strategyEngine/marketDataFetcher.js      (закрытые свечи, кэш, дедуп)
  → strategyCoreBundle.js  (компиляция того же src/-ядра, что и в браузере)
  → LiveSignalEngine.scanNow()
        → replays/v30LiveReplay.ts | v33LiveReplay.ts   ← ЗДЕСЬ СЧИТАЮТСЯ УРОВНИ
        → SignalsAuditLedger (ledger ядра)
  → strategyEngine.buildSignalRecord()   (только перекладывание полей, без математики)
  → signalRepository.insertSignal()      (NUMERIC-колонки + targets NUMERIC[])
  → signalMonitor (каждые 30 с) → signalTradeManager.toPublishedSetup()
        → lifecycle.trackPublishedSetup() → corridorStep() → manageTrade()
  → signalRepository.syncSignalLifecycle()
  → GET /api/signals → signalUiModel.ts → SignalSummaryCard / SignalDetailsPanel
```

Важное свойство: **уровни считаются ровно один раз**, в замороженном ядре. Ни движок,
ни репозиторий, ни монитор, ни UI их не пересчитывают (это явно зафиксировано
комментариями-инвариантами в `strategyEngine.js` и `signalTradeManager.js`).

Публикуется в журнал **только** сетап последнего закрытого бара и только если
`record.publishable === true` (`LiveSignalEngine.ts:486-487`).

### V3.0 — HTF Liquidation Trap

Источник: `src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core.ts`,
функция `buildPending()`; константы `V30_CONSTANTS`.

Обозначения: `c` — триггерный ЗАКРЫТЫЙ 1h-бар; `ATR` = ATR(14) Уайлдера на 1h;
`SH`/`SL4` — последние ПОДТВЕРЖДЁННЫЕ 4h swing high / swing low (strength = 3);
`sweepExtreme` — экстремум триггерного бара, которым проколот уровень.

```
half = 0.10 * ATR                  (CORRIDOR_ATR_FRAC)
eq   = (SH + SL4) / 2              4H-равновесие

LONG   (прокол SL4 вниз, закрытие выше):
  entryLow  = c.close - half
  entryHigh = c.close + half
  stop      = sweepExtreme(c.low)  - 0.15 * ATR
  target1   = eq
  target2   = SH

SHORT  (прокол SH вверх, закрытие ниже):
  entryLow  = c.close - half
  entryHigh = c.close + half
  stop      = sweepExtreme(c.high) + 0.15 * ATR
  target1   = eq
  target2   = SL4
```

### V3.3 — HTF Zone Mitigation (LIVE-вариант `while-protective-displacement`)

Источник: `src/services/signals/live/replays/v33LiveReplay.ts` (цикл) +
`definitions/v3_3-htf-zone-mitigation/v33Core.ts` (зоны); константы `V33_CONSTANTS`.

Обозначения: `z` — выбранная 4H-зона (order block или FVG); `z.legLow`/`z.legHigh` —
границы **displacement-ноги**, породившей зону; `zoneEdge` = `z.zoneLow` для LONG и
`z.zoneHigh` для SHORT; `climax` = `c.low` (LONG) / `c.high` (SHORT);
`opposing` — противоположный подтверждённый 4H-свинг на момент бара.

```
half = 0.10 * ATR

LONG:
  entryLow  = c.close - half
  entryHigh = c.close + half
  stop      = min(climax, z.zoneLow)  - 0.15 * ATR      ← 'protective'
  target1   = (z.legLow + z.legHigh) / 2                ← СЕРЕДИНА displacement-ноги
  target2   = levels.high[closed4h]                     ← противоположный 4H-свинг

SHORT:
  entryLow  = c.close - half
  entryHigh = c.close + half
  stop      = max(climax, z.zoneHigh) + 0.15 * ATR
  target1   = (z.legLow + z.legHigh) / 2
  target2   = levels.low[closed4h]
```

### От чего рассчитывается каждый уровень

| Уровень | V3.0 | V3.3 |
|---|---|---|
| entryLow/High | **volatility** (close ± 0.10·ATR₁ₕ) | **volatility** (close ± 0.10·ATR₁ₕ) |
| stop | **structure + volatility**: экстремум свипа ∓ 0.15·ATR | **structure + volatility**: min/max(климакс, грань зоны) ∓ 0.15·ATR |
| target1 | **structure**: равновесие 4H-диапазона `(SH+SL4)/2` | **structure**: середина displacement-ноги |
| target2 | **structure**: противоположный подтверждённый 4H-свинг | **structure**: противоположный подтверждённый 4H-свинг |

**Ни fixed R multiple, ни процент, ни минимальный R:R нигде не участвуют.**
Поиск по `v30Core.ts` / `v33Core.ts` / обоим LIVE-реплеям не находит ни одного
сравнения цели с кратностью риска. Цели **чисто структурные**; расстояние до них
от входа — побочный результат.

### ENTRY ANCHOR

Якорей три, и они **не совпадают**:

| Якорь | Значение | Где используется |
|---|---|---|
| midpoint | `(entryLow + entryHigh)/2` = `c.close` | витрина/UI; `rrFrom()` в `replays/shared.ts` для `metadata.riskRewardRatio` |
| near edge | LONG `entryLow`, SHORT `entryHigh` | нигде (лучший гипотетический фил) |
| **far edge = actual fill** | LONG `min(bar.open, entryHigh)`, SHORT `max(bar.open, entryLow)` | **`corridorStep()` → `manageTrade()`** — именно от него считается `risk` и весь R стратегии |

`risk = |fill − stop|`, `fill` — **худшая** граница коридора (`v30Core.ts:corridorStep`,
`v33LiveReplay.ts`). Trigger price как отдельная сущность отсутствует: вход лимитный,
коридор живёт 3 бара (N+1…N+3), при истечении сетап — `EXPIRED` без сделки.

> **Следствие для аудита.** R, который видит пользователь (от midpoint), СИСТЕМАТИЧЕСКИ
> ЛУЧШЕ, чем R, по которому стратегия считает свою статистику (от far edge).
> Разрыв ровно `0.10·ATR` риска. Диагностика (§14) печатает оба.

---

## 3. RISK/REWARD AUDIT — методика

Реализована в `shared/diagnostics/targetGeometry.js` (чистая функция, покрыта тестами):

```
entryMid = (entryLow + entryHigh) / 2

LONG :  risk = entryMid - stop     reward1 = target1 - entryMid    reward2 = target2 - entryMid
SHORT:  risk = stop - entryMid     reward1 = entryMid - target1    reward2 = entryMid - target2

R1 = reward1 / risk        R2 = reward2 / risk
R1_near / R2_near — тот же расчёт от лучшей границы зоны
R1_far  / R2_far  — тот же расчёт от худшей границы (= фактический фил раннера)
```

Детектируемые нарушения и их класс:

| Код | Класс | Смысл |
|---|---|---|
| `TP1_ON_WRONG_SIDE` / `TP2_ON_WRONG_SIDE` | STRUCTURAL | цель не по ходу сделки |
| `STOP_ON_WRONG_SIDE` | STRUCTURAL | стоп по рабочую сторону входа |
| `TP_ORDER_INVERTED` | STRUCTURAL | TP2 не дальше TP1 |
| `NON_POSITIVE_RISK` | STRUCTURAL | risk ≤ 0 |
| `MISSING_LEVEL` / `NON_FINITE_LEVEL` | STRUCTURAL | null / NaN |
| `ENTRY_ZONE_INVERTED` | STRUCTURAL | entryHigh < entryLow |
| `TP1_VERY_CLOSE` (R1 < 0.25) | QUALITY | TP1 аномально близко |
| `TP2_VERY_FAR` (R2 > 10) | QUALITY | TP2 аномально далеко |
| `WIDE_ENTRY_ZONE` (ширина > 0.5·risk) | QUALITY | очень широкая зона входа |

Только STRUCTURAL даёт ненулевой exit-код: плохой R:R — это **свойство стратегии**,
а не поломка данных.

**Прогон по production-сигналам: NOT AVAILABLE** (нет доступа к БД/API). Ниже —
то, что известно ТОЧНО из архивных прогонов.

---

## 4. BTC SHORT СО СКРИНШОТА

**Найти фактическую строку в БД не удалось: production-данные из этой среды
недоступны (§0).** Поэтому числа скриншота используются как ГИПОТЕЗА и проверяются
на согласованность с формулой V3.3 — этого достаточно, чтобы ответить на все
вопросы задачи.

Вход (со скрина): `84 154.2 – 84 245.9`, stop `84 911.8`, TP1 `84 104.5`, TP2 `82 563.0`.

### Обратная проверка формулы

```
ширина коридора = 84245.9 − 84154.2 = 91.7 = 0.20 · ATR   ⟹  ATR(14,1h) ≈ 458.5
c.close        = (84154.2 + 84245.9)/2 = 84200.05          ✔ коридор = close ± 0.10·ATR
0.15 · ATR     ≈ 68.78
max(климакс, грань зоны) = 84911.8 − 68.78 ≈ 84843.0       ✔ стоп = max(...) + 0.15·ATR
```

Обе формулы сходятся с точностью округления скриншота. Сетап **соответствует V3.3**.

### R:R

| Якорь | risk | reward₁ | **R1** | reward₂ | **R2** |
|---|---|---|---|---|---|
| midpoint 84 200.05 | 711.75 | 95.55 | **0.134** | 1 637.05 | **2.300** |
| near (84 245.9) | 665.90 | 141.40 | 0.212 | 1 682.90 | 2.527 |
| **far = fill (84 154.2)** | 757.60 | 49.70 | **0.066** | 1 591.20 | **2.100** |

### Почему TP1 настолько близко

TP1 у V3.3 — это `(z.legLow + z.legHigh)/2`, **середина displacement-ноги 4H-зоны**.
Это уровень структуры; он вообще не знает ни про стоп, ни про вход. Когда цена
триггерного бара оказывается почти на этой середине, TP1 попадает вплотную к коридору.
Единственный фильтр, который стоит на пути — `corridorGeometryOk()`: он требует лишь,
чтобы TP1 был **строго впереди худшей границы коридора**, без всякого минимума в R.
Здесь TP1 впереди на 49.7 пункта (0.066R) — проверка пройдена, сетап опубликован.

### Вердикт

* TP1 — **structural target**: да, середина displacement-ноги.
* Соответствует формуле V3.3: **да**.
* **Intended behavior, а не аномалия кода.** Это следствие проектного решения
  «цели структурные, минимального R нет». Но это **системная слабость дизайна**
  (см. §5: у половины триггеров TP1 вообще позади закрытия), а не единичный случай.

---

## 5. DISTRIBUTION

### 5.1 По СОХРАНЁННЫМ PRODUCTION-сигналам

**NOT AVAILABLE** — нет доступа к БД/API. Требуемые разрезы (V3.0 / V3.3 / LONG /
SHORT / symbol / timeframe; count, min, p10, p25, median, p75, p90, max, mean;
доли R1/R2 < 0.25 / 0.5 / 1.0 / ≥ 1.0) реализованы в
`npm run diagnose:strategy-targets` и выдаются одним прогоном на проде.

### 5.2 По архивным прогонам, лежащим в репозитории (ФАКТ)

**V3.3**, `src/services/strategyArchive/results/v33/v33-train-metrics-while-protective-displacement.json`
(TRAIN, все 6 символов, n = 6 957 ИСПОЛНЕННЫХ сделок, R от фактического фила):

| | p25 | median | p75 |
|---|---|---|---|
| **R целевого TP1** | **0.2425** | **0.5824** | **1.1911** |
| R целевого TP2 | 1.8127 | 2.9164 | 4.5831 |
| stop distance, % цены | 1.0914 | 1.6953 | 2.6374 |

Воронка того же прогона:

```
triggersInZone            15 957
pendingCreated            15 957
filled                     6 957   (43.6 %)
rejected (геометрия)       8 140   (51.0 %)   ← TP1/TP2 не с той стороны на баре фила
cancelled                    849
expired                        0
unresolved                     9
triggersWithTp1BehindClose 7 762   (48.6 % всех триггеров)
```

> `triggersWithTp1BehindClose = 48.6 %` — почти **половина** триггеров V3.3 имеет TP1
> уже ПОЗАДИ цены закрытия триггерного бара. Из них выживают только те, у кого TP1
> хотя бы на волосок впереди худшей границы. Это прямое доказательство, что близость
> TP1 — **системное свойство**, а не отдельные сетапы.

Доли ниже порогов по архиву известны **только в узлах квартилей**:
`p25 = 0.2425` ⟹ **≈ 25 % исполненных сделок V3.3 имеют TP1 ближе 0.25R**;
`median = 0.5824` ⟹ **≈ 50 % — ближе 0.58R**; `p75 = 1.1911` ⟹ **≈ 70 % — ближе 1.0R**
(последнее — интерполяция между median и p75, помечена как интерполяция).
Точные `p10/p90/mean` и доли `< 0.25 / < 0.5 / < 1.0` по сделкам **NOT AVAILABLE**:
per-trade выгрузка в репозиторий не вендорилась (в артефактах только агрегаты).

**V3.0** — `targetRMultiple` в архивных артефактах **не сохранён**
(`v30-train-metrics.json`, `v30-validation-metrics.json` его не содержат).
**R1/R2 медианы V3.0: NOT AVAILABLE.**

### 5.3 Разрез LONG / SHORT (архив, экспектанс в R на сделку)

| прогон | LONG n | LONG grossR | SHORT n | SHORT grossR |
|---|---|---|---|---|
| V3.3 TRAIN | 3 537 | **0.0382** | 3 420 | **0.1188** |
| V3.0 TRAIN | 796 | 0.1736 | 789 | 0.1717 |
| V3.0 VALIDATION | 230 | 0.0837 | 306 | **0.1602** |

---

## 6. ФАКТИЧЕСКИЙ OUTCOME ANALYSIS

### По production-БД — NOT AVAILABLE

Что БД **может** дать (схема миграций 007/009/010/011 прочитана):

* вошло в позицию — `status = 'FILLED'` либо непустой `fill_price`/`filled_at`;
* исход — `close_reason` ∈ {`SL`, `TP2`, `TP1_THEN_BE`, `TP1_THEN_SL`, `TP1_THEN_TIMEOUT`, `TIMEOUT`, `EXPIRED`, `CANCELLED`, `REJECTED_GEOMETRY`, `OUT_OF_DATA_WINDOW`};
* expired/cancelled — `status` ∈ {`EXPIRED`, `CANCELLED`, `UNRESOLVED`};
* ещё открытые — `status` ∈ {`ACTIVE`, `FILLED`}.

Чего БД **не может** дать:

* **отдельного факта «TP1 достигнут» нет.** Колонки `tp1_hit_at` не существует.
  TP1 ВЫВОДИТСЯ из литерала выхода: `TP2` и все `TP1_THEN_*` ⟹ TP1 был.
  Это не догадка — без факта TP1 эти литералы в `manageTrade` недостижимы;
* **порядка событий тоже нет.** Хранится только ПРИЧИНА финального выхода. Поэтому:
  * «TP1 before SL» = число строк `TP1_THEN_SL`;
  * «TP2 before SL» = число строк `TP2`;
  * «SL before TP1» = число строк `SL`.

> **Отдельная находка.** Литерал `TP1_THEN_SL` **недостижим** в обеих версиях.
> В `manageTrade` стоп проверяется первым (R1), а безубыток взводится со следующего
> бара после TP1 (R3) — значит после TP1 стоп уже равен входу, и выход по стопу
> даёт `TP1_THEN_BE`. Подтверждается архивами: в `exits` ни одного прогона
> V3.0/V3.3 ключа `TP1_THEN_SL` нет. **Сценарий «взяли TP1, потом отдали исходный
> стоп» в этой системе невозможен.**

### По архивным прогонам (ФАКТ)

**V3.3 TRAIN** (n = 6 957): `TP1_THEN_BE 3 295 · SL 2 298 · TP2 865 · TP1_THEN_TIMEOUT 379 · TIMEOUT 120`

* **TP1 hit rate = 65.24 %** ((3295+865+379)/6957)
* **TP2 hit rate = 12.43 %** (865/6957)
* **SL rate = 33.03 %** (2298/6957) — только исходный стоп, без BE-выходов
* positive R rate 66.16 %, gross 0.0778 R/сделку, net(2/5 bps) 0.0267, PF 1.2341,
  avgWin 0.62 R, avgLoss −0.9823 R, медиана удержания 6 баров

**V3.0 TRAIN** (n = 1 585): `SL 772 · TP1_THEN_BE 410 · TP2 275 · TP1_THEN_TIMEOUT 80 · TIMEOUT 48`

* **TP1 hit rate = 48.26 % · TP2 hit rate = 17.35 % · SL rate = 48.71 %**
* gross 0.1726 R, net 0.0994, PF 1.3538, avgWin 1.3022, avgLoss −0.9901

**V3.0 VALIDATION** (n = 536, отложенная выборка): `SL 274 · TP1_THEN_BE 157 · TP2 76 · TP1_THEN_TIMEOUT 21 · TIMEOUT 8`

* **TP1 hit rate = 47.39 % · TP2 hit rate = 14.18 % · SL rate = 51.12 %**
* gross 0.1274 R, net 0.0600, PF 1.2484

---

## 7. MFE / MAE

**NOT AVAILABLE.**

Причины, каждая достаточна сама по себе:

1. `signals` не хранит ни MFE/MAE, ни экстремумы после входа — только финальные
   `result_r`, `net_result_r`, `pnl_result_pct`, `bars_held`;
2. свечи в проекте вообще не персистятся: `MarketDataFetcher` — это TTL-кэш в памяти,
   таблицы OHLCV нет ни в одной миграции;
3. из этой среды нет сети к бирже, чтобы восстановить свечи по timestamp'ам.

Реконструкция возможна, но требует внешнего источника OHLCV; имитировать её
синтетическими свечами было бы фальсификацией и здесь не делается.

---

## 8. TP1 → ДАЛЬНЕЙШЕЕ УПРАВЛЕНИЕ

Источник: `manageTrade()` в `v30Core.ts:136-196` и `v33Core.ts:254-308` (идентичная
семантика, различается только `TIMEOUT_BARS`: 50 у V3.0, 48 у V3.3).

| Вопрос | Ответ | Доказательство |
|---|---|---|
| Сигнал просто помечает TP1? | Нет, это исполнение | `realised += 0.5 * rOf(tp1)` |
| Закрывается часть позиции? | **Да, ровно 50 %** | `legs.push({price: tp1, weight: 0.5, taker: true})` |
| Стоп переносится в безубыток? | **Да, со СЛЕДУЮЩЕГО бара** | `beArmed = hitTp1 && i > tp1Bar; stopNow = beArmed ? entry : stop0` (правило R3) |
| Стоп остаётся прежним? | Только на баре самого TP1 | там `beArmed = false` |
| TP2 продолжает мониториться? | **Да**, оставшимися 50 % | `if (hitTp1 && hitT2) return finish('TP2', tp2, 0.5, i)` |
| Сигнал = WIN уже после TP1? | **Нет.** Статус после TP1_THEN_BE — `CLOSED`, а не `TARGET_REACHED` | `managedStatus()`: `TP2 → TARGET_REACHED`, `SL → INVALIDATED`, остальное → `CLOSED` |
| Возможен TP1 → потом SL? | **Нет** (см. §6): после TP1 стоп = вход, худший исход — `TP1_THEN_BE` ≈ +0.5·R(tp1) | R1 + R3 + R4 |
| Как считается в статистике? | **Только по записанному `result_r`**, не по названию исхода | `signalStatistics.js:20-27`: wins `result_r > 0`, losses `< 0`, breakEven `= 0`; знаменатель win rate — завершённые сделки с известным R |

Порядок проверок внутри бара (pre-registered, не менять): R1 стоп раньше целей;
R2 TP1 бронируется раньше TP2 на одном баре; R3 BE только со следующего бара;
R4 стоп не движется назад; R5 бар входа считается первым.

---

## 9. WEIGHTED EXPECTANCY

Веса **определены в коде** и равны **50 % / 50 %**:

```ts
realised += 0.5 * rOf(tp1);                 // первая половина на TP1
return finish(exit, exitPrice, 0.5, i);     // вторая половина на TP2 / BE / timeout
grossR = 0.5·R(tp1) + 0.5·R(exitPrice)
```

Где НЕ определены: в `strategy_settings` (миграция 006) нет ни одного числового
параметра — таблица содержит только `enabled`, `scan_interval_seconds`, `symbols`
и телеметрию. Ни в `.env.example`, ни в `strategyCatalog.js` весов тоже нет.

**Expectancy (архив, ФАКТ, gross R на сделку с учётом весов 0.5/0.5):**

| | n | gross R | net R (2/5 bps) | PF |
|---|---|---|---|---|
| V3.3 TRAIN | 6 957 | 0.0778 | **0.0267** | 1.2341 |
| V3.0 TRAIN | 1 585 | 0.1726 | 0.0994 | 1.3538 |
| V3.0 VALIDATION | 536 | 0.1274 | **0.0600** | 1.2484 |

Хрупкость V3.3 зафиксирована её же артефактом: без топ-1 % сделок gross падает до
**0.0264 R**, что **ниже** комиссионного сноса **0.0511 R** ⟹ на этом срезе
стратегия убыточна. V3.3 остаётся TRAIN_ONLY.

**Expectancy по production-сигналам: NOT AVAILABLE.**

---

## 10. ПРОВЕРКА PRICE PRECISION

### Расчёт и хранение — в порядке

* весь расчёт — IEEE-754 double, без округления: ни в `v30Core`, ни в `v33Core`,
  ни в реплеях к уровням не применяется `toFixed`/`Math.round`;
* хранение — `NUMERIC` (007) и `NUMERIC[]` для лестницы (009). Миграция 007 явно
  обосновывает выбор: «Prices are NUMERIC, not REAL»;
* `signalRepository.insertSignal()` уровни не округляет; чтение `mapRow()` делает
  `Number(...)` и сохраняет `null` как `null`, а не как 0;
* `round(x, digits)` в `replays/shared.ts` применяется **только** к `grossR`/`netR`
  и к `riskRewardRatio` — к ценам не применяется.

**Вывод: persisted levels НЕ страдают ни для BTC, ни для SOL/XRP, ни для MEW/PEPE.**

### Отображение — есть дефект (display-only)

```ts
// src/utils/serverSignalText.ts:151  formatSignalPrice
digits = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
```

Это **фиксированное число знаков после запятой**, а не значащих цифр. Для активов
дешевле 0.01 это разрушительно:

| актив | persisted | показывается | значащих цифр |
|---|---|---|---|
| BTC 84 154.2 | 84154.2 | `84 154,2` | ок |
| SOL 201.45 | 201.45 | `201,45` | ок |
| XRP 2.4137 | 2.4137 | `2,4137` | ок |
| MEW 0.003241 | 0.003241 | `0,003241` | 4 — приемлемо |
| PEPE 0.00000812 | 0.00000812 | **`0,000008`** | **1** — TP1 и TP2 могут стать визуально одинаковыми |

Рядом в кодовой базе уже есть ПРАВИЛЬНАЯ функция — `formatInstrumentPrice` /
`instrumentPriceDecimals` (`src/utils/formatters.ts:150`), которая считает
**значащие** цифры и умеет tickSize. Экраны сигналов её не используют.

**Разделение подтверждено:** calculation/persistence precision — полная;
display formatting — теряет знаки на low-price активах и **не влияет** на
сохранённые уровни. Ничего не изменено; проверка `priceResolution()` включена
в диагностику (§14, блок 7) и в тесты.

---

## 11. STRATEGY SETTINGS (READ ONLY)

Полный состав `strategy_settings` (миграция 006) — секретов нет:

| колонка | тип | смысл |
|---|---|---|
| `strategy_id` | TEXT PK | один из трёх разрешённых CHECK-ом id |
| `enabled` | BOOLEAN, default FALSE | ВКЛ/ВЫКЛ сканирования |
| `scan_interval_seconds` | INTEGER, default 60, CHECK ≥ 15 | период планировщика |
| `symbols` | JSONB, NULL = дефолт каталога | вселенная скана |
| `last_scan_at` / `last_signal_at` / `last_error` | — | телеметрия |
| `updated_at` / `updated_by` | — | аудит изменения |

Текущие production-значения (`enabled`, интервал, список символов) — **NOT AVAILABLE**
(нужна БД; отдаются `GET /api/strategies` без секретов).

### Может ли production configuration переопределить кодовую TP-формулу?

**НЕТ.** Обоснование проверяемое, а не декларативное:

1. в таблице **физически отсутствуют** колонки под ATR/volatility/TP/SL/min-R:R/
   пороги/фильтры — их некуда записать;
2. комментарий самой миграции: *«Contains NO strategy math: thresholds, ATR periods
   and target formulas live in code only»*;
3. `strategySettings.js` читает/пишет только перечисленные выше поля;
4. все числовые параметры заморожены в `Object.freeze`:
   `V30_CONSTANTS`, `V33_CONSTANTS`, `FROZEN_ENGINE` (`swingLookback 3`, `atrPeriod 14`,
   `volumePeriod 20`, `displacementMinBodyAtr 0.6`, `fvgMinSizeAtr 0.15`);
5. `.env.example` (8 КБ) не содержит ни одной переменной, влияющей на уровни.

Единственное, чем конфигурация управляет, — **включена ли стратегия, как часто
сканирует и по каким символам**.

Активные значения математики (одинаковые в коде для обеих версий, если не указано иное):

```
ATR период 14 (Wilder), swing strength 3, volume period 20
CORRIDOR_ATR_FRAC 0.10        CORRIDOR_EXPIRY_BARS 3
STOP_BUFFER_ATR   0.15        MIN_RVOL  V3.0 > 1.25 (строго) / V3.3 ≥ 1.25
TIMEOUT_BARS      V3.0 50 / V3.3 48
MAKER/TAKER bps   2 / 5       (stress 5 / 5)
V3.0: MIN_BODY_RATIO 0.35
V3.3: WICK_FRAC_MIN 0.35, RECLAIM_BODY_MIN 0.40, CLOSE_TOP/BOTTOM 0.70/0.30,
      FVG_FILL_MIN 0.50, WARMUP_BARS 60, displacementMinBodyAtr 0.6, fvgMinSizeAtr 0.15
MIN R:R — ОТСУТСТВУЕТ у обеих версий
```

---

## 12. SIGNAL PROVENANCE

Что persisted и позволяет однозначно атрибутировать сигнал:

| нужно | колонка | есть? |
|---|---|---|
| strategy version | `strategy_version` (+ `strategy_id`) | **да** |
| createdAt | `created_at`, плюс `signal_candle_ts` (openTime закрытого бара) | **да** |
| timeframe | `timeframe` | **да** |
| entry | `entry_min`, `entry_max`, `entry_type`, `valid_for_bars` | **да** |
| SL | `stop_loss` (и `fill_stop` после исполнения) | **да** |
| TP1 / TP2 | `tp1`, `tp2`, плюс полная лестница `targets[]` (и `fill_targets`) | **да** |
| генератор сетапа | `engine_setup_id` = `${strategyId}-${SYMBOL}-${setupOpenTime}` | **да** |
| классификатор происхождения | `provenance_status` ∈ VERIFIED/MISMATCH/UNKNOWN (011, fail-closed) | **да** |
| неизменность публикации | `hash`/`previous_hash` (chain v2 по issuance) + отдельный `outcome_hash` | **да** |
| **settings snapshot/version** | **ОТСУТСТВУЕТ** | **нет** |

**Единственный пробел — снимок настроек.** Строка не помнит ни версии
`strategy_settings`, ни хэша констант ядра, ни commit sha на момент публикации.
Сегодня это почти безвредно, потому что настройки математику не задают (§11), а
константы заморожены; но при любом будущем изменении констант исторические строки
станут неинтерпретируемыми задним числом.

**Смешать V3.0 и V3.3 нельзя**: `strategy_id` и `strategy_version` независимы,
relabel чужого сетапа запрещён кодом (`buildSignalRecord` возвращает `record: null`
при `provenanceMismatch`), а статистика и монитор фильтруют по
`provenance_status = 'VERIFIED'`.

---

## 13. ЧТО НЕ МЕНЯЛОСЬ

Не изменён ни один файл стратегий, монитора, настроек, миграций и UI.
Полный diff этого PR — только новые файлы:

```
shared/diagnostics/targetGeometry.js        (новый, read-only математика диагностики)
shared/diagnostics/targetGeometry.d.ts      (новый)
scripts/diagnose-strategy-targets.mjs       (новый, READ-ONLY CLI)
tests/unit/strategyTargetDiagnostics.test.ts(новый)
docs/STRATEGY_TP_SL_AUDIT_2026-09-30.md     (этот отчёт)
package.json                                (+1 строка: npm-скрипт)
```

---

## 14. READ-ONLY ДИАГНОСТИКА

```bash
npm run diagnose:strategy-targets                                  # DATABASE_URL
npm run diagnose:strategy-targets -- --base-url https://host       # публичный read-path
npm run diagnose:strategy-targets -- --file dump.json --json out.json
```

Контракт (проверен фактическим прогоном на embedded-PostgreSQL с настоящими миграциями):

* **ничего не пишет в БД**: единственный SQL — `SELECT` внутри
  `BEGIN TRANSACTION READ ONLY`. Запрет обеспечивает сервер PostgreSQL, а не
  обещание кода: попытка `UPDATE` в такой транзакции падает с
  **SQLSTATE 25006** (`read_only_sql_transaction`) — проверено;
* **не меняет сигналы и не вызывает математику стратегий** — ядро не импортируется;
* принимает `DATABASE_URL`, либо `--base-url` (публичный `GET /api/signals`),
  либо `--file`;
* выводит агрегаты + **id/символ** аномалий; **PII не читается** — таблица `users`,
  `user_id`, e-mail и сессии в запросе отсутствуют;
* **exit-коды**: `0` — норма (в т. ч. при плохом R:R), `1` — структурное повреждение
  данных, `2` — нет источника/ошибка доступа. Проверено: плохой R:R → 0, запись с
  `TP1_ON_WRONG_SIDE` → 1, отсутствие источника → 2.

Блоки отчёта: общие числа · распределения R1/R2 (mid и far) · доли ниже порогов ·
разрезы (версия / направление / символ / таймфрейм) · аномалии со списком id ·
исходы и hit-rate по `close_reason` · MFE/MAE (честное `NOT AVAILABLE`) ·
точность хранения low-price уровней · provenance.

---

## 15. TESTS

`tests/unit/strategyTargetDiagnostics.test.ts` — **31 тест**, все зелёные:
LONG/SHORT R, края зоны входа (вырожденная и перевёрнутая), wrong-side TP1/TP2,
wrong-side SL, нулевой и отрицательный риск, TP2 ≤ TP1 для обоих направлений,
NaN/null-уровни, профиль BTC SHORT со скриншота, low-price precision (1000PEPE),
статистика выборки, пакетный разбор и группировка, классификация исходов ядра.

Ожидаемые значения существующих стратегий **не трогались**.

```
npm run typecheck   → OK
npm test -- --run   → Test Files 178 passed (178) · Tests 2029 passed (2029)
npm run build       → built in 5.80s
```

---

## 16. ФИНАЛЬНЫЙ ОТЧЁТ

```
CURRENT TP FORMULA V3.0:
  TP1 = (swingHigh4h + swingLow4h) / 2           — равновесие 4H-диапазона (structure)
  TP2 = противоположный подтверждённый 4H-свинг   (LONG → swingHigh, SHORT → swingLow)

CURRENT TP FORMULA V3.3:
  TP1 = (zone.legLow + zone.legHigh) / 2         — середина displacement-ноги 4H (structure)
  TP2 = противоположный подтверждённый 4H-свинг на момент бара

CURRENT SL FORMULA:
  V3.0: LONG  stop = sweepLow  − 0.15·ATR(14,1h)
        SHORT stop = sweepHigh + 0.15·ATR(14,1h)
  V3.3: LONG  stop = min(bar.low , zone.zoneLow ) − 0.15·ATR(14,1h)
        SHORT stop = max(bar.high, zone.zoneHigh) + 0.15·ATR(14,1h)
  Минимального R:R НЕТ ни у одной версии.

ENTRY ANCHOR:
  зона   = close ± 0.10·ATR(14,1h), живёт 3 бара (N+1…N+3)
  UI / metadata.riskRewardRatio → midpoint (= close)
  СТРАТЕГИЯ (risk и весь R)     → actual fill = ХУДШАЯ граница
                                  LONG min(open, entryHigh) / SHORT max(open, entryLow)

TP1 SEMANTICS: структурный уровень 4H; частичная фиксация 50 % позиции;
               не «win», статус остаётся CLOSED; минимального R не имеет.
TP2 SEMANTICS: структурный уровень 4H (противоположный свинг); закрывает
               оставшиеся 50 %; только он даёт статус TARGET_REACHED.
AFTER TP1 LIFECYCLE: 50 % зафиксировано → стоп в безубыток СО СЛЕДУЮЩЕГО бара →
               TP2 мониторится оставшимися 50 % → таймаут 48 (V3.3) / 50 (V3.0) баров.
               TP1 → исходный SL НЕВОЗМОЖЕН (литерал TP1_THEN_SL недостижим).
PARTIAL CLOSE WEIGHTS: 50 % / 50 %, заданы В КОДЕ (manageTrade), в настройках их нет.

PRODUCTION SIGNAL SAMPLE SIZE: NOT AVAILABLE (production БД/API недоступны из среды аудита)

V3.0:   (по production-сигналам — NOT AVAILABLE; ниже архивные прогоны репозитория)
  R1 median:    NOT AVAILABLE (targetRMultiple не сохранён в артефактах V3.0)
  R2 median:    NOT AVAILABLE
  TP1 hit rate: 48.26 % TRAIN (n=1585) · 47.39 % VALIDATION (n=536)
  TP2 hit rate: 17.35 % TRAIN          · 14.18 % VALIDATION
  SL rate:      48.71 % TRAIN          · 51.12 % VALIDATION

V3.3:   (по production-сигналам — NOT AVAILABLE; ниже архивный TRAIN, n=6957)
  R1 median:    0.5824   (p25 0.2425 · p75 1.1911)
  R2 median:    2.9164   (p25 1.8127 · p75 4.5831)
  TP1 hit rate: 65.24 %
  TP2 hit rate: 12.43 %
  SL rate:      33.03 %

LONG:   V3.3 n=3537 gross 0.0382 R · V3.0 TRAIN n=796 0.1736 R · V3.0 VALID n=230 0.0837 R
SHORT:  V3.3 n=3420 gross 0.1188 R · V3.0 TRAIN n=789 0.1717 R · V3.0 VALID n=306 0.1602 R

R1 < 0.25 COUNT/PERCENT: ≈ 25 % сделок V3.3 (p25 = 0.2425). Точный count —
                         NOT AVAILABLE (в артефактах агрегаты, не per-trade).
R1 < 0.50 COUNT/PERCENT: ≈ 44 % сделок V3.3 (интерполяция p25→median).
R1 < 1.00 COUNT/PERCENT: ≈ 70 % сделок V3.3 (интерполяция median→p75).
                         Дополнительно: 48.6 % ВСЕХ триггеров V3.3 (7762/15957)
                         имели TP1 позади закрытия триггерного бара.

STRUCTURAL ANOMALIES:  по production — NOT AVAILABLE.
                       По коду публикации ожидаются НУЛЕВЫМИ: в журнал попадают
                       только сетапы с publishable = corridorGeometryOk() (проверка
                       на ХУДШЕЙ границе). Гипотезу подтвердит §14 на проде.
WRONG-SIDE TARGETS:    в архивном прогоне V3.3 они существуют и отсекаются на баре
                       фила: rejected = 8140 из 15957 (51.0 %).
INVALID STOPS:         не обнаружены ни в одной формуле: стоп по построению
                       за экстремумом/гранью зоны, направление гарантировано.
TP2 <= TP1:            отсекается тем же geomOk; в БД попасть не может.
ZERO/NEGATIVE RISK:    отсекается `risk > 0` в corridorStep/manageTrade.

BTC SHORT SCREENSHOT SIGNAL:
  signal id:      НЕ НАЙДЕН — production-данные недоступны из среды аудита.
  actual persisted levels: НЕ ПРОЧИТАНЫ. Ниже — разбор чисел скриншота как гипотезы.
  entry 84 154.2–84 245.9 · stop 84 911.8 · TP1 84 104.5 · TP2 82 563.0
  R1:  0.134 (midpoint) · 0.212 (near) · 0.066 (actual fill / far)
  R2:  2.300 (midpoint) · 2.527 (near) · 2.100 (actual fill / far)
  formula explanation: числа обратно сходятся с V3.3 —
      ширина зоны 91.7 = 0.20·ATR ⟹ ATR ≈ 458.5; коридор = close(84 200.05) ± 0.10·ATR;
      стоп = max(климакс, грань зоны ≈ 84 843.0) + 0.15·ATR ≈ 84 911.8;
      TP1 = середина displacement-ноги 4H (структурный, не R-производный);
      TP2 = противоположный подтверждённый 4H swing low.
  expected/anomalous: INTENDED BEHAVIOUR формулы, НЕ баг кода.
      Единственный фильтр — «TP1 строго впереди худшей границы», минимума в R нет,
      поэтому 0.066R проходит публикацию. Системная слабость дизайна, не аномалия.

MFE/MAE: NOT AVAILABLE
  (signals не хранит экстремумы; OHLCV в проекте не персистится; сети к бирже нет)

COMMIT SHA: см. последний коммит ветки arena/01a0f0b2-cryptora
PR:         см. описание PR этой ветки
```

### RECOMMENDATIONS (перечислены, НЕ реализованы)

Ответы на поставленные вопросы:

**1. TP1 слишком близкий системно или только в отдельных setup?**
**Системно, у V3.3.** Доказательства: медиана R(TP1) = 0.5824 (т. е. половина сделок
закрывает первую половину позиции менее чем за 0.6R), p25 = 0.2425, и 48.6 % всех
триггеров вообще имеют TP1 позади закрытия триггерного бара. У V3.0 TP1 —
равновесие 4H-диапазона, оно по построению дальше от края диапазона; косвенный
признак — TP1 hit rate у V3.0 всего ~48 % против 65 % у V3.3 (реже достигается ⟹
в среднем дальше). Прямых R-квантилей по V3.0 в архиве нет.

**2. Нужен ли minimum TP1 R?** Да, это самая обоснованная точка вмешательства — но
как **фильтр публикации**, а не как перенос уровня. Двигать структурный TP1 к
искусственному «0.5R» значит перестать быть V3.3.

**3. Имеет ли смысл TP1 ≥ 0.5R / 0.75R / 1R на основании ФАКТИЧЕСКИХ данных?**
* `≥ 0.5R` отсекает ≈ 44 % исполненных сделок V3.3 — и именно тех, где первая
  половина позиции почти не окупает комиссию (fee drag 0.0511 R против 0.5·0.24 R);
* `≥ 1R` отсекает ≈ 70 % — это уже другая стратегия, не фильтр;
* **предлагаемый к исследованию порог: `TP1_R_far ≥ 0.5`**, считать ОБЯЗАТЕЛЬНО от
  far edge (фактического фила), а не от midpoint.
Проверять только бэктестом на VALIDATION-срезе: у V3.3 валидации вообще не было,
а TP1 — единственный источник её положительного gross (TP1_THEN_BE = 3295 из 6957
исходов). Порог может убить весь edge. **Не внедрять без прогона.**

**4. Нужно ли после TP1 переносить stop?** Перенос **уже есть** и работает
корректно (BE со следующего бара, R3/R4). Менять нечего. Открытый вопрос для
исследования — не «переносить ли», а «не слишком ли рано»: 3295 из 6957 сделок
V3.3 заканчиваются `TP1_THEN_BE`, то есть **47 % сделок отдают вторую половину в
ноль**, так и не дойдя до TP2 (12.43 %).

**5. Не слишком ли TP2 далёкий?** Да, по факту. R(TP2) median = 2.92, p75 = 4.58,
а достигается он лишь в **12.43 %** случаев (V3.3) и **14–17 %** (V3.0).
Асимметрия «TP1 0.58R / TP2 2.92R» означает, что вторая половина позиции почти
всегда либо выходит в BE, либо в таймаут. Кандидаты на исследование: промежуточный
TP2 (например 1.5–2R) или трейлинг вместо BE для второй половины.

**6. Есть ли существенная разница V3.0 vs V3.3?** Да, и она структурная:
* TP1: равновесие 4H-диапазона (V3.0) против середины displacement-ноги (V3.3) —
  второй уровень систематически ближе;
* стоп: экстремум свипа (V3.0) против min/max(климакс, грань зоны) (V3.3);
* триггер: liquidation trap против mitigation зоны + абсорбция;
* результат: V3.0 gross 0.1274 R **на отложенной выборке**; V3.3 gross 0.0778 R
  **только на TRAIN**, без валидации, и без топ-1 % сделок уходит ниже комиссии.
  **Сравнивать их как равные нельзя** — у них разный уровень доказанности.

**7. LONG vs SHORT различаются по качеству targets?** Да, устойчиво в пользу SHORT:
V3.3 TRAIN SHORT 0.1188 R против LONG 0.0382 R (в 3.1 раза);
V3.0 VALIDATION SHORT 0.1602 R против LONG 0.0837 R (в 1.9 раза).
На TRAIN V3.0 разницы нет (0.1717 / 0.1736), поэтому это **гипотеза, а не
установленный факт**; проверять на per-trade данных с разрезом R(TP1) по стороне.

Дополнительные рекомендации (не реализованы):

* **§1 UI**: заменить `V3.3 · v3.3` на `V3.3` при совпадении метки и версии, ЛИБО
  показывать версию отдельным полем в деталях — но только после решения, нужен ли
  вообще пользователю provenance-номер;
* **§10 display**: перевести экраны сигналов с `formatSignalPrice` на уже
  существующую `formatInstrumentPrice` (значащие цифры + tickSize) — это чисто
  презентационное изменение, persisted-уровни не затрагивает;
* **§12 provenance**: добавить `settings_snapshot`/`engine_constants_hash` в
  `signals` отдельной аддитивной миграцией (по согласованию), чтобы исторические
  строки оставались интерпретируемыми после любого будущего изменения констант;
* **§7 MFE/MAE**: чтобы вопрос «TP1 слишком близко/далеко» закрывался данными, а не
  рассуждением, нужен персист экстремумов после входа (`mfe_r`, `mae_r`,
  заполняются тем же монитором по закрытым свечам) — тоже отдельной миграцией;
* **§6 lifecycle**: рассмотреть колонку `tp1_hit_at`, чтобы TP1 перестал быть
  ВЫВОДИМЫМ из строкового `close_reason`.

---

```
STRATEGY MATH MODIFIED:       NO
TP MATH MODIFIED:             NO
SL MATH MODIFIED:             NO
SIGNAL MATH MODIFIED:         NO
PRODUCTION SETTINGS MODIFIED: NO
PRODUCTION SIGNALS MODIFIED:  NO
PRODUCTION DATABASE MODIFIED: NO
PRODUCTION DEPLOYED:          NO
```
