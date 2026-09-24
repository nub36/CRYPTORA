-- ============================================================================
-- CRYPTORA — READ-ONLY аудит provenance сигналов (инцидент 2026-09-24)
-- ============================================================================
-- Контекст
-- --------
-- На production три РАЗНЫХ strategy_id (V3.0 / V3.3 / V2.8) получили на одном
-- символе и одном signal_candle_ts полностью одинаковый payload (direction,
-- entry_min, entry_max, stop_loss, targets).
--
-- Root cause (найден кодом, подтверждён regression-тестами):
--   server/services/strategyEngine/strategyEngine.js — `runStrategyScan()`
--   читал `SignalsAuditLedger.getInstance()` ПОСЛЕ `await`, поэтому при
--   конкурентном запуске стратегий планировщиком брал ЧУЖОЙ статический
--   журнал (движка, созданного последним), а `buildSignalRecord()` ставил в
--   строку `strategy_id` ВЫЗЫВАЮЩЕГО, а не автора сетапа.
--
-- Этот файл — ТОЛЬКО диагностика. Здесь НЕТ и НЕ ДОЛЖНО появиться ни одного
-- DELETE / UPDATE / INSERT / DROP / ALTER. Ничего не удаляем и не
-- переписываем: подозрительные строки — доказательство, а не мусор.
--
-- Как запускать
-- -------------
--   psql "$DATABASE_URL" -f scripts/sql/signal-provenance-audit.sql
--
-- или, чтобы исключить любую случайную запись, в read-only транзакции:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
--   BEGIN READ ONLY;
--   \i scripts/sql/signal-provenance-audit.sql
--   COMMIT;
--   SQL
--
-- Файл лежит ВНЕ server/db/migrations — `npm run migrate` его не применит.
-- Никакая миграция для этого аудита не нужна и не предлагается: колонки
-- `engine_setup_id`, `strategy_version`, `targets` уже есть (миграция 009).
-- ============================================================================

\set QUIET on
\pset pager off
\set QUIET off

\echo '=================================================================='
\echo '0. Опись таблицы: сколько всего строк и по каким стратегиям'
\echo '=================================================================='

SELECT strategy_id,
       count(*)                                   AS rows_total,
       count(*) FILTER (WHERE status IN ('ACTIVE', 'FILLED')) AS rows_open,
       min(signal_candle_ts)                      AS first_candle,
       max(signal_candle_ts)                      AS last_candle
  FROM signals
 GROUP BY strategy_id
 ORDER BY strategy_id;

-- ---------------------------------------------------------------------------
-- 1. PROVENANCE: кто на самом деле породил строку
-- ---------------------------------------------------------------------------
-- `engine_setup_id` mint'ит САМ LIVE-реплей стратегии:
--     `${strategyId}-${symbol}-${setupOpenTime}`
-- (src/services/signals/live/LiveSignalEngine.ts: setupId()).
-- `strategy_version` тоже несёт сам реплей. Оба поля пишутся ИЗ СЕТАПА, а не
-- из вызывающего, поэтому они и выдают истинного автора.
--
-- Строка с `engine_setup_id`, чей префикс не совпадает с `strategy_id`,
-- является ДОКАЗАННОЙ подменой авторства: математика одной стратегии
-- опубликована под именем другой.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=================================================================='
\echo '1. Доказанные подмены авторства (engine_setup_id ≠ strategy_id)'
\echo '=================================================================='

