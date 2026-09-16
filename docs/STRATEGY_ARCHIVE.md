# Архив стратегий (Strategy Archive) — архитектура, происхождение, статус воспроизведения

> Статус документа: шаг 1 (фундамент + V3.0). Остальные версии архива (V2.1…V2.8, V3.1) **не перенесены** и появятся отдельными шагами — включая отклонённые и фальсифицированные (без survivor bias).
> Инвариант: **CRYPTORA не исполняет сделки.** Архив — историческое исследование, не сигналы и не прогноз.

## 1. Что это и чем не является

Архив стратегий — набор **замороженных** определений исследовательских стратегий из репозитория
`svechnoy-suslik-v2` с их исходными результатами и цепочкой происхождения (provenance), плюс узкий
«движок воспроизведения» для повторного исторического прогона на закреплённом датасете.

- **Не** второй универсальный бэктестер. Существующий `src/services/backtest/BacktestEngine.ts` не изменён.
- **Не** торговый рантайм: нет ордеров, ключей, бирж, ботов.
- Версии **не** сливаются в один алгоритм `if (version)`: каждая версия — отдельный модуль, закреплённый за source-коммитом.
- Версии **не** ранжируются между собой: допущения валидации разных версий несопоставимы.
- Запрещённые формулировки в UI/доках: «прибыльная стратегия», «лучший сигнал», «ожидаемая доходность».

## 2. Архитектура (`src/services/strategyArchive/`)

| Путь | Назначение |
|---|---|
| `types.ts` | Контракты: `ArchiveCandle`, `StrategyDefinition`, `RunSeriesResult`, `ReproductionReport`, `ResultOrigin` (`SOURCE_REPORTED` / `REPRODUCED` / `DERIVED_BY_CRYPTORA`), `Discrepancy`. |
| `shared/candleAdapter.ts` | Нормализация OHLCV CRYPTORA (секунды) и внешних рядов (мс/мкс) в `ArchiveCandle` (мс, `closeTime = open + span − 1`, `isClosed`), детекция единиц времени, валидация пропусков. |
| `shared/frozenSettings.ts` | Замороженные настройки прогона из `results/v2-real-*/settings.json` + `splits.json` (60/20/20), без БД; sha256 проверяется тестом. |
| `shared/primitives.ts` | Порт `structure.ts`/`indicators.ts`/`htf.ts` источника: свинги, ATR, RVOL (текущий бар исключён), выбор закрытых HTF-свечей по времени. |
| `engine/reproductionEngine.ts` | Минимальный контракт: определение + нормализованные свечи + замороженные допущения → сделки → R-метрики → отчёт с детерминированным digest. |
| `engine/rMetrics.ts` | R-метрики: gross/net R на сделку при комиссиях 2/5 bps (headline) и стресс-наборе, PF, maxDD (R), зависимость от top-1% выбросов, доля положительных. |
| `definitions/v2_7-rr-optimization/` | V2.7 (ОТКЛОНЕНА НА TRAIN): `v27Core.ts` (`simulateFixedRr`, `feeR`), 5 arms RR15…RR40 без headline; раннер отказывается выдумывать входы без legacy-движка. |
| `definitions/v2_8-zero-fee-sniper-trailing/` | V2.8 (ВАЛИДИРОВАНА ТОЛЬКО GROSS, fees=0): 7 exit-arms на TRAIN, SMC+Trail на VALIDATION; кандидат Trail заморожен до валидации. `feeSemantics: GROSS_ONLY_ZERO_FEE`. |
| `shared/legacyResearch/v25Trailing.ts` | Замороженный research-симулятор трейлинга V2.5 (`fe6c307e…`), используется V2.5/V2.6/V2.8. |
| `definitions/v3_3-htf-zone-mitigation/` | V3.3 (ТОЛЬКО TRAIN, НЕ ВАЛИДИРОВАНА): `v33Core.ts` (зоны OB/FVG 4H, митигация, абсорбция), `v33Runner.ts` (8 прогонов `<window>-<stop>-<leg>`; headline `while-protective-displacement` предзаявлен), `definition.ts`. Разворот из митигированной зоны, а не «Zone Continuation» (D-V33-001). |
| `definitions/v3_2-volume-climax/` | V3.2 (ФАЛЬСИФИЦИРОВАНА НА TRAIN): 4 варианта `union-cascade` (PRIMARY) / `fast3-cascade` / `union-ema50`, `fast3-ema50` (UNPROMOTED). |
| `definitions/v3_1-htf-trend-pullback/` | V3.1 (ФАЛЬСИФИЦИРОВАНА НА TRAIN): `v31Core.ts`, `v31Runner.ts` (варианты `leg` PRIMARY / `same-bar` SECONDARY), `definition.ts`. |
| `definitions/v3_0-htf-liquidation-trap/` | V3.0: `v30Core.ts` (чистые правила), `v30Runner.ts` (дословная логика исследовательского прогона, включая перекрытие позиций), `definition.ts` (замороженное определение, константы, расхождения, оговорки). |
| `provenance/provenance.json` | Неизменяемый манифест: source-репозиторий/коммит, dataset-репозиторий/коммит, sha256 исходников стратегии, артефактов валидации, замороженных настроек. |
| `results/` | Дословные копии артефактов источника (метрики TRAIN/VALID, паритет порта, settings/splits). |
| `registry.ts` | Реестр: перенесённые определения + список запланированных версий (7) с их исходными вердиктами. |

