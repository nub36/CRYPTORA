/**
 * Strategy Archive — contracts.
 *
 * ⚠️ CRYPTORA DOES NOT EXECUTE TRADES. Everything in `strategyArchive/` is a
 * read-only historical research archive imported from `svechnoy-suslik-v2`.
 * There is no order placement, no exchange API, no bot, no keys.
 *
 * The archive stores *versioned, immutable* strategy definitions. Each version
 * is its own module; versions never share mutable parameters and there is no
 * `if (version)` branching inside one algorithm.
 */

/** Timeframes used by the archived research (Suslik notation, lowercase). */
export const ARCHIVE_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'] as const;
export type ArchiveTimeframe = (typeof ARCHIVE_TIMEFRAMES)[number];

/** Timeframe span in milliseconds — closed-candle math and N+1 timing. */
export const ARCHIVE_TF_MS: Readonly<Record<ArchiveTimeframe, number>> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

/**
 * Archive candle — the Suslik `Candle` shape (ms timestamps, closeTime =
 * openTime + span − 1, explicit `isClosed`). Never evaluate `isClosed === false`.
 */
export interface ArchiveCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  isClosed: boolean;
}

export type ArchiveDirection = 'LONG' | 'SHORT';

/** How a result figure was obtained — must be shown next to every number. */
export type ResultOrigin =
  /** Copied verbatim from the source repository's artifacts. */
  | 'SOURCE_REPORTED'
  /** Re-run inside CRYPTORA against the pinned dataset and matched. */
  | 'REPRODUCED'
  /** Computed by CRYPTORA from archived data (not part of the source programme). */
  | 'DERIVED_BY_CRYPTORA';

/** Reproducibility status of one version inside CRYPTORA. */
export type ReproducibilityStatus =
  /** spec → implementation hash → runner → dataset manifest → artifact hash verified, run NOT repeated. */
  | 'SOURCE_CHAIN_VERIFIED_NOT_RERUN'
  /** Re-run on the pinned dataset inside CRYPTORA and matched the source artifact. */
  | 'REPRODUCED'
  /** Re-run attempted and did not match. */
  | 'REPRODUCTION_MISMATCH'
  /** Chain could not be verified. */
  | 'UNVERIFIED';

/** Research outcome of the version in the source programme. */
export type ResearchVerdict =
  | 'REJECTED_ON_TRAIN'
  | 'FALSIFIED_ON_TRAIN'
  | 'FAILED_VALIDATION'
  | 'VALIDATED_GROSS_ONLY'
  | 'VALIDATED_FOR_RESEARCH'
  | 'BASELINE';

export interface FeeModelPerLeg {
  kind: 'PER_LEG_BPS';
  makerBps: number;
  takerBps: number;
  /** Entry is a maker leg, every exit leg is a taker leg (Suslik convention). */
  entryIsMaker: true;
}

export interface FrozenAssumptions {
  fees: FeeModelPerLeg;
  stressFees?: FeeModelPerLeg;
  slippage: 'NOT_MODELLED';
  funding: 'NOT_MODELLED';
  spread: 'NOT_MODELLED';
  positionSizing: 'NONE_R_MULTIPLES_ONLY';
  marketData: 'BINANCE_SPOT_KLINES';
  feeVenueAssumed: 'BINANCE_USDT_FUTURES';
}

/** One documented discrepancy between the written spec and the actual research code. */
export interface SpecResearchDiscrepancy {
  id: string;
  specStatement: string;
  researchBehaviour: string;
  impact: string;
  /** Historical reproduction MUST keep the research behaviour. */
  reproductionPolicy: 'PRESERVE_RESEARCH_BEHAVIOUR';
  evidence: string[];
}

export interface SourceFilePin {
  path: string;
  sha256: string;
  role: 'SPEC' | 'PREREGISTRATION' | 'RESEARCH_IMPLEMENTATION' | 'RUNNER' | 'ARTIFACT' | 'SETTINGS' | 'SPLITS' | 'DATASET_MANIFEST' | 'RESULTS_DOC' | 'PRODUCTION_PORT' | 'SHARED_PRIMITIVE';
}

/** Split window in ms (inclusive openTime bounds), copied from the source splits.json. */
export interface SplitWindow {
  symbol: string;
  timeframe: ArchiveTimeframe;
  trainFromMs: number;
  trainToMs: number;
  validFromMs: number;
  validToMs: number;
  testFromMs: number;
  testToMs: number;
}

export type SliceName = 'train' | 'validation';

/** A resolved historical trade in R units (no capital). */
export interface ArchiveTrade {
  symbol: string;
  direction: ArchiveDirection;
  setupOpenTime: number;
  fillOpenTime: number;
  entry: number;
  stop: number;
  exitReason: string;
  barsHeld: number;
  grossR: number;
  /** Fee in R at the frozen (headline) fee model. */
  feeRHeadline: number;
  /** Fee in R at the stress fee model, if defined. */
  feeRStress: number | null;
  stopDistancePct: number;
}

export interface FunnelCounts {
  signals: number;
  pendingCreated: number;
  filled: number;
  expired: number;
  cancelled: number;
  rejected: number;
  unresolved: number;
}

/** R-based metrics — the same definitions the source programme used. */
export interface RMetrics {
  n: number;
  grossRPerTrade: number;
  feeDragRHeadline: number;
  netRPerTradeHeadline: number;
  feeDragRStress: number | null;
  netRPerTradeStress: number | null;
  profitFactor: number | null;
  maxDrawdownR: number;
  positiveRRatePct: number;
  grossMedianR: number;
  avgWinR: number;
  avgLossR: number;
  medianBarsHeld: number;
  stopDistancePct: { p25: number; median: number; p75: number };
  exits: Record<string, number>;
  outlierDependence: {
    grossExpectancy: number;
    exTop1: number;
    exTop5: number;
    exTop1Pct: number;
    removedForTop1Pct: number;
  };
  byDirection: Record<string, { n: number; grossExpectancy: number }>;
  bySymbol: Record<string, { n: number; grossExpectancy: number }>;
}

export interface ReproductionReport {
  versionId: string;
  slice: SliceName;
  origin: 'DERIVED_BY_CRYPTORA';
  funnel: FunnelCounts;
  metrics: RMetrics;
  trades: ArchiveTrade[];
  /** Highest candle openTime the run actually read (guard against future access). */
  maxCandleOpenTimeRead: number;
  deterministicDigest: string;
}

/** Input to a version's `run()` — candles by symbol and timeframe, already adapted. */
export interface ArchiveSeriesInput {
  symbol: string;
  bySeries: Partial<Record<ArchiveTimeframe, readonly ArchiveCandle[]>>;
  split: SplitWindow;
}

/** The small contract every archived version implements. */
export interface StrategyDefinition {
  id: string;
  version: string;
  name: string;
  nameRu: string;
  verdict: ResearchVerdict;
  reproducibility: ReproducibilityStatus;
  execTimeframe: ArchiveTimeframe;
  structuralTimeframe: ArchiveTimeframe | null;
  symbols: readonly string[];
  assumptions: FrozenAssumptions;
  discrepancies: readonly SpecResearchDiscrepancy[];
  sourcePins: readonly SourceFilePin[];
  /** Replays one symbol over one slice, preserving the research runner's semantics. */
  runSeries(input: ArchiveSeriesInput, slice: SliceName): {
    trades: ArchiveTrade[];
    funnel: FunnelCounts;
    maxCandleOpenTimeRead: number;
  };
}