SELECT s.id,
       s.strategy_id                                   AS labeled_as,
       split_part(s.engine_setup_id, '-', 1)           AS generated_by,
       s.strategy_version                              AS generated_version,
       s.engine_setup_id,
       s.symbol,
       s.timeframe,
       s.signal_candle_ts,
       s.direction,
       s.status,
       s.entry_min,
       s.entry_max,
       s.stop_loss,
       s.targets,
       -- `exit_rule` и факторы тоже пишутся ИЗ СЕТАПА, поэтому они называют
       -- истинного автора даже там, где engine_setup_id потерян:
       --   V3.0 → 'Ловушка ликвидности…', 'TP1 = равновесие 4H-диапазона'
       --   V3.3 → '4H-зона …',           'TP1 = середина displacement-ноги 4H'
       --   V2.8 → 'Вход по OPEN бара N+1…'
       left(s.exit_rule, 60)                        AS exit_rule_of_generator,
       s.metadata -> 'confirmingFactors' ->> 0      AS first_factor_of_generator,
       s.created_at
  FROM signals s
 WHERE s.engine_setup_id IS NOT NULL
   AND split_part(s.engine_setup_id, '-', 1) <> s.strategy_id
 ORDER BY s.signal_candle_ts DESC, s.symbol, s.strategy_id;

\echo ''
\echo '--- ИТОГ по подменам: сколько строк и какие пары подмена/источник ---'

SELECT s.strategy_id                         AS labeled_as,
       split_part(s.engine_setup_id, '-', 1) AS generated_by,
       count(*)                              AS misattributed_rows,
       count(DISTINCT s.symbol)              AS symbols,
       min(s.signal_candle_ts)               AS first_candle,
       max(s.signal_candle_ts)               AS last_candle
  FROM signals s
 WHERE s.engine_setup_id IS NOT NULL
   AND split_part(s.engine_setup_id, '-', 1) <> s.strategy_id
 GROUP BY 1, 2
 ORDER BY misattributed_rows DESC;

-- ---------------------------------------------------------------------------
-- 2. CROSS-STRATEGY COLLISION GROUPS
-- ---------------------------------------------------------------------------
-- То, что просил владелец: группы строк, у которых совпадают
--   symbol, signal_candle_ts, direction, entry_min, entry_max, stop_loss,
--   targets
-- но РАЗНЫЕ strategy_id.
--
-- Важно: само по себе совпадение уровней НЕ является ошибкой (V3.0 и V3.3
-- обе считают коридор как close ± 0.10 ATR и могут сойтись по стопу).
-- Ошибка — это provenance: строка обязана происходить от СВОЕЙ стратегии.
-- Поэтому группы из раздела 2 нужно сопоставить с разделом 1:
--   • если для строки есть запись в разделе 1 — подмена доказана;
--   • если нет — это совпадение уровней, его надо подтвердить
--     пересчётом фикстур (см. tests/integration/strategyProvenance.test.ts).
-- ---------------------------------------------------------------------------

\echo ''
\echo '=================================================================='
\echo '2. Итог по cross-strategy collision groups'
\echo '=================================================================='

WITH groups AS (
    SELECT symbol,
           signal_candle_ts,
           direction,
           entry_min,
           entry_max,
           stop_loss,
           targets,
           count(DISTINCT strategy_id) AS strategies,
           count(*)                    AS rows_in_group,
           array_agg(DISTINCT strategy_id ORDER BY strategy_id) AS strategy_ids
      FROM signals
     GROUP BY symbol, signal_candle_ts, direction, entry_min, entry_max, stop_loss, targets
    HAVING count(DISTINCT strategy_id) > 1
)
SELECT count(*)                                     AS collision_groups,
       coalesce(sum(rows_in_group), 0)              AS rows_in_collisions,
       coalesce(sum(strategies), 0)                 AS strategy_slots_in_collisions
  FROM groups;

\echo ''
\echo '--- Сами collision groups (символ, бар, сколько strategy_id) ---'

SELECT symbol,
       signal_candle_ts,
       direction,
       entry_min,
       entry_max,
       stop_loss,
       targets,
       array_agg(DISTINCT strategy_id ORDER BY strategy_id)                  AS strategy_ids,
       array_agg(DISTINCT split_part(engine_setup_id, '-', 1)
                 ORDER BY split_part(engine_setup_id, '-', 1))               AS generated_by,
       count(*)                                                              AS rows_in_group
  FROM signals
 GROUP BY symbol, signal_candle_ts, direction, entry_min, entry_max, stop_loss, targets
