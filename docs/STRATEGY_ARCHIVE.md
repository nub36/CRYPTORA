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
| `legacy/v2/` | **Замороженный движок V2 источника @ `4839074`** — изолированная историческая зависимость архива (engine/htf/indicators/structure/tracker/risk/resolveEntry/executableLadder + `v24Engine`, `corridorEntry`, `research/{v22,v23}Engine`, `research/{v22,v23,v24}Replay`). DB-класс `Settings` заменён read-only snapshot-ридером (sha-пин). Sha256 каждого файла в `LEGACY_V2_PROVENANCE`. **Импортируется только `definitions/v2_*`; никогда — LIVE, `BacktestEngine`, воркерами, UI** (тест). `EXECUTION_CODE_PORTED = NONE`. `sniperEntryLoop.ts` / `research/replayArmRunner.ts` — glue CRYPTORA (порядок гейтов дословный). |
| `definitions/v2_2-htf-spot-engine/` | V2.2 (ОТКЛОНЕНА НА TRAIN): 7 arms A/T/R/TRG/S/Λ/FULL; headline FULL n=5323 gross +0.0083, net −0.0715 @2/5. |
| `definitions/v2_3-sniper-reversal/` | V2.3 (ОТКЛОНЕНА НА TRAIN): 6 arms; headline S-cor n=1497 gross +0.0844, net −0.0345 — критерии F провалены во всех ветках. |
| `definitions/v2_4-asymmetric-sniper/` | V2.4 (ПРОВАЛЕНА ВАЛИДАЦИЯ): кандидат S-asym заморожен `53c9ad8` до чтения VALIDATION; TRAIN n=689 +0.2023 → VALIDATION n=234 −0.1098 (net −0.2350, PF 0.8559). |
| `definitions/v2_5-trailing-stop/` | V2.5 (ТОЛЬКО TRAIN, НЕ ВАЛИДИРОВАНА): трейлинг по всему пулу входов n=30 867 — критерий «лучше baseline» пройден, но нетто −0.0786. |
| `definitions/v2_6-sniper-trailing/` | V2.6 (ОТКЛОНЕНА НА TRAIN): sniper ∩ trailing n=317 gross +0.1462 net −0.0092; frozen-exit +0.1490 ⇒ трейлинг избыточен. |
| `definitions/v3_3-htf-zone-mitigation/` | V3.3 (ТОЛЬКО TRAIN, НЕ ВАЛИДИРОВАНА): `v33Core.ts` (зоны OB/FVG 4H, митигация, абсорбция), `v33Runner.ts` (8 прогонов `<window>-<stop>-<leg>`; headline `while-protective-displacement` предзаявлен), `definition.ts`. Разворот из митигированной зоны, а не «Zone Continuation» (D-V33-001). |
| `definitions/v3_2-volume-climax/` | V3.2 (ФАЛЬСИФИЦИРОВАНА НА TRAIN): 4 варианта `union-cascade` (PRIMARY) / `fast3-cascade` / `union-ema50`, `fast3-ema50` (UNPROMOTED). |
| `definitions/v3_1-htf-trend-pullback/` | V3.1 (ФАЛЬСИФИЦИРОВАНА НА TRAIN): `v31Core.ts`, `v31Runner.ts` (варианты `leg` PRIMARY / `same-bar` SECONDARY), `definition.ts`. |
| `definitions/v3_0-htf-liquidation-trap/` | V3.0: `v30Core.ts` (чистые правила), `v30Runner.ts` (дословная логика исследовательского прогона, включая перекрытие позиций), `definition.ts` (замороженное определение, константы, расхождения, оговорки). |
| `provenance/provenance.json` | Неизменяемый манифест: source-репозиторий/коммит, dataset-репозиторий/коммит, sha256 исходников стратегии, артефактов валидации, замороженных настроек. |
| `results/` | Дословные копии артефактов источника (метрики TRAIN/VALID, паритет порта, settings/splits). |
| `definitions/v2_1a-structural-limit-entry/` | V2.1a (ОТКЛОНЕНА НА TRAIN): `v21aRunner.ts` поверх `legacy/v2/research/limitEntryReplay.ts` (модели B/C/D; A — baseline windowed-replay, SOURCE_REPORTED, не перенесена); 7 ТФ 1m…1d. |
| `definitions/v2_1b-corridor-entry/` | V2.1b (ОТКЛОНЕНА НА TRAIN): `v21bRunner.ts` поверх `legacy/v2/research/corridorReplay.ts` + `legacy/v2/corridorEntry.ts`; 7 веток A/E/F/C/EF/EFC/FULL. |
| `registry.ts` | Реестр: 13 перенесённых определений = 13 строк архива источника; `STRATEGY_ARCHIVE_PLANNED` пуст. |

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

### 4b. Как повторить V2.x (офлайн, оператор)

