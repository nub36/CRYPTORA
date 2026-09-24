/**
 * CRYPTORA — Планировщик серверного движка.
 *
 * Проверяется НАСТОЯЩИЙ `StrategyScheduler` из
 * server/services/strategyEngine/strategyScheduler.js — не его копия.
 * Зависимости (чтение настроек и скан) инжектируются, чтобы утверждения были
 * про поведение планировщика, а не про сеть или БД.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  StrategyScheduler,
  type StrategySettingsRow,
} from '../../server/services/strategyEngine/strategyScheduler.js';

/** Строка в том виде, в каком её отдаёт getEnabledStrategies() (mapRow). */
const row = (strategyId: string, extra: Record<string, unknown> = {}) => ({
  strategyId,
  enabled: true,
  scanIntervalSeconds: 60,
  symbols: null,
  lastScanAt: null,
  lastSignalAt: null,
  lastError: null,
  updatedAt: null,
  updatedBy: null,
  ...extra,
});

describe('StrategyScheduler — включено/выключено', () => {
  it('выключенных стратегий в списке нет ⇒ evaluate не вызывается ни разу', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    // PostgreSQL вернул пустой список: все три стратегии выключены.
    const getEnabled = vi.fn().mockResolvedValue([]);
    const s = new StrategyScheduler({ getEnabled, scan, now: () => 1_000_000 });

    await s.tick();

    expect(scan).not.toHaveBeenCalled();
  });

  it('включённая стратегия ⇒ evaluate вызывается с её id', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    const getEnabled = vi.fn().mockResolvedValue([row('V3_3_HTF_ZONE_MITIGATION')]);
    const s = new StrategyScheduler({ getEnabled, scan, now: () => 1_000_000 });

    const res = await s.tick();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: 'V3_3_HTF_ZONE_MITIGATION' })
    );
    expect(res.launched).toEqual(['V3_3_HTF_ZONE_MITIGATION']);
  });

  it('переключение без перезапуска: настройки перечитываются КАЖДЫЙ цикл', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    let enabledRows: StrategySettingsRow[] = [];
    const getEnabled = vi.fn(async () => enabledRows);
    let t = 0;
    const s = new StrategyScheduler({ getEnabled, scan, now: () => t });

    await s.tick();
    expect(scan).not.toHaveBeenCalled();

    // Админ включил стратегию — перезапуска процесса не было.
    enabledRows = [row('V3_0_HTF_LIQUIDATION_TRAP')];
    t += 61_000;
    await s.tick();

    expect(getEnabled).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: 'V3_0_HTF_LIQUIDATION_TRAP' })
    );
  });

  it('интервал из strategy_settings соблюдается', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    const getEnabled = vi.fn().mockResolvedValue([
      row('V3_3_HTF_ZONE_MITIGATION', { scanIntervalSeconds: 60 }),
    ]);
    let t = 0;
    const s = new StrategyScheduler({ getEnabled, scan, now: () => t });

    await s.tick();
    expect(scan).toHaveBeenCalledTimes(1);

    t += 30_000; // 30 c < 60 c
    await s.tick();
    expect(scan).toHaveBeenCalledTimes(1);

    t += 31_000; // 61 c > 60 c
    await s.tick();
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

describe('StrategyScheduler — отсутствие наложений', () => {
  it('пока скан идёт, второй для той же стратегии не запускается', async () => {
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => {
      release = r;
    });
    const scan = vi.fn().mockReturnValue(gate);
    const getEnabled = vi.fn().mockResolvedValue([row('V3_3_HTF_ZONE_MITIGATION')]);
    const s = new StrategyScheduler({ getEnabled, scan, now: () => 1_000_000 });

    const first = s.tick();
    await first;
    expect(s.isInFlight('V3_3_HTF_ZONE_MITIGATION')).toBe(true);

    await s.tick();
    await s.tick();
    expect(scan).toHaveBeenCalledTimes(1);

    release({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(s.isInFlight('V3_3_HTF_ZONE_MITIGATION')).toBe(false);
  });

  it('замок освобождается даже если скан выбросил исключение', async () => {
    const scan = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true });
    const getEnabled = vi.fn().mockResolvedValue([row('V3_3_HTF_ZONE_MITIGATION')]);
    const s = new StrategyScheduler({ getEnabled, scan, now: () => 1_000_000 });

    await s.tick();
    await new Promise((r) => setTimeout(r, 0));

    expect(s.isInFlight('V3_3_HTF_ZONE_MITIGATION')).toBe(false);
    expect(s.stats.errors.length).toBeGreaterThan(0);
  });

  it('разные стратегии сканируются параллельно, не блокируя друг друга', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    const getEnabled = vi.fn().mockResolvedValue([
      row('V3_0_HTF_LIQUIDATION_TRAP'),
      row('V3_3_HTF_ZONE_MITIGATION'),
      row('V2_8_ZERO_FEE_SNIPER_TRAILING'),
    ]);
    const s = new StrategyScheduler({ getEnabled, scan, now: () => 1_000_000 });

    const res = await s.tick();

    expect(res.launched).toHaveLength(3);
    expect(scan).toHaveBeenCalledTimes(3);
  });
});