Движок читает только ряды свечей, переданные вызывающей стороной. Никаких сетевых вызовов, БД, localStorage.

## 3. Происхождение (provenance)

- Источник: `nub36/svechnoy-suslik-v2 @ 292050c6c3f32807a85548e037f674d42a2efb18`.
- Датасет: `nub36/svechnoy-suslik-binance-data @ c3c1dce` — Binance Spot klines, 2022-01…2025-12, 6 пар × 7 ТФ, 16 681 073 свечей. **Датасет в репозиторий не коммитится**; хранятся манифест, коммит, требуемые пары/интервалы/период и sha256 артефактов.
- Ключевые коммиты V3.0 в источнике: prereg `6c2bf9e`, train `5674e65`, freeze `21feabe`, valid `3278087`, port `76a8f32`.
- Все хеши — в `provenance/provenance.json`; целостность проверяется `tests/unit/strategyArchive/foundation.test.ts`.

## 4. Статус воспроизведения V3.0

Два независимых измерения: **RESEARCH VERDICT** (исход в программе источника) и **REPRODUCTION STATUS** (повторил ли CRYPTORA числа). «Воспроизведено» ≠ «стратегия успешна».

| Поле | Значение |
|---|---|
| Версия | V3.0 HTF Liquidation Trap (1h исполнение, 4h уровни, 6 пар) |
| Research verdict | `VALIDATED_FOR_RESEARCH` (источник; НЕ production-ready) |
| Reproduction status | **`REPRODUCED`** — реальный прогон в CRYPTORA 2026-09-16 на датасете `c3c1dce` (sparse-клон 1h/4h, вне репозитория) |
| SOURCE_REPORTED | TRAIN n=1585, gross +0.1726, net@2/5 +0.0994, PF 1.3538; VALID n=536, gross +0.1274, net +0.0600, PF 1.2484 |
| DERIVED_BY_CRYPTORA (прогон) | TRAIN n=1585, funnel 2015/2015/1585/0/330/100/0, digest `fnv1a32:8156fe4a:n1585`; VALID n=536, funnel 691/691/536/0/130/24/1, digest `fnv1a32:02e59d33:n536` — все сравниваемые поля (n, funnel, gross, net FUT_4/SPOT, feeDrag, PF, maxDD, exits, outlierDependence, byDirection, bySymbol, stopDistance, avgWin/Loss, medianBarsHeld) совпали; FIRST_MISMATCH = none |
| Evidence | `results/v30/cryptora-reproduction/v30-{train,validation}-reproduction.json` (хранятся отдельно от source-артефактов) |
| Синтетический паритет | дополнительно: побитовое совпадение с оригинальным `research/v30_htf_trap.ts` на синтетическом ряде (`tests/unit/strategyArchive/fixtures/`) |
| Как повторить | `npx tsx scripts/strategy-archive/reproduce-v30.mjs --dataset=<клон c3c1dce> --slice=train|validation --out=…` (офлайн, оператор) |