Для V2.1a/V2.1b (`scopeTimeframes` включает `1m`) `reproduce.mjs` загружает и считает пары по одной (результат идентичен единому вызову) и сравнивает только gross/счётчики/byTimeframe — у источника нет per-leg net; нужен клон со всеми 7 интервалами и ≥ 8 GB RAM (в песочнице 4 GB прогон завершился OOM, поэтому статус NOT_RERUN).

`npx tsx scripts/strategy-archive/reproduce.mjs --dataset=<клон c3c1dce с 15m/30m/1h/4h/1d> --version=V2_4_ASYMMETRIC_SNIPER --slice=validation --variant=S-asym --out=…` — раннер строит входы через `legacy/v2` и сравнивает n, funnel, gross/net/fee, PF, maxDD, exits, bySymbol/byDirection/byTimeframe, outlierDependence с артефактом источника (сравнение нечувствительно к порядку ключей). Полный перезапуск V2.5 (30 867 сделок × 24 ряда) занимает несколько минут; V2.2 FULL — ~10 мин.

## 4a. Реестр и статус по версиям

Реестр (`registry.ts`): 13 импортированных + 0 запланированных = 13 строк источника (`STRATEGY_ARCHIVE_TOTAL_ROWS` выводится, не захардкожен).

| Версия | Research verdict | Reproduction status | Source pin | Артефакты |
|---|---|---|---|---|
| V3.0 HTF Liquidation Trap | VALIDATED_FOR_RESEARCH | **REPRODUCED** (TRAIN+VALID) | `292050c` | `results/v30/` |
| V3.1 HTF Trend Pullback & Mitigation | **FALSIFIED_ON_TRAIN** (primary n=158 net −0.1097; same-bar n=82 net −0.2819) | **REPRODUCED** (оба варианта, TRAIN; все поля совпали, digest `fnv1a32:faecff40:n158` / `fnv1a32:2eefcd7c:n82`) | `292050c` (prereg `760b15f`) | `results/v31/` |
| V3.2 Volume Climax & Absorption | **FALSIFIED_ON_TRAIN** (primary n=307 gross −0.0082 net −0.0620; fast3 n=158 net −0.1126); EMA50-варианты (+0.0530 n=213 / +0.0108 n=97) — F3 fail → **UNPROMOTED** | **REPRODUCED** (все 4 варианта, TRAIN, все поля совпали) | `b46b4a0` (prereg `b631fba`) | `results/v32/` |
| V3.3 HTF Zone Mitigation & LTF Squeeze | **TRAIN_ONLY_NOT_VALIDATED** (headline while/protective/displacement n=6957 gross +0.0778 net +0.0267 fee 0.0511 TP1 65.24 % — F1/F2/F3 pass на TRAIN, но хвост: ex-top-1 % gross 0.0264 < fee; VALIDATION не проводилась — окно израсходовано V3.0). 7 остальных прогонов — чувствительность: first/protective проваливают F1 (−0.0253, −0.0343); while/climax/swing проваливает F3; stop=climax до +0.1058 — постфактум | **REPRODUCED** (все 8 прогонов, TRAIN, все поля совпали; headline digest `fnv1a32:c1bbd4ba:n6957`) | `a7ecd79` (prereg `16728ef`, amend `01cbc28`, doc `2d8a3dd`) | `results/v33/` |
| V2.7 Target RR Optimisation | **REJECTED_ON_TRAIN** (5 arms, n=317, все нетто-отрицательны: −0.0782…−0.0172; fee drag 0.1555 R одинаков для всех целей; headline нет) | **REPRODUCED** (все 5 веток через `legacy/v2`; n=317; digests RR15 `cc1ade87` … RR40 `48b330bc`) | `965fb15` (prereg `d9394b1`) | `results/v27/` |
| V2.8 Zero-fee Sniper + Trailing | **VALIDATED_GROSS_ONLY** ⚠️ fees=0: TRAIN Trail gross +0.1462 (n=317, PF 1.3508); VALIDATION Trail gross +0.0488 (n=98, PF 1.1087) — PASS, но без одной сделки −0.0143; SMC-якорь на VALIDATION −0.1821. При 2/5 bps популяция теряет ≈0.1555 R → нетто отрицательна. **НЕ сопоставимо с net V3.x** | **REPRODUCED** (TRAIN 7 веток n=317; VALIDATION SMC `791c88a3` / Trail `7a323ada` n=98; все поля совпали) | `1d4d575` (train `54243a7`, freeze `852167c`) | `results/v28/` |
| V2.2 HTF Spot Engine | **REJECTED_ON_TRAIN** (оба предзаявленных критерия провалены; headline FULL n=5323 gross +0.0083 net −0.0715; удалённый R-multiple fallback был единственным прибыльным основанием TP1) | **REPRODUCED** (headline FULL; digest `fnv1a32:1887e6c6:n5323`; остальные 6 веток не перезапускались) | `5ce58db` (prereg `1b4f09b`, Amend.1 `3952061`) | `results/v22/` |
| V2.3 Sniper Reversal | **REJECTED_ON_TRAIN** (все 6 веток проваливают критерии; headline S-cor n=1497 gross +0.0844 PF 1.1294 net −0.0345) | **REPRODUCED** (headline S-cor; `fnv1a32:74082f0a:n1497`; остальные не перезапускались) | `2ee06d1` (prereg `d78c3cc`) | `results/v23/` |
| V2.4 Asymmetric Sniper | **FAILED_VALIDATION** (S-asym: TRAIN n=689 +0.2023 → VALIDATION n=234 −0.1098, net −0.2350; знак инвертировался) | **REPRODUCED** (S-asym TRAIN `fnv1a32:bd21237a:n689` + VALIDATION `fnv1a32:8edcd5e1:n234`; другие TRAIN-ветки не перезапускались) | `c52fda7` (train `8e07352`, freeze `53c9ad8`, prereg `072490e`) | `results/v24/` |
| V2.5 Trailing Stop | **TRAIN_ONLY_NOT_VALIDATED** (критерий «V25 > baseline A» пройден: −0.0786 vs −0.1257 нетто — оба отрицательны; 21 граничный вход отброшен) | **REPRODUCED** (V25 `fnv1a32:eecdce93:n30867`; baseline A не перезапускалась) | `07dabbb` (prereg `aad5be5`) | `results/v25/` |
| V2.6 Sniper + Trailing | **REJECTED_ON_TRAIN** (V26 n=317 gross +0.1462 net −0.0092 < 0; frozen-exit +0.1490 ≥ V26 — трейлинг не добавляет) | **REPRODUCED** (обе ветки: `74bd32bd` / `ee2f6c4f` — те же входы и digests, что V2.8 Trail/SMC) | `e89cf1e` (prereg `3e164ef`) | `results/v26/` |
| V2.1a Structural Limit Entry | **REJECTED_ON_TRAIN** (ни одна модель не выбрана: gross/filled A +0.0350 · B +3.5281 · C +0.6941 · D +0.4325, но нетто @0.1 % lump A −0.7289 · B −5.3159 · C −3.5594 · D −0.9386; fill B 12.98 %; медианная комиссия B ≈2 R — ранжирование gross↔net инвертировано) | **SOURCE_CHAIN_VERIFIED_NOT_RERUN** (все 8 пинов sha256 сверены на `4b25bbb`/`2d8a3dd`; раннер перенесён; перезапуск 42 рядов 1m…1d × 6 пар не выполнялся — ряды 1m не помещаются в память песочницы 4 GB; модель A = SOURCE_REPORTED) | `4b25bbb` (prereg `e3750fc`, env `356a874`) | `results/v21a/` |
| V2.1b Confirmed-Extreme Corridor Entry | **REJECTED_ON_TRAIN** (предзаявленная метрика gross/ORIGINAL setup: A +0.0090 > E +0.0059 > C +0.0011 > FULL +0.0001 > EF/F/EFC ≤ 0 — ни один фильтр не превзошёл baseline; FULL n=56 486, fill коридора 24.09 %, нетто @0.1 % −0.1167; гейт комиссии отрезал лучшие входы (+0.0676 отклонённые vs +0.0142 допущенные); tf-cost-диагностика — не вердикт) | **SOURCE_CHAIN_VERIFIED_NOT_RERUN** (пины сверены; раннер перенесён; перезапуск не выполнялся — та же причина, что V2.1a) | `374b335` (prereg `5ce3761`, tf-cost `dccf751`) | `results/v21b/` |

