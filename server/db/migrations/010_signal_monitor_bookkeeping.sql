-- ============================================================================
-- 010: Server-side signal monitor bookkeeping
-- ============================================================================
-- Purpose
-- -------
-- PR #16 перенёс жизненный цикл сигнала из ретроспективы окна закрытых свечей,
-- которую ядро считает на каждом скане. Это работает, но имеет два свойства,
-- которые не устранить в рамках скана:
--
--   1. Пока бар исхода не закрылся, строка остаётся в ACTIVE/FILLED. Монитор
--      позиций (server/services/signalMonitor/) считает исход теми же
--      frozen-функциями (`trackPublishedSetup`) по ЗАКРЫТЫМ свечам, поэтому
--      «отставание на бар» сохраняется — но теперь его видно: у каждой строки
--      есть момент последней проверки и её результат.
--   2. Сигнал старше окна реплея (≤1000 баров 1h ≈ 41 день) больше не
--      пересчитывается сканом. Монитор обязан честно отличать «ещё не закрыт»
--      от «бар сетапа вышел за окно наблюдения», а не молча оставлять строку
--      в ACTIVE навсегда.
--
-- Deliberate constraints
-- ----------------------
-- 1. ТОЛЬКО ДОБАВЛЕНИЕ. Миграции 001–009 не редактируются: ни одна колонка не
--    удаляется, ни один тип не сужается.
-- 2. ОБРАТНАЯ СОВМЕСТИМОСТЬ. Все новые колонки допускают NULL или имеют
--    DEFAULT ⇒ существующие строки остаются валидными, перезапись таблицы не
--    выполняется. `ADD COLUMN ... NOT NULL DEFAULT` не требует перезаписи в
--    PostgreSQL 11+.
-- 3. НИКАКОЙ НОВОЙ ТОРГОВОЙ МЕХАНИКИ. Здесь нет ни уровней, ни R, ни причин
--    выхода — они остаются в колонках миграции 009 и вычисляются только
--    frozen-ядром. Новые колонки — исключительно журнал наблюдения
--    (observability), чтобы «неизвестно» не выглядело как «забыто».
-- 4. ХЭШИ НЕ МЕНЯЮТСЯ. `hash`/`previous_hash` считаются по форме 009
--    (issuance), `outcome_hash` — по фиксированному набору полей исхода
--    (`outcomePayload`). Новые колонки в payload'ы не входят, поэтому цепочка
--    продолжает проверяться без изменений.
-- 5. НОВАЯ ТАБЛИЦА `signal_monitor_state` — одна строка на «источник правды»
--    мониторинга (singleton процесса). Она нужна, чтобы рестарт бэкенда не
--    терял телеметрию и чтобы UI видел фактическое состояние наблюдения, а не
--    догадывался по наличию открытых строк.
-- ============================================================================

-- ── 1. Журнал наблюдения по строке сигнала ──────────────────────────────────
ALTER TABLE signals ADD COLUMN IF NOT EXISTS monitor_check_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS monitor_last_check_at TIMESTAMPTZ NULL;
-- Результат последней проверки frozen-функцией ведения:
--   UNCHANGED   — по закрытым свечам ничего не изменилось;
--   FILLED      — исполнение зафиксировано, позиция ещё открыта;
--   RESOLVED    — исход определён (статус стал терминальным);
--   SKIP        — проверка невозможна (нет целей/бара сетапа в окне, чужая стратегия);
--   ERROR       — сбой рыночных данных (строка НЕ меняется);
--   OUT_OF_WINDOW — бар сетапа старше окна наблюдения.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS monitor_last_result TEXT NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS monitor_last_error  TEXT NULL;

ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_monitor_result_check;
ALTER TABLE signals ADD CONSTRAINT signals_monitor_result_check CHECK (
    monitor_last_result IS NULL
    OR monitor_last_result IN (
        'UNCHANGED', 'FILLED', 'RESOLVED', 'SKIP', 'ERROR', 'OUT_OF_WINDOW'
    )
) NOT VALID;
ALTER TABLE signals VALIDATE CONSTRAINT signals_monitor_result_check;

COMMENT ON COLUMN signals.monitor_check_count IS
    'Сколько раз серверный монитор позиций проверял этот сигнал по закрытым свечам. Не влияет на уровни, R и цепочку хэшей.';
COMMENT ON COLUMN signals.monitor_last_check_at IS
    'Момент последней проверки монитором (UTC). NULL = монитор ещё не смотрел эту строку.';
COMMENT ON COLUMN signals.monitor_last_result IS
    'Результат последней проверки frozen-функцией ведения: UNCHANGED | FILLED | RESOLVED | SKIP | ERROR | OUT_OF_WINDOW.';
COMMENT ON COLUMN signals.monitor_last_error IS
    'Причина сбоя наблюдения (например, отказ рыночных данных). Строка при этом НЕ изменяется: «нет данных» ≠ «исход есть».';

-- ── 2. Состояние монитора (одна строка на процесс) ──────────────────────────
-- Прогресс/дельты монитора: переживают рестарт процесса, поэтому «стale» и
-- «отставание» наблюдаемы, а не предполагаются.
CREATE TABLE IF NOT EXISTS signal_monitor_state (
    id                       SMALLINT PRIMARY KEY DEFAULT 1,
    running                  BOOLEAN   NOT NULL DEFAULT FALSE,
    last_tick_started_at     TIMESTAMPTZ NULL,
    last_tick_finished_at    TIMESTAMPTZ NULL,
    last_tick_duration_ms    INTEGER   NULL,
    last_error               TEXT      NULL,
    -- Сколько открытых сигналов обработано на последнем тике.
    last_open_signals        INTEGER   NULL,
    -- Сколько групп (символ × таймфрейм) потребовало запроса свечей: это и есть
    -- доказательство отсутствия веера N×candles — групп не больше, чем
    -- различных инструментов среди открытых сигналов.
    last_groups              INTEGER   NULL,
    -- Сколько HTTP-запросов свечей сделал последний тик (общий счётчик фетчера).
    last_candle_requests     INTEGER   NULL,
    last_result              TEXT      NULL,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT signal_monitor_state_singleton CHECK (id = 1)
);

COMMENT ON TABLE signal_monitor_state IS
    'Телеметрия серверного монитора позиций (одна строка, id = 1). Источник правды о том, наблюдается ли сигнал прямо сейчас.';

-- ── 3. Индекс ───────────────────────────────────────────────────────────────
-- Монитору нужен рабочий набор «открытые сигналы, самые свежие сверху» —
-- ровно тот же путь, что у listOpenSignals(). Существующий
-- idx_signals_symbol_status_created (symbol, status, created_at DESC) покрывает
-- символ+статус, но не strategy_id; отдельный индекс для GROUP BY по символу
-- среди открытых строк дешевле и не дублирует существующие.
CREATE INDEX IF NOT EXISTS idx_signals_open_group
    ON signals (symbol, timeframe)
    WHERE status IN ('ACTIVE', 'FILLED');
