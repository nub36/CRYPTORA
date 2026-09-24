-- ============================================================================
-- 009: Signal levels & lifecycle — ничего из рассчитанного стратегией не теряется
-- ============================================================================
-- Purpose
-- -------
-- Миграция 007 создала `signals` с двумя целями (`tp1`, `tp2`) и доменом статуса
-- из четырёх значений. Ядро стратегий при этом считает и возвращает БОЛЬШЕ:
--
--   • лестницу целей произвольной длины (`ReplayRecord.targets: number[]`,
--     у V2.8 — `executableLadder`), из которой в БД попадали только первые два
--     уровня, а третий и последующие молча терялись;
--   • эффективные уровни ПОСЛЕ исполнения (`ReplayFill.stop`, `ReplayFill.targets`):
--     V2.8 входит по OPEN следующего бара и сдвигает стоп/цели на дельту
--     исполнения — без этих полей график показал бы уровни, которых у сделки
--     уже нет;
--   • факты жизненного цикла (`fill`, `outcome`: status, exitReason, exitPrice,
--     grossR, netR, pnlPct, barsHeld), которые движок определяет сам по закрытым
--     свечам;
--   • контекст, без которого сигнал нельзя однозначно показать человеку
--     (`strategyVersion`, `entryType`, `validForBars`, `exitRule`).
--
-- Отдельно: домен `status` в 007 (ACTIVE|INVALIDATED|TARGET_REACHED|EXPIRED) не
-- покрывал состояния, которые система УЖЕ умеет определять
-- (`SetupStatus` в src/services/signals/SignalsAuditLedger.ts): FILLED, CLOSED,
-- CANCELLED, UNRESOLVED. Из-за этого любой исход, кроме трёх, невозможно было
-- сохранить, не нарушив CHECK.
--
-- Deliberate constraints
-- ----------------------
-- 1. ТОЛЬКО ДОБАВЛЕНИЕ. Миграции 001–008 не переписываются и не правятся: ни
--    одна колонка не удаляется, ни один тип не сужается, `tp1`/`tp2` остаются
--    (их читают существующий API-контракт и цепочка хэшей v1).
-- 2. ОБРАТНАЯ СОВМЕСТИМОСТЬ. Все новые колонки допускают NULL или имеют
--    DEFAULT ⇒ существующие строки остаются валидными, перезапись таблицы не
--    выполняется (PG 11+ для ADD COLUMN ... DEFAULT и для NOT NULL DEFAULT).
-- 3. РАСШИРЕНИЕ CHECK — двухшаговое (`NOT VALID` + `VALIDATE CONSTRAINT`), чтобы
--    не держать длительный ACCESS EXCLUSIVE на растущей таблице. Новый домен
--    является НАДМНОЖЕСТВОМ старого, поэтому валидация существующих строк
--    проходит по построению.
-- 4. НИКАКОЙ НОВОЙ ТОРГОВОЙ МЕХАНИКИ. Колонки исполнения/исхода хранят то, что
--    frozen-ядро уже посчитало по закрытым свечам (детерминированный реплей
--    архивного раннера). Никаких ордеров, позиций, ключей и автоисполнения:
--    RULES §5 и DONT_DO #9 не затрагиваются.
-- 5. ЦЕЛОСТНОСТЬ. `chain_version` разделяет две формы хэша:
--      1 — строки до 009 (payload включает `status`, как в 007);
--      2 — строки после 009: `hash`/`previous_hash` считаются ТОЛЬКО по
--          неизменяемой части (issuance), а изменяемый исход хэшируется
--          отдельно в `outcome_hash`. Это ровно та модель, которую уже использует
--          клиентский журнал (`auditHash` = sha256(issuance + prevHash),
--          `outcomeHash` = sha256(outcome)) и которую 007 обещал в комментарии,
--          но не реализовал: иначе любой переход статуса ломал бы цепочку.
-- 6. ИНДЕКСЫ — один новый, обоснован ниже. `CREATE INDEX CONCURRENTLY` здесь
--    НЕВОЗМОЖЕН: runner (`scripts/migrate.mjs`) выполняет файл внутри
--    BEGIN/COMMIT. Таблица `signals` на production пуста (проверено аудитом
--    2026-09-23: `GET /api/signals` → 0 строк), поэтому обычная сборка индекса
--    мгновенна. Если таблица к моменту применения успеет вырасти до миллионов
--    строк — применить индекс вручную с CONCURRENTLY ДО `npm run migrate`.
-- ============================================================================

-- ── 1. Домен статуса: состояние сетапа + исход сделки ───────────────────────
-- Разделение сознательное и совпадает с ядром:
--   A) состояние сетапа:  ACTIVE (ожидает входа) → FILLED (в позиции);
--   B) исход:             TARGET_REACHED | INVALIDATED | CLOSED  (сделка была)
--                         EXPIRED | CANCELLED | UNRESOLVED       (сделки не было
--                                                                 или исход
--                                                                 не определить).
-- `TRADE_CLOSED` = TARGET_REACHED + INVALIDATED + CLOSED — те, у которых есть R.
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_status_check;

ALTER TABLE signals ADD CONSTRAINT signals_status_check CHECK (
    status IN (
        'ACTIVE',          -- опубликован, ждёт исполнения коридора
        'FILLED',          -- исполнен, позиция отслеживается
        'TARGET_REACHED',  -- финальная цель достигнута
        'INVALIDATED',     -- первоначальный стоп без TP1
        'CLOSED',          -- выход по иным правилам стратегии (TP1→BE, трейлинг, таймаут)
        'EXPIRED',         -- коридор истёк — сделки не было
        'CANCELLED',       -- коридор отменён (стоп задет до исполнения / геометрия)
        'UNRESOLVED'       -- бар сетапа вышел за окно данных — исход не определить
    )
) NOT VALID;

