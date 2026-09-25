/**
 * serverSignalNotifications — ПРОДАКШН-лента колокольчика на серверных сигналах.
 *
 * Здесь фиксируются четыре требования задачи (инцидент 2026-09-25, RUNE):
 *
 *   1. ИДЕНТИЧНОСТЬ. Один и тот же `SignalDto` даёт страницу (`toSignalUiModels`)
 *      и уведомление колокольчика с ТЕМИ ЖЕ id / символом / стратегией /
 *      направлением / временем / входом / стопом / целями / статусом. Фикстура
 *      одна — дублирующих объектов «для страницы» и «для колокольчика» нет.
 *   2. ЛОКАЛЬНЫЙ ЖУРНАЛ — НЕ СОБЫТИЕ. Сетап из браузерного `SignalsAuditLedger`,
 *      которого нет на сервере, не создаёт продакшн-уведомления (ровно то, что
 *      произошло с RUNE: колокольчик звонил, `GET /api/signals?symbol=RUNE%2FUSDT`
 *      отдавал `count = 0`).
 *   3. ПРОИСХОЖДЕНИЕ. `MISMATCH` / `UNKNOWN` (карантин миграции 011) не
 *      становятся продакшн-сигналами; причина видна в аудите, а не молчит.
 *   4. DEEP-LINK. У уведомления есть серверный id и ссылка
 *      `/signals?symbol=<BASE>&signal=<id>`, которую страница разбирает обратно.
 *
 * Плюс хранение: легаси-ключ `cryptora_signal_notifications_v1` переносится в
 * карантин и больше не читается лентой (старые локальные записи не могут
 * выглядеть серверными фактами).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalDto } from '@/services/strategyOps';
import { toSignalUiModels } from '@/services/signals/ui/signalUiModel';
import {
  ServerSignalNotificationCenter,
  buildServerNotification,
  diffServerSignalsForNotifications,
  isProductionPolicySignal,
  mergeSeenMap,
  notificationTime,
  partitionByProvenance,
  provenanceOfSignal,
  serverSignalHref,
  signalBase,
} from '@/services/signals/serverSignalNotifications';
import {
  LEGACY_SIGNAL_NOTIFICATIONS_QUARANTINE_KEY,
  LEGACY_SIGNAL_NOTIFICATIONS_STORAGE_KEY,
  SERVER_SIGNAL_NOTIFICATIONS_STORAGE_KEY,
  type NotificationStorageLike,
} from '@/services/signals/signalNotificationStorage';
import {
  LocalLedgerSignalNotificationCenter,
  localSignalNotifications,
} from '@/services/signals/signalNotifications';
import { SignalsAuditLedger, type SetupInput } from '@/services/signals/SignalsAuditLedger';

/** Ин-мемори хранилище ровно с контрактом `localStorage`. */
function fakeStorage(seed: Record<string, string> = {}): NotificationStorageLike & { dump: Map<string, string> } {
  const dump = new Map<string, string>(Object.entries(seed));
  return {
    dump,
    getItem: (k) => (dump.has(k) ? (dump.get(k) as string) : null),
    setItem: (k, v) => {
      dump.set(k, v);
    },
    removeItem: (k) => {
      dump.delete(k);
    },
  };
}

/**
 * ЕДИНСТВЕННАЯ фикстура серверного сигнала в этом файле.
 *
 * Значения намеренно «неудобные» (RUNE с ценой ~0.63), чтобы совпадение полей
 * нельзя было получить случайно округлением: колокольчик обязан показать ровно
 * то, что записал сервер.
 */
function serverSignal(overrides: Partial<SignalDto> = {}): SignalDto {
  return {
    id: '6f1b6c2e-8f5b-4c1d-9a2f-51d0a2f3b7c4',
    strategyId: 'V3_3_HTF_ZONE_MITIGATION',
    strategyVersion: '3.3',
    engineSetupId: 'V3_3_HTF_ZONE_MITIGATION-RUNEUSDT-1790121600000',
    symbol: 'RUNE/USDT',
    timeframe: '1h',
    direction: 'LONG',
    signalCandleTs: '2026-09-24T15:00:00.000Z',
    entryType: 'LIMIT_CORRIDOR',
    validForBars: 3,
    exitRule: '4H-зона: TP1 = середина displacement-ноги 4H',
    entryMin: 0.6312,
    entryMax: 0.6418,
    stopLoss: 0.6104,
    targets: [0.6552, 0.6710],
    tp1: 0.6552,
    tp2: 0.671,
    status: 'ACTIVE',
    createdAt: '2026-09-24T15:01:10.361Z',
    updatedAt: '2026-09-24T15:01:10.361Z',
    fillPrice: null,
    filledAt: null,
    fillStop: null,
    fillTargets: null,
    closedAt: null,
    closePrice: null,
    closeReason: null,
    resultR: null,
    netResultR: null,
    pnlResultPct: null,
    barsHeld: null,
    metadata: { engineVersion: 'v3.3', riskRewardRatio: 1.42 },
    hash: 'a'.repeat(64),
    previousHash: 'b'.repeat(64),
    outcomeHash: null,
    chainVersion: 2,
    provenanceStatus: 'VERIFIED',
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  SignalsAuditLedger.resetInstance();
  localSignalNotifications.resetForTests();
});