describe('StrategyScheduler — жизненный цикл', () => {
  let s: any;
  afterEach(async () => {
    if (s) await s.stop();
  });

  it('до start() планировщик не сканирует сам', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    s = new StrategyScheduler({
      getEnabled: async () => [row('V3_3_HTF_ZONE_MITIGATION')],
      scan,
      tickMs: 15,
      now: () => 1_000_000,
    });
    expect(s.isRunning()).toBe(false);
    await new Promise((r) => setTimeout(r, 70));
    expect(s.stats.cycles).toBe(0);
    expect(scan).not.toHaveBeenCalled();
  });

  it('start() запускает циклы, stop() их останавливает', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    const getEnabled = vi.fn().mockResolvedValue([row('V3_3_HTF_ZONE_MITIGATION')]);
    s = new StrategyScheduler({ getEnabled, scan, tickMs: 20, now: () => Date.now() });

    s.start();
    expect(s.isRunning()).toBe(true);
    await new Promise((r) => setTimeout(r, 90));
    const cyclesAfterStart = s.stats.cycles;
    expect(cyclesAfterStart).toBeGreaterThan(0);

    await s.stop();
    expect(s.isRunning()).toBe(false);
    const frozen = s.stats.cycles;
    await new Promise((r) => setTimeout(r, 90));
    expect(s.stats.cycles).toBe(frozen);
  });

  it('stop() дожидается текущего скана (не обрывает запись сигнала)', async () => {
    let finished = false;
    const scan = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      finished = true;
      return { ok: true };
    });
    s = new StrategyScheduler({ getEnabled: async () => [row('V3_3_HTF_ZONE_MITIGATION')], scan });
    s.start();
    await new Promise((r) => setTimeout(r, 5));
    await s.stop();
    expect(finished).toBe(true);
  });

  it('ошибка чтения настроек не роняет планировщик', async () => {
    const scan = vi.fn().mockResolvedValue({ ok: true });
    const getEnabled = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue([row('V3_3_HTF_ZONE_MITIGATION')]);
    s = new StrategyScheduler({ getEnabled, scan, now: () => 1_000_000 });

    // tick() не выбрасывает наружу — иначе setInterval уронил бы процесс.
    await expect(s.tick()).resolves.toBeDefined();
    // Но ошибка зафиксирована, а не проглочена молча.
    expect(s.stats.errors).toHaveLength(1);
    expect(s.stats.errors[0].message).toContain('db down');
    // Следующий цикл работает: сбой БД не останавливает планировщик навсегда.
    await s.tick();
    expect(scan).toHaveBeenCalled();
  });
});