«Воспроизведено» — только повторяемость чисел на том же датасете. V2.1a/V2.1b — единственные две строки без перезапуска: их статус SOURCE_CHAIN_VERIFIED_NOT_RERUN означает проверенную цепочку spec → код → артефакт (sha256), но **не** повторённый прогон; цифры V2.1 — SOURCE_REPORTED. Для V3.1 и V3.2 воспроизведён именно **отрицательный** результат; для V3.3 воспроизведён TRAIN-only результат, который **не является валидированным** и не сравнивается с VALIDATION V3.0.

## 5. Расхождения спецификация ↔ исследовательский код

**D-V30-001 — перекрытие позиций.** Спецификация (`docs/strategies/V3_0_HTF_LIQUIDATION_TRAP.md`) утверждает «одна позиция одновременно». Исследовательские прогоны (train и validate) объявляют флаг `busy`, но никогда его не выставляют → перекрывающиеся сделки по одной паре разрешены. Продакшен-порт источника (`src/strategy/v30/runner.ts`) перекрытие блокирует, поэтому его результаты не тождественны исследовательским.
**Политика:** историческое воспроизведение V3.0 **сохраняет** поведение исследования (перекрытие разрешено) — иначе числа TRAIN/VALID невоспроизводимы. Вариант без перекрытия, если понадобится, — **новый** вариант (например `V3.0-no-overlap`) с собственным прогоном, а не правка V3.0.