describe('serverSignalNotifications: идентичность со страницей', () => {
  it('один и тот же SignalDto → страница и колокольчик показывают один сигнал', () => {
    const dto = serverSignal();

    // Страница: та же фикстура, тот же маппинг, что и в SignalsPage.
    const model = toSignalUiModels([dto])[0]!;
    // Колокольчик: та же фикстура.
    const notification = buildServerNotification(dto, 'NEW_SIGNAL');

    expect(notification.signalId).toBe(dto.id);
    expect(notification.signalId).toBe(model.id);
    expect(notification.symbol).toBe(dto.symbol);
    expect(notification.symbol).toBe(model.pair);
    expect(notification.baseSymbol).toBe(model.baseSymbol);
    expect(notification.strategyId).toBe(dto.strategyId);
    expect(notification.strategyId).toBe(model.strategyId);
    expect(notification.direction).toBe(dto.direction);
    expect(notification.direction).toBe(model.direction);
    expect(notification.timeframe).toBe(dto.timeframe);
    expect(notification.timeframe).toBe(model.timeframe);
    expect(notification.status).toBe(dto.status);
    expect(notification.status).toBe(model.status);
    expect(notification.signalCandleTs).toBe(dto.signalCandleTs);
    expect(notification.signalCandleTs).toBe(model.signalCandleTs);
    expect(notification.entryMin).toBe(dto.entryMin);
    expect(notification.entryMax).toBe(dto.entryMax);
    expect(notification.stopLoss).toBe(dto.stopLoss);
    expect(notification.targets).toEqual(dto.targets);
    // Уровни страницы — те же числа, что в DTO (ничего не пересчитано).
    expect(model.levels.map((l) => l.price)).toContain(dto.entryMin);
    expect(model.levels.map((l) => l.price)).toContain(dto.stopLoss);
    for (const target of dto.targets ?? []) {
      expect(model.targets.map((t) => t.price)).toContain(target);
    }
    // Время события — из DTO, не «сейчас».
    expect(notification.at).toBe(dto.createdAt);
  });

  it('время события для входа и исхода берётся из полей сервера', () => {
    const filled = serverSignal({
      status: 'FILLED',
      fillPrice: 0.6312,
      filledAt: '2026-09-24T16:02:00.000Z',
    });
    const closed = serverSignal({
      status: 'TARGET_REACHED',
      closedAt: '2026-09-25T03:00:00.000Z',
      closeReason: 'TP1_HIT',
      resultR: 1.4,
      netResultR: 1.32,
    });
    expect(notificationTime(filled, 'FILL')).toBe('2026-09-24T16:02:00.000Z');
    expect(notificationTime(closed, 'OUTCOME')).toBe('2026-09-25T03:00:00.000Z');
  });

  it('ссылка ведёт на символ и серверный id, а не «в журнал вообще»', () => {
    const dto = serverSignal();
    const notification = buildServerNotification(dto, 'NEW_SIGNAL');
    expect(notification.href).toBe(`/signals?symbol=RUNE&signal=${dto.id}`);
    expect(serverSignalHref('RUNE/USDT', dto.id)).toBe(notification.href);
    expect(signalBase('RUNE/USDT')).toBe('RUNE');
    expect(signalBase('runeusdt')).toBe('RUNE');
  });
});

