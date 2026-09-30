-- ============================================================================
-- 015: Strategy test runs — «Начать новый тестовый период»
-- ============================================================================
-- Purpose
-- -------
-- Административный механизм обнуления СТАТИСТИКИ выбранной стратегии без
-- удаления старых сигналов. Владелец хочет проверять стратегии периодами:
-- «начали тест V3.4 с нуля → смотрим только сигналы этого периода». Существующие
-- ~180 исторических сигналов при этом остаются на месте и доступны через
-- фильтр «Все данные».
--
-- Модель:
--   strategy_test_runs — период тестирования одной стратегии;
--   signals.test_run_id — членство сигнала в периоде, назначается СЕРВЕРОМ
--   в момент INSERT сигнала (единственный способ получить членство).
--
-- Deliberate constraints
-- ----------------------
-- 1. ОДИН АКТИВНЫЙ ПЕРИОД НА СТРАТЕГИЮ — НЕ ТОЛЬКО В КОДЕ. Partial unique
--    index `uq_strategy_test_runs_one_active` запрещает два ACTIVE-периода
--    одной стратегии на уровне PostgreSQL (гонки, ручной SQL, баги API).
--    Разные стратегии (V3.0 и V3.4) имеют НЕЗАВИСИМЫЕ активные периоды —
--    индекс партиционален по strategy_id.
-- 2. ЧЛЕНСТВО НЕИЗМЕНЯЕМО. `signals.test_run_id` проставляется один раз при
--    INSERT и никогда не обновляется: сигнал, созданный в Run 1, остаётся в
--    Run 1, даже если его TP/SL наступил во время Run 2. Исход при этом
--    считается в статистику Run 1. FK без ON DELETE SET NULL: удалить период,
--    на который ссылаются сигналы, нельзя — «тихое расченство» членства
--    запрещено так же, как и UPDATE.
-- 3. ЧЛЕНСТВО НЕОБЯЗАТЕЛЬНО. Колонка NULLable: сигнал, созданный без
--    активного периода (или до их появления), пишется штатно с
--    test_run_id = NULL. Test Runs не являются precondition работы сигналов.
-- 4. НИ ОДНОЙ СТРОКИ ДАННЫХ ЭТА МИГРАЦИЯ НЕ ТРОГАЕТ. Нет UPDATE сигналов
--    (никакого backfill выдуманным Run ID), нет DELETE, нет изменений
--    strategy_settings. Включённость стратегий (V3.4 = FALSE) не меняется:
--    тестовый период не управляет переключателем стратегии.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
-- ---------------------------------
--   • не включает V3.4 (и вообще не трогает strategy_settings);
--   • не удаляет и не пересчитывает исторические сигналы;
--   • не выполнялась на production: доставка файла — вся поставка, прогон —
--     отдельное осознанное действие оператора (`npm run migrate`).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
-- Migrations 001-014 are NOT modified.
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_test_runs (
    -- Идентичность периода в БД — UUID. Пользователю показывается человекочитаемая
    -- подпись («Run от 30.09.2026 14:30»), UUID наружу не обязателен.
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Стратегия периода. НЕ внешний ключ на strategy_settings: состав стратегий
    -- фиксирован кодом (strategyCatalog) и зеркалируется CHECK-ограничением —
    -- тот же приём, что в миграции 006/014. Произвольная стратегия через API
    -- создана быть не может.
    strategy_id      TEXT        NOT NULL,

    -- Версия стратегии на момент старта периода — презентационные метаданные
    -- каталога ('3.0' / '3.3' / '2.8' / '3.4'). Identity периода — ТОЛЬКО
    -- strategy_id: версия в этом проекте жёстко привязана к id и не является
    -- отдельной осью происхождения, поэтому колонка NULLable и информационная.
    strategy_version TEXT        NULL,

    -- Границы периода. started_at = now() транзакции создания.
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ NULL,

    -- ACTIVE — период идёт, новые сигналы стратегии приписываются ему.
    -- COMPLETED — период завершён; его сигналы остаются его членами навсегда.
    status           TEXT        NOT NULL DEFAULT 'ACTIVE'
        CONSTRAINT strategy_test_runs_status
            CHECK (status IN ('ACTIVE', 'COMPLETED')),

    -- Кто начал период. NULL — системный/скриптовый старт.
    created_by       UUID        NULL
        REFERENCES users (id) ON DELETE SET NULL,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Тот же закрытый список, что в strategy_settings (миграции 006 и 014).
    CONSTRAINT strategy_test_runs_known_strategy
        CHECK (strategy_id IN (
            'V3_0_HTF_LIQUIDATION_TRAP',
            'V3_3_HTF_ZONE_MITIGATION',
            'V2_8_ZERO_FEE_SNIPER_TRAILING',
            'V3_4_HTF_ZONE_MITIGATION_QUALITY'
        ))
);

COMMENT ON TABLE strategy_test_runs IS
    'Тестовые периоды стратегий: «начать новый тестовый период» завершает предыдущий ACTIVE и создаёт новый. Членство сигнала определяется signals.test_run_id, назначается сервером при INSERT и неизменяемо.';

-- ── Один ACTIVE-период на стратегию (партициональный уникальный индекс) ────
-- Не UNIQUE(strategy_id, status): он запрещал бы ДВА COMPLETED-периода у одной
-- стратегии, т.е. историю периодов. Партициональный индекс запрещает ровно
-- одно — два ОДНОВРЕМЕННО ACTIVE периода одной стратегии.
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_test_runs_one_active
    ON strategy_test_runs (strategy_id)
    WHERE status = 'ACTIVE';

-- История периодов стратегии: Admin UI и фильтр статистики.
CREATE INDEX IF NOT EXISTS idx_strategy_test_runs_strategy_started
    ON strategy_test_runs (strategy_id, started_at DESC);

-- ── Членство сигналов ───────────────────────────────────────────────────────
-- NULLable сознательно: исторические сигналы (до периодов) и сигналы,
-- созданные без активного периода, остаются NULL. Backfill НЕ выполняется.
-- FK БЕЗ ON DELETE: период нельзя удалить, пока на него ссылается хоть один
-- сигнал — членство неизменяемо, «тихое расченство» запрещено на уровне БД.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS test_run_id UUID
    REFERENCES strategy_test_runs (id);

-- Статистика периода: WHERE test_run_id = $1 (authoritative membership),
-- а НЕ created_at >= started_at.
CREATE INDEX IF NOT EXISTS idx_signals_test_run_id
    ON signals (test_run_id);

COMMENT ON COLUMN signals.test_run_id IS
    'Членство в тестовом периоде (миграция 015). Назначается сервером в момент INSERT сигнала из ACTIVE-периода стратегии и НЕ изменяется после: сигнал навсегда остаётся членом периода, в котором был создан. NULL — сигнал создан вне периода (вся история до 015).';