HAVING count(DISTINCT strategy_id) > 1
 ORDER BY signal_candle_ts DESC, symbol;

-- ---------------------------------------------------------------------------
-- 3. Полный список подозрительных строк «для протокола»
-- ---------------------------------------------------------------------------
-- Всё, что попадает хотя бы в один из двух признаков, с пометкой, доказана
-- подмена или это только совпадение уровней.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=================================================================='
\echo '3. Все подозрительные строки: provenance + collision'
\echo '=================================================================='

WITH collision AS (
    SELECT symbol, signal_candle_ts, direction, entry_min, entry_max, stop_loss, targets
      FROM signals
     GROUP BY symbol, signal_candle_ts, direction, entry_min, entry_max, stop_loss, targets
    HAVING count(DISTINCT strategy_id) > 1
)
SELECT s.strategy_id                                    AS labeled_as,
       split_part(s.engine_setup_id, '-', 1)            AS generated_by,
       s.strategy_version,
       s.symbol,
       s.timeframe,
       s.signal_candle_ts,
       s.direction,
       s.status,
       s.entry_min,
       s.entry_max,
       s.stop_loss,
       s.targets,
       s.engine_setup_id,
       left(s.exit_rule, 60)                        AS exit_rule_of_generator,
       s.created_at,
       CASE
         WHEN s.engine_setup_id IS NOT NULL
              AND split_part(s.engine_setup_id, '-', 1) <> s.strategy_id
           THEN 'MISATTRIBUTED (provenance доказан)'
         WHEN c.symbol IS NOT NULL
           THEN 'COLLISION (одинаковые уровни, provenance свой — проверить пересчётом)'
         ELSE 'OK'
       END                                              AS verdict
  FROM signals s
  LEFT JOIN collision c
         ON c.symbol = s.symbol
        AND c.signal_candle_ts = s.signal_candle_ts
        AND c.direction = s.direction
        AND c.entry_min = s.entry_min
        AND c.entry_max = s.entry_max
        AND c.stop_loss = s.stop_loss
        AND c.targets = s.targets
 WHERE (s.engine_setup_id IS NOT NULL
        AND split_part(s.engine_setup_id, '-', 1) <> s.strategy_id)
    OR c.symbol IS NOT NULL
 ORDER BY s.signal_candle_ts DESC, s.symbol, s.strategy_id;

-- ---------------------------------------------------------------------------
-- 4. Целостность цепочки хэшей НЕ затронута
-- ---------------------------------------------------------------------------
-- Подмена авторства — это ошибка orchestration, а не правка задним числом:
-- строки писались обычным append-only путём, цепочка sha256 не рвалась.
-- Это стоит подтвердить отдельным запросом, чтобы не смешивать два инцидента.
-- Проверка порядка: у каждой строки previous_hash обязан быть хэшем
-- предыдущей по created_at/id строки.
-- ---------------------------------------------------------------------------

\echo ''
\echo '=================================================================='
\echo '4. Цепочка append-only: разрывы previous_hash (должно быть 0)'
\echo '=================================================================='

WITH ordered AS (
    SELECT id, hash, previous_hash, created_at,
           lag(hash) OVER (ORDER BY created_at, id) AS prev_expected
      FROM signals
)
SELECT count(*) FILTER (
         WHERE previous_hash <> coalesce(prev_expected, 'GENESIS')
       ) AS chain_breaks,
       count(*) AS rows_checked
  FROM ordered;

-- ---------------------------------------------------------------------------
-- 5. Что НЕ делать дальше
-- ---------------------------------------------------------------------------
--  • НЕ DELETE и НЕ UPDATE этих строк: это доказательство инцидента.
--  • НЕ пересчитывать hash / outcome_hash: цепочка не рвалась (раздел 4).
--  • Исправление — в коде (strategyEngine.js). После деплоя фикса новые
--    строки будут корректными; судьба уже записанных решается политикой
--    (варианты A/B/C в docs/SIGNALS.md, раздел «Инцидент 2026-09-24»).
-- ============================================================================