describe('serverSignalNotifications: политика происхождения (карантин 011)', () => {
  it('VERIFIED допускается, MISMATCH и UNKNOWN — нет, и считаются в аудите', () => {
    const verified = serverSignal();
    const mismatch = serverSignal({ id: 'id-mismatch', engineSetupId: 'V3_0_HTF_LIQUIDATION_TRAP-RUNEUSDT-1', provenanceStatus: 'MISMATCH' });
    const unknown = serverSignal({ id: 'id-unknown', provenanceStatus: 'UNKNOWN' });

    expect(isProductionPolicySignal(verified)).toBe(true);
    expect(isProductionPolicySignal(mismatch)).toBe(false);
    expect(isProductionPolicySignal(unknown)).toBe(false);

    const partition = partitionByProvenance([verified, mismatch, unknown]);
    expect(partition.eligible.map((s) => s.id)).toEqual([verified.id]);
    expect(partition.excludedMismatch).toBe(1);
    expect(partition.excludedUnknown).toBe(1);

    const fresh = diffServerSignalsForNotifications(new Map(), [verified, mismatch, unknown]);
    expect(fresh.map((n) => n.signalId)).toEqual([verified.id]);
  });

  it('отсутствующий provenanceStatus читается как UNKNOWN (fail-closed)', () => {
    const dto = serverSignal();
    const withoutField = { ...dto } as Partial<SignalDto>;
    delete withoutField.provenanceStatus;
    expect(provenanceOfSignal(withoutField as SignalDto)).toBe('UNKNOWN');
    expect(isProductionPolicySignal(withoutField as SignalDto)).toBe(false);
  });

  it('центр не показывает карантинные строки, но сообщает их число в аудите', () => {
    const center = new ServerSignalNotificationCenter();
    center.start(null);
    const mismatch = serverSignal({ id: 'id-mismatch', provenanceStatus: 'MISMATCH' });
    const unknown = serverSignal({ id: 'id-unknown', provenanceStatus: 'UNKNOWN' });

    center.ingest([mismatch, unknown]);
    center.ingest([mismatch, unknown]);

    expect(center.getNotifications()).toEqual([]);
    const audit = center.getAudit();
    expect(audit.excludedMismatch).toBe(1);
    expect(audit.excludedUnknown).toBe(1);
    expect(audit.eligible).toBe(0);
  });
});

describe('serverSignalNotifications: только новые события', () => {
  it('первая синхронизация не звонит по уже существующим сигналам', () => {
    const center = new ServerSignalNotificationCenter();
    center.start(null);

    expect(center.ingest([serverSignal()])).toEqual([]);
    expect(center.getNotifications()).toEqual([]);
    // Повторная синхронизация без изменений — тишина.
    expect(center.ingest([serverSignal()])).toEqual([]);
    expect(center.getNotifications()).toEqual([]);
  });

  it('ACTIVE → FILLED даёт «ВХОД ИСПОЛНЕН», закрытие — «ИСХОД», дублей нет', () => {
    const center = new ServerSignalNotificationCenter();
    center.start(null);
    // База: два существующих сигнала (событий по ним не будет).
    center.ingest([serverSignal(), serverSignal({ id: 'other-id', status: 'ACTIVE' })]);

    const filled = serverSignal({
      status: 'FILLED',
      fillPrice: 0.6312,
      filledAt: '2026-09-24T16:02:00.000Z',
    });
    const fillEvents = center.ingest([filled, serverSignal({ id: 'other-id', status: 'ACTIVE' })]);
    expect(fillEvents).toHaveLength(1);
    expect(fillEvents[0]!.kind).toBe('FILL');
    expect(fillEvents[0]!.signalId).toBe(filled.id);
    expect(fillEvents[0]!.detail).toContain('0,6312');

    // Повтор той же страницы не создаёт второго события.
    expect(center.ingest([filled])).toEqual([]);

    const closed = serverSignal({
      status: 'TARGET_REACHED',
      fillPrice: 0.6312,
      filledAt: '2026-09-24T16:02:00.000Z',
      closedAt: '2026-09-25T03:00:00.000Z',
      closeReason: 'TP1_HIT',
      resultR: 1.4,
      netResultR: 1.32,
      barsHeld: 11,
    });
    const outcomeEvents = center.ingest([closed]);
    expect(outcomeEvents).toHaveLength(1);
    expect(outcomeEvents[0]!.kind).toBe('OUTCOME');
    expect(center.getNotifications().map((n) => n.id)).toEqual([
      `srv-${filled.id}-FILL`,
      `srv-${closed.id}-OUTCOME`,
    ]);
  });

  it('clear() не превращает существующие сигналы в новые события', () => {
    const center = new ServerSignalNotificationCenter();
    center.start(null);
    center.ingest([serverSignal()]);
    center.ingest([serverSignal({ status: 'FILLED', fillPrice: 0.6312, filledAt: '2026-09-24T16:02:00.000Z' })]);
    expect(center.getNotifications()).toHaveLength(1);
    center.clear();
    expect(center.getNotifications()).toHaveLength(0);
    expect(center.ingest([serverSignal({ status: 'FILLED', fillPrice: 0.6312 })])).toEqual([]);
  });
});