## 4a. Реестр и статус по версиям

Реестр (`registry.ts`): импортированные + запланированные = 13 строк источника (`STRATEGY_ARCHIVE_TOTAL_ROWS` выводится, не захардкожен).

| Версия | Research verdict | Reproduction status | Source pin | Артефакты |
|---|---|---|---|---|
| V3.0 HTF Liquidation Trap | VALIDATED_FOR_RESEARCH | **REPRODUCED** (TRAIN+VALID) | `292050c` | `results/v30/` |
| V3.1 HTF Trend Pullback & Mitigation | **FALSIFIED_ON_TRAIN** (primary n=158 net −0.1097; same-bar n=82 net −0.2819) | **REPRODUCED** (оба варианта, TRAIN; все поля совпали, digest `fnv1a32:faecff40:n158` / `fnv1a32:2eefcd7c:n82`) | `292050c` (prereg `760b15f`) | `results/v31/` |
| V3.2 Volume Climax & Absorption | **FALSIFIED_ON_TRAIN** (primary n=307 gross −0.0082 net −0.0620; fast3 n=158 net −0.1126); EMA50-варианты (+0.0530 n=213 / +0.0108 n=97) — F3 fail → **UNPROMOTED** | **REPRODUCED** (все 4 варианта, TRAIN, все поля совпали) | `b46b4a0` (prereg `b631fba`) | `results/v32/` |
| V3.3 HTF Zone Mitigation & LTF Squeeze | **TRAIN_ONLY_NOT_VALIDATED** (headline while/protective/displacement n=6957 gross +0.0778 net +0.0267 fee 0.0511 TP1 65.24 % — F1/F2/F3 pass на TRAIN, но хвост: ex-top-1 % gross 0.0264 < fee; VALIDATION не проводилась — окно израсходовано V3.0). 7 остальных прогонов — чувствительность: first/protective проваливают F1 (−0.0253, −0.0343); while/climax/swing проваливает F3; stop=climax до +0.1058 — постфактум | **REPRODUCED** (все 8 прогонов, TRAIN, все поля совпали; headline digest `fnv1a32:c1bbd4ba:n6957`) | `a7ecd79` (prereg `16728ef`, amend `01cbc28`, doc `2d8a3dd`) | `results/v33/` |
| V2.7 Target RR Optimisation | **REJECTED_ON_TRAIN** (5 arms, n=317, все нетто-отрицательны: −0.0782…−0.0172; fee drag 0.1555 R одинаков для всех целей; headline нет) | **SOURCE_CHAIN_VERIFIED_NOT_RERUN** — входы зависят от замороженного движка V2 `4839074` (порт в C6) | `965fb15` (prereg `d9394b1`) | `results/v27/` |
| V2.8 Zero-fee Sniper + Trailing | **VALIDATED_GROSS_ONLY** ⚠️ fees=0: TRAIN Trail gross +0.1462 (n=317, PF 1.3508); VALIDATION Trail gross +0.0488 (n=98, PF 1.1087) — PASS, но без одной сделки −0.0143; SMC-якорь на VALIDATION −0.1821. При 2/5 bps популяция теряет ≈0.1555 R → нетто отрицательна. **НЕ сопоставимо с net V3.x** | **SOURCE_CHAIN_VERIFIED_NOT_RERUN** — входы и SMC-arm зависят от `4839074` (порт в C6) | `1d4d575` (train `54243a7`, freeze `852167c`) | `results/v28/` |
| V2.1a…V2.6 | по источнику | запланированы (C6–C7) | — | — |