**D-V31-001** — перекрытие позиций в раннере V3.1 (тот же паттерн). **D-V31-002** — источник раскрыл баг двойного учёта TP1 в первом прогоне; архивированы исправленные (худшие) цифры. **D-V31-003** — Spot-данные + futures-комиссии.

**D-V27-001…004** — стоп 0.25 ATR вместо 0.05 из задания; горизонт 50 vs frozen 48; `best`=RR40 — наименее убыточный, не оптимум; входы от замороженного движка `4839074`. **D-V28-001…005** — все цифры gross при fees=0; PASS «на одной сделке»; кандидат Trail выбран до валидации по устойчивости к выбросам; TEST-2026 предзаявлен, не запускался; зависимость от `4839074`.

**D-V22-001…** — «FUT_7» = 2/5 bps (headline), «FUT_4» в Amend.1 = 2/2; в V2.5+ те же 2/5 подписаны «FUT_4» — наименования сред комиссий в источнике непоследовательны, архив хранит bps, а не ярлыки. **D-V24-001…** — кандидат заморожен до чтения VALIDATION (`53c9ad8`); TEST-2026 не читался. **D-V25-001…005** — 21 вход на границе окна отброшен; критерий «лучше baseline» проходим при отрицательном нетто. **D-V26-001…005** — V26 = V2.8 Trail на тех же входах; фактически не отдельный движок.

**Проверка sha256 (C6):** все 71 пинов файлов V2.2–V2.8 пересчитаны в клоне источника: совпадают на HEAD `2d8a3dd`, а файлы, существовавшие на исторических пинах, — и на своих пинах. Спецификации `docs/strategies/V2_x_*.md` для V2.2–V2.6 **написаны ретроспективно** (добавлены в `1f3ae3a` при консолидации архива), чего на исторических пинах не было — это отмечено в самих пинах; первичные документы эпохи — prereg/RESULTS.

**D-V21A-001…006 / D-V21B-001…006** — источник считал нетто как **единый lump 0.1 % на сделку** + чувствительность 2…10 bps round-trip, без разделения maker/taker; архивные колонки net@2/5 (FUT_7) и @5/5 (SPOT) — **DERIVED_BY_CRYPTORA**, а не цифры источника. Основная метрика V2.1 — gross **на исходный actionable setup** (а не на заполненный ордер) — сжатый знаменатель B/C/D делает gross/filled несопоставимым с per-setup. В `limit-entry-train-metrics.json` поля с именем «gross…» хранят уже нетто-R после lump (истинные gross — в `limit-entry-train-gross.json`, D-V21A-006). Оба исследования зависят от `4839074`; V2.1a модель A (baseline) не портирована. **Не сопоставимы** с V2.2+ (другой знаменатель, другая модель комиссий) и с V3.x.

**D-V33-001** — переименование: ранний черновик «HTF Zone Continuation» → итоговое «Zone Mitigation & LTF Squeeze»; логика — разворот из митигированной зоны в направлении исходного displacement. **D-V33-002** — перекрытие позиций (при window=while существенно раздувает n). **D-V33-003** — CORRIDOR_EXPIRY_BARS=3 унаследован из V3.0 без упоминания в предрегистрации. **D-V33-004** — 8 прогонов; primary предзаявлен (`isPrimary`), Amendment 1 добавил leg=swing и tie-break до чтения результатов; stop=climax — постфактум. **D-V33-005** — VALIDATION никогда не запускалась (окно уже прочитано V3.0; TEST-2026 не читается) → внесэмпловых данных нет.

**D-V32-001** — перекрытие позиций. **D-V32-002** — две неоднозначности спецификации (окно каскада, TP1) отгружены как варианты; primary предзаявлен; EMA50-варианты не продвинуты (F3). **D-V32-003** — RVOL ≥ 2.2 включительно (в V3.0/V3.1 строго >).

## 6. Ограничения

- Историческое исследование на Binance Spot 1h/4h; результаты зависят от периода и не являются прогнозом.
- VALID: 3 из 6 пар отрицательны (BTC, SOL, XRP); ex-top-5 сделок net R = +0.0482 < комиссия 0.0673 R — чувствительность к концентрации.
- Одна выборка валидации, один прогон; интервалы доверия не оценивались.
- Комиссии: модель 2 bps maker вход / 5 bps taker выходы; проскальзывание не моделируется.
- Метрики в R, без капитала, позиционирования и лимитов маржи.
- Воспроизведение подтверждает повторяемость чисел на том же датасете, а не устойчивость эффекта вне выборки.