describe('serverSignalNotifications: хранение переживает перезагрузку', () => {
  it('снапшот статусов из storage даёт событие о переходе при закрытой вкладке', () => {
    const storage = fakeStorage();
    const first = new ServerSignalNotificationCenter();
    first.start(storage);
    first.ingest([serverSignal()]);
    first.ingest([serverSignal({ status: 'FILLED', fillPrice: 0.6312, filledAt: '2026-09-24T16:02:00.000Z' })]);
    const saved = JSON.parse(storage.dump.get(SERVER_SIGNAL_NOTIFICATIONS_STORAGE_KEY)!) as {
      schemaVersion: number;
      source: string;
    };
    expect(saved.schemaVersion).toBe(2);
    expect(saved.source).toBe('server');

    // «Перезагрузка»: новый центр читает тот же ключ.
    const second = new ServerSignalNotificationCenter();
    second.start(storage);
    expect(second.getNotifications()).toHaveLength(1);

    // Пока вкладка была закрыта, сервер довёл сигнал до исхода.
    const events = second.ingest([
      serverSignal({
        status: 'TARGET_REACHED',
        fillPrice: 0.6312,
        filledAt: '2026-09-24T16:02:00.000Z',
        closedAt: '2026-09-25T03:00:00.000Z',
        closeReason: 'TP1_HIT',
        resultR: 1.4,
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('OUTCOME');
  });

  it('ЛЕГАСИ-лента v1 уходит в карантин и не читается продакшн-лентой', () => {
    const legacyItem = {
      id: 'sig-local-rune-NEW_SIGNAL',
      kind: 'NEW_SIGNAL',
      setupId: 'local-rune-setup',
      symbol: 'RUNE/USDT',
      title: 'НОВЫЙ СИГНАЛ',
      detail: 'RUNE/USDT · LONG · V3.3 · вход 0.63–0.64',
      at: '2026-09-24T15:01:10.361Z',
      read: false,
    };
    const storage = fakeStorage({
      [LEGACY_SIGNAL_NOTIFICATIONS_STORAGE_KEY]: JSON.stringify([legacyItem]),
    });

    const center = new ServerSignalNotificationCenter();
    center.start(storage);

    // Легаси-запись НЕ становится серверным уведомлением.
    expect(center.getNotifications()).toEqual([]);
    expect(center.getAudit().quarantinedLegacy).toBe(1);
    expect(storage.getItem(LEGACY_SIGNAL_NOTIFICATIONS_STORAGE_KEY)).toBeNull();

    const quarantine = JSON.parse(storage.getItem(LEGACY_SIGNAL_NOTIFICATIONS_QUARANTINE_KEY)!) as {
      source: string;
      items: unknown[];
    };
    expect(quarantine.source).toBe('local-ledger-legacy');
    expect(quarantine.items).toHaveLength(1);

    // Идемпотентность: повторный старт ничего не теряет и не дублирует.
    const again = new ServerSignalNotificationCenter();
    again.start(storage);
    expect(again.getAudit().quarantinedLegacy).toBe(0);
    const requarantined = JSON.parse(storage.getItem(LEGACY_SIGNAL_NOTIFICATIONS_QUARANTINE_KEY)!) as {
      items: unknown[];
    };
    expect(requarantined.items).toHaveLength(1);
  });

  it('конверт чужой версии не разбирается «на удачу»', () => {
    const storage = fakeStorage({
      [SERVER_SIGNAL_NOTIFICATIONS_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        source: 'local-ledger',
        savedAt: '2026-09-24T00:00:00.000Z',
        items: [{ id: 'srv-x-NEW_SIGNAL', kind: 'NEW_SIGNAL', signalId: 'x' }],
      }),
    });
    const center = new ServerSignalNotificationCenter();
    center.start(storage);
    expect(center.getNotifications()).toEqual([]);
    expect(center.isBaselineReady()).toBe(false);
  });
});

describe('serverSignalNotifications: браузерный журнал не создаёт продакшн-событие', () => {
  it('сетап из SignalsAuditLedger, которого нет на сервере, не звонит в продакшн-ленте', () => {
    const setup: SetupInput = {
      id: 'local-rune-setup',
      strategyId: 'V3_3_HTF_ZONE_MITIGATION',
      strategyVersion: '3.3',
      symbol: 'RUNE/USDT',
      direction: 'LONG',
      timeframe: '1h',
      setupOpenTime: Date.parse('2026-09-24T15:00:00.000Z'),
      entryType: 'LIMIT_CORRIDOR',
      entryZone: [0.6312, 0.6418],
      invalidationLevel: 0.6104,
      targets: [0.6552, 0.671],
      riskRewardRatio: 1.42,
      confirmingFactors: [],
      invalidationFactors: [],
      exitRule: '4H-зона',
      validForBars: 3,
      createdAt: '2026-09-24T15:01:10.361Z',
      latencyBars: 0,
      status: 'ACTIVE',
    };

    // Локальный журнал наполняется сетапом (как это делал браузерный движок).
    const localCenter = new LocalLedgerSignalNotificationCenter('cryptora_signal_notifications_local_test');
    localCenter.start(fakeStorage());
    const productionCenter = new ServerSignalNotificationCenter();
    productionCenter.start(null);
    // Сервер в этот момент отдаёт пустую ленту — сигнала RUNE в PostgreSQL нет.
    productionCenter.ingest([]);

    SignalsAuditLedger.getInstance().append(setup);
    SignalsAuditLedger.getInstance().markFilled('local-rune-setup', {
      price: 0.632,
      at: '2026-09-24T16:00:00.000Z',
      barOpenTime: Date.parse('2026-09-24T16:00:00.000Z'),
    });

    // Локальная лента событие увидела (журнал жив для локального аудита)…
    expect(localCenter.getNotifications().map((n) => n.kind)).toEqual(['NEW_SIGNAL', 'FILL']);
    // …а продакшн-лента — НЕТ: серверного сигнала не существует.
    expect(productionCenter.getNotifications()).toEqual([]);
    expect(productionCenter.ingest([])).toEqual([]);
    expect(productionCenter.getNotifications()).toEqual([]);
    localCenter.stop();
  });

  it('в локальной ленте у событий есть только setupId — серверного id нет', () => {
    const harness = new LocalLedgerSignalNotificationCenter('cryptora_signal_notifications_local_test');
    const storage = fakeStorage();
    harness.start(storage);
    SignalsAuditLedger.getInstance().append({
      id: 'local-setup-1',
      strategyId: 'V3_0_HTF_LIQUIDATION_TRAP',
      strategyVersion: '3.0',
      symbol: 'RUNE/USDT',
      direction: 'LONG',
      timeframe: '1h',
      setupOpenTime: Date.parse('2026-09-24T15:00:00.000Z'),
      entryType: 'LIMIT_CORRIDOR',
      entryZone: [0.63, 0.64],
      invalidationLevel: 0.61,
      targets: [0.66],
      riskRewardRatio: 1.5,
      confirmingFactors: [],
      invalidationFactors: [],
      exitRule: 'x',
      validForBars: 3,
      createdAt: '2026-09-24T15:01:10.361Z',
      latencyBars: 0,
      status: 'ACTIVE',
    });
    // Первая подписка запоминает снапшот, поэтому событие создаётся вторым
    // изменением статуса — как и раньше в браузерной ленте.
    SignalsAuditLedger.getInstance().markFilled('local-setup-1', {
      price: 0.632,
      at: '2026-09-24T16:00:00.000Z',
      barOpenTime: Date.parse('2026-09-24T16:00:00.000Z'),
    });
    const items = harness.getNotifications();
    // Локальная лента, как и раньше: публикация и исполнение — два события.
    expect(items.map((n) => n.kind)).toEqual(['NEW_SIGNAL', 'FILL']);
    for (const item of items) {
      expect(item.source).toBe('local-ledger');
      expect(item.setupId).toBe('local-setup-1');
      // Серверного id у локальных событий нет — deep-link по ним невозможен.
      expect('signalId' in item).toBe(false);
    }
    harness.stop();
  });
});

describe('serverSignalNotifications: снапшот статусов', () => {
  it('сигнал, ушедший со страницы, не «звонит» повторно при возврате', () => {
    const first = serverSignal();
    const seen = mergeSeenMap({}, [first]);
    const pruned = mergeSeenMap(seen, [serverSignal({ id: 'other-id', status: 'ACTIVE' })]);
    expect(pruned[first.id]?.status).toBe('ACTIVE');
  });

  it('снапшот ограничен по размеру', () => {
    const signals: SignalDto[] = Array.from({ length: 20 }, (_, i) =>
      serverSignal({ id: `id-${i}` })
    );
    const seen = mergeSeenMap({}, signals, 5);
    expect(Object.keys(seen)).toHaveLength(5);
    expect(Object.keys(seen)).toEqual(['id-15', 'id-16', 'id-17', 'id-18', 'id-19']);
  });
});