«Воспроизведено» — только повторяемость чисел на том же датасете. Для V3.1 и V3.2 воспроизведён именно **отрицательный** результат; для V3.3 воспроизведён TRAIN-only результат, который **не является валидированным** и не сравнивается с VALIDATION V3.0.

## 5. Расхождения спецификация ↔ исследовательский код

**D-V30-001 — перекрытие позиций.** Спецификация (`docs/strategies/V3_0_HTF_LIQUIDATION_TRAP.md`) утверждает «одна позиция одновременно». Исследовательские прогоны (train и validate) объявляют флаг `busy`, но никогда его не выставляют → перекрывающиеся сделки по одной паре разрешены. Продакшен-порт источника (`src/strategy/v30/runner.ts`) перекрытие блокирует, поэтому его результаты не тождественны исследовательским.
**Политика:** историческое воспроизведение V3.0 **сохраняет** поведение исследования (перекрытие разрешено) — иначе числа TRAIN/VALID невоспроизводимы. Вариант без перекрытия, если понадобится, — **новый** вариант (например `V3.0-no-overlap`) с собственным прогоном, а не правка V3.0.

**D-V31-001** — перекрытие позиций в раннере V3.1 (тот же паттерн). **D-V31-002** — источник раскрыл баг двойного учёта TP1 в первом прогоне; архивированы исправленные (худшие) цифры. **D-V31-003** — Spot-данные + futures-комиссии.

**D-V27-001…004** — стоп 0.25 ATR вместо 0.05 из задания; горизонт 50 vs frozen 48; `best`=RR40 — наименее убыточный, не оптимум; входы от замороженного движка `4839074`. **D-V28-001…005** — все цифры gross при fees=0; PASS «на одной сделке»; кандидат Trail выбран до валидации по устойчивости к выбросам; TEST-2026 предзаявлен, не запускался; зависимость от `4839074`.

**D-V33-001** — переименование: ранний черновик «HTF Zone Continuation» → итоговое «Zone Mitigation & LTF Squeeze»; логика — разворот из митигированной зоны в направлении исходного displacement. **D-V33-002** — перекрытие позиций (при window=while существенно раздувает n). **D-V33-003** — CORRIDOR_EXPIRY_BARS=3 унаследован из V3.0 без упоминания в предрегистрации. **D-V33-004** — 8 прогонов; primary предзаявлен (`isPrimary`), Amendment 1 добавил leg=swing и tie-break до чтения результатов; stop=climax — постфактум. **D-V33-005** — VALIDATION никогда не запускалась (окно уже прочитано V3.0; TEST-2026 не читается) → внесэмпловых данных нет.

**D-V32-001** — перекрытие позиций. **D-V32-002** — две неоднозначности спецификации (окно каскада, TP1) отгружены как варианты; primary предзаявлен; EMA50-варианты не продвинуты (F3). **D-V32-003** — RVOL ≥ 2.2 включительно (в V3.0/V3.1 строго >).

## 6. Ограничения

- Историческое исследование на Binance Spot 1h/4h; результаты зависят от периода и не являются прогнозом.
- VALID: 3 из 6 пар отрицательны (BTC, SOL, XRP); ex-top-5 сделок net R = +0.0482 < комиссия 0.0673 R — чувствительность к концентрации.
- Одна выборка валидации, один прогон; интервалы доверия не оценивались.
- Комиссии: модель 2 bps maker вход / 5 bps taker выходы; проскальзывание не моделируется.
- Метрики в R, без капитала, позиционирования и лимитов маржи.
- Воспроизведение подтверждает повторяемость чисел на том же датасете, а не устойчивость эффекта вне выборки.