ALTER TABLE signals VALIDATE CONSTRAINT signals_status_check;

-- ── 2. Неизменяемая часть публикации (issuance) ─────────────────────────────
ALTER TABLE signals ADD COLUMN IF NOT EXISTS strategy_version TEXT NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS engine_setup_id  TEXT NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS entry_type       TEXT NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS valid_for_bars   INTEGER NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS exit_rule        TEXT NULL;

-- Каноническая лестница целей: TP1 = targets[1], TP2 = targets[2], TP3 = targets[3], …
-- NUMERIC[] (а не JSON), чтобы сохранить требование 007 «цена — не приближение»:
-- NUMERIC не даёт артефактов двоичного float при сравнении уровней.
-- NULL = строка записана до 009; новый код пишет лестницу всегда.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS targets          NUMERIC[] NULL;

-- Каким payload'ом посчитан `hash` этой строки. 1 = форма 007, 2 = форма 009.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS chain_version    SMALLINT NOT NULL DEFAULT 1;

-- entry_type — домен ядра (ReplayEntryType), а не свободный текст.
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_entry_type_check;
ALTER TABLE signals ADD CONSTRAINT signals_entry_type_check CHECK (
    entry_type IS NULL OR entry_type IN ('LIMIT_CORRIDOR', 'MARKET_NEXT_OPEN')
) NOT VALID;
ALTER TABLE signals VALIDATE CONSTRAINT signals_entry_type_check;

-- ── 3. Исполнение и исход (то, что ядро уже посчитало) ──────────────────────
ALTER TABLE signals ADD COLUMN IF NOT EXISTS fill_price       NUMERIC NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS filled_at        TIMESTAMPTZ NULL;
-- Эффективные уровни ПОСЛЕ исполнения (V2.8 сдвигает стоп и цели на дельту
-- исполнения). NULL = сдвига не было, действуют уровни публикации.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS fill_stop        NUMERIC NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS fill_targets     NUMERIC[] NULL;
-- R: gross (без комиссий) и net (модель 2/5 bps: maker вход / taker выход).
-- Формулы живут в frozen-ядре; здесь они только хранятся.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS result_r         NUMERIC NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS net_result_r     NUMERIC NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS pnl_result_pct   NUMERIC NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS bars_held        INTEGER NULL;
-- Хэш изменяемой части (status + fill + outcome). Пересчитывается при каждом
-- переходе; `hash`/`previous_hash` при этом НЕ меняются — цепочка публикации
-- остаётся неизменяемой.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS outcome_hash     TEXT NULL;

-- Новые строки хэшируются по форме 009. Существующие остаются chain_version = 1:
-- DEFAULT не применяется ретроспективно, поэтому старые цепочки продолжают
-- проверяться своей формой payload'а.
ALTER TABLE signals ALTER COLUMN chain_version SET DEFAULT 2;

-- ── 4. Индекс ───────────────────────────────────────────────────────────────
-- Горячий путь будущего Signals UI: «выбранный инструмент + ограниченная лента
-- последних сигналов, обычно с фильтром по состоянию (открытые/закрытые)».
-- Существующий idx_signals_symbol (symbol, created_at DESC) не покрывает status,
-- поэтому фильтр по состоянию требовал бы сортировки с отбрасыванием строк.
-- Существующие индексы НЕ дублируются:
--   • поиск строки для синхронизации исхода идёт по UNIQUE
--     (strategy_id, symbol, timeframe, signal_candle_ts) из 007 — индекс есть;
--   • лента «все сигналы, новые сверху» — idx_signals_created_at_desc из 007;
--   • счётчик активных по стратегии — idx_signals_strategy_status из 007.
CREATE INDEX IF NOT EXISTS idx_signals_symbol_status_created
    ON signals (symbol, status, created_at DESC);

-- ── 5. Пояснения в самой БД ─────────────────────────────────────────────────
COMMENT ON COLUMN signals.targets IS
    'Каноническая лестница целей TP1..TPn в NUMERIC. tp1/tp2 = targets[1]/targets[2] (сохранены для совместимости с 007 и с hash-формой v1).';
COMMENT ON COLUMN signals.signal_candle_ts IS
    'setupOpenTime закрытого бара сетапа (openTime в UTC). Часть ключа дедупликации: повторный скан того же бара не создаёт вторую строку.';
COMMENT ON COLUMN signals.chain_version IS
    '1 = hash-форма миграции 007 (payload включает status), 2 = форма 009 (hash только по issuance, исход — в outcome_hash).';
COMMENT ON COLUMN signals.status IS
    'A) состояние сетапа: ACTIVE → FILLED. B) исход: TARGET_REACHED | INVALIDATED | CLOSED (сделка была) или EXPIRED | CANCELLED | UNRESOLVED (сделки не было / исход не определить).';
COMMENT ON COLUMN signals.result_r IS
    'Gross R исхода, посчитанный frozen-ядром по закрытым свечам. NULL = сделки не было или исход ещё не определён. Формула в этом PR не менялась.';
COMMENT ON COLUMN signals.net_result_r IS
    'Net R по модели комиссий 2/5 bps (maker вход / taker выход). V2.8 исследована при нулевых комиссиях, поэтому её net R отрицателен — это свойство стратегии, а не ошибка хранения.';
