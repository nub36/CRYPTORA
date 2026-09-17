import {
  MempoolSpaceAdapter,
  type BtcDifficultyAdjustment,
  type BtcHashrate,
  type BtcMempool,
  type BtcRecommendedFees,
} from '@/services/data/adapters/MempoolSpaceAdapter';

/**
 * Он-чейн (v0.8.31): только фактические метрики сети Bitcoin из mempool.space (публичный API без ключа).
 * Прежний статический набор (MVRV, NUPL, ETH-стейкинг, «биржевые нетфлоу», «сигнал модели») удалён:
 * у терминала нет их источника, а «сигналы» были выдуманными оценками.
 */
export interface OnChainMetric {
  id: string;
  name: string;
  value: string;
  /** Δ, % — только там, где источник даёт ряд (хешрейт 3д); иначе null. */
  change: number | null;
  changeLabel: string | null;
  note: string;
}

export interface OnChainReport {
  source: 'mempool.space';
  fetchedAt: number;
  metrics: OnChainMetric[];
  fees: BtcRecommendedFees;
  difficulty: BtcDifficultyAdjustment;
  mempool: BtcMempool;
  tipHeight: number;
}

const EH = 1e18;

export function formatHashrateEh(hs: number): string {
  return `${(hs / EH).toFixed(0)} EH/s`;
}

/** Δ хешрейта: последняя точка 3д-ряда против первой (≈3 суток). */
export function hashrateChangePct(h: BtcHashrate): number | null {
  const pts = h.hashrates.filter((p) => p.avgHashrate > 0);
  if (pts.length < 2) return null;
  const first = pts[0].avgHashrate;
  const last = pts[pts.length - 1].avgHashrate;
  return Number((((last - first) / first) * 100).toFixed(2));
}

export function buildOnChainReport(
  input: {
    hashrate: BtcHashrate;
    difficulty: BtcDifficultyAdjustment;
    fees: BtcRecommendedFees;
    mempool: BtcMempool;
    tipHeight: number;
  },
  fetchedAt: number,
): OnChainReport {
  const { hashrate, difficulty, fees, mempool, tipHeight } = input;
  const retargetDays = Math.max(0, (difficulty.estimatedRetargetDate - fetchedAt) / 86_400_000);
  const metrics: OnChainMetric[] = [
    {
      id: 'btc-hashrate',
      name: 'Хешрейт сети',
      value: formatHashrateEh(hashrate.currentHashrate),
      change: hashrateChangePct(hashrate),
      changeLabel: '3д',
      note: 'Текущая оценка по ряду mempool.space (окно 3 дня). Хешрейт — расчётная величина из времени блоков и сложности.',
    },
    {
      id: 'btc-difficulty',
      name: 'Сложность',
      value: `${(hashrate.currentDifficulty / 1e12).toFixed(2)} T`,
      change: Number(difficulty.difficultyChange.toFixed(2)),
      changeLabel: 'прогноз ретаргета',
      note: `Эпоха пройдена на ${difficulty.progressPercent.toFixed(1)}%, осталось ${difficulty.remainingBlocks} блоков (~${retargetDays.toFixed(1)} дн.). Прогноз изменения — оценка источника по текущему темпу блоков.`,
    },
    {
      id: 'btc-tip-height',
      name: 'Высота блокчейна',
      value: tipHeight.toLocaleString('ru-RU'),
      change: null,
      changeLabel: null,
      note: 'Последний подтверждённый блок по данным узла mempool.space.',
    },
    {
      id: 'btc-mempool',
      name: 'Мемпул',
      value: `${mempool.count.toLocaleString('ru-RU')} tx`,
      change: null,
      changeLabel: null,
      note: `${(mempool.vsize / 1e6).toFixed(2)} MvB неподтверждённых транзакций; суммарные комиссии ${(mempool.total_fee / 1e8).toFixed(3)} BTC.`,
    },
    {
      id: 'btc-fee-fast',
      name: 'Комиссия (ближайший блок)',
      value: `${fees.fastestFee} sat/vB`,
      change: null,
      changeLabel: null,
      note: `Рекомендации источника: 30 мин — ${fees.halfHourFee}, 1 час — ${fees.hourFee}, эконом — ${fees.economyFee}, минимум — ${fees.minimumFee} sat/vB.`,
    },
  ];
  return { source: 'mempool.space', fetchedAt, metrics, fees, difficulty, mempool, tipHeight };
}

export class OnChainService {
  private static cache: { report: OnChainReport; timestamp: number } | null = null;
  private static readonly TTL_MS = 60 * 1000;

  /** Все пять запросов обязательны; отказ любого → исключение (страница показывает «источник недоступен»). */
  public static async fetchReport(adapter: MempoolSpaceAdapter = new MempoolSpaceAdapter(), now = Date.now()): Promise<OnChainReport> {
    if (this.cache && now - this.cache.timestamp < this.TTL_MS) return this.cache.report;
    const [hashrate, difficulty, fees, mempool, tipHeight] = await Promise.all([
      adapter.fetchHashrate3d(),
      adapter.fetchDifficultyAdjustment(),
      adapter.fetchRecommendedFees(),
      adapter.fetchMempool(),
      adapter.fetchTipHeight(),
    ]);
    const report = buildOnChainReport({ hashrate, difficulty, fees, mempool, tipHeight }, now);
    this.cache = { report, timestamp: now };
    return report;
  }

  public static resetCache(): void {
    this.cache = null;
  }
}
