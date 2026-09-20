/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  FROZEN V2 RESEARCH ENGINE — svechnoy-suslik-v2 @ 4839074                     ║
 * ║  ISOLATED HISTORICAL ARCHIVE DEPENDENCY. NOT A CRYPTORA COMPONENT.            ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * Purpose (historical): produce the ENTRY population (setup, structural stop, N+1 fill, frozen
 * outcome slot) that V2.1a…V2.8 research runs consumed unmodified. Every V2.x stage in the source
 * enforced `git diff 4839074 -- src/` == empty; the files below are byte-identical to that commit
 * (sha256 in LEGACY_V2_PROVENANCE) except for import-path rewrites and the removal of the DB-backed
 * `Settings` class (replaced by a read-only snapshot reader).
 *
 * Hard rules:
 *   • Imported ONLY from inside `strategyArchive/` (`definitions/v2_*` reproduction runners and the
 *     V2.8 LIVE wrapper `definitions/v2_8-zero-fee-sniper-trailing/v28Live.ts`). LIVE signals reach the
 *     engine exclusively through the archive's public API (`@/services/strategyArchive`), never directly —
 *     enforced by tests/unit/strategyArchive/legacyV2.test.ts.
 *   • NEVER imported by `services/backtest/BacktestEngine`, workers or UI.
 *   • No orders, no exchange, no keys, no database. EXECUTION_CODE_PORTED = NONE.
 *   • Never "improved": a bug here is a discrepancy record, not a fix.
 */

export const LEGACY_V2_PROVENANCE = Object.freeze({
  sourceRepo: 'nub36/svechnoy-suslik-v2',
  frozenCommit: '4839074',
  purpose: 'Historical entry engine for V2.1a–V2.8 research (research-only in the source; never wired to production there either)',
  files: Object.freeze({
    'engine.ts': { sourcePath: 'src/strategy/v2/engine.ts', sha256: '4babd19c2eef1b83' },
    'htf.ts': { sourcePath: 'src/strategy/v2/htf.ts', sha256: 'b175efade6feb806' },
    'indicators.ts': { sourcePath: 'src/strategy/v2/indicators.ts', sha256: '10594cadf615b0e048797e1db9504648794b0cbec41b62da6ec55641d1daa55c' },
    'structure.ts': { sourcePath: 'src/strategy/v2/structure.ts', sha256: 'e04806a33d1ebc4bab24f12f5240c7320ae8e00276157833e51534152a4e662f' },
    'types.ts': { sourcePath: 'src/strategy/v2/types.ts', sha256: '195e85f06322ee2d' },
    'tracker.ts': { sourcePath: 'src/outcome/tracker.ts', sha256: 'e4e6919cb8f82444' },
    'risk.ts': { sourcePath: 'src/strategy/risk.ts', sha256: 'f9fafc2248aeb448' },
    'stateMachine.ts': { sourcePath: 'src/strategy/state-machine.ts (resolveEntry only)', sha256: '87bfdbf7e496bf6f' },
    'v2Runner.ts': { sourcePath: 'src/replay/v2-runner.ts (executableLadder only)', sha256: '92d6f6f3e3a9fb40' },
    'coreTypes.ts': { sourcePath: 'src/core/types.ts (subset)', sha256: '2394992c609c3d17' },
    'legacySettings.ts': { sourcePath: 'src/core/settings.ts (DB-backed; REPLACED by snapshot reader)', sha256: '8ba45d2eb377fdc7' },
    'v24Engine.ts': { sourcePath: 'scripts/real-data/v24-engine.ts', sha256: '6f930e48998bdfbdafd5e7d3e1e07d79307febc3734fca7bc5e44655383edbe3' },
    'corridorEntry.ts': { sourcePath: 'scripts/real-data/corridor-entry.ts', sha256: 'c2eebef8af2dea3c92f4a221a6a5a6eb37ed00585385845b16ea83c74bfaf6bf' },
    // ── research-stage replays (V2.2 / V2.3 / V2.4). Verbatim logic; import paths rewritten; DB loader replaced by
    //    in-memory candles. Source sha256 = file at the version's historical pin (identical at 2d8a3dd).
    'research/v22Engine.ts': { sourcePath: 'scripts/real-data/v22-engine.ts', sha256: 'e6eba37044a079fa' },
    'research/v22Replay.ts': { sourcePath: 'scripts/real-data/v22-replay.ts', sha256: 'e8accd058a99dc64' },
    'research/v23Engine.ts': { sourcePath: 'scripts/real-data/v23-engine.ts', sha256: '1abc8f2c5157ce64' },
    'research/v23Replay.ts': { sourcePath: 'scripts/real-data/v23-replay.ts', sha256: '2544e9d790424c89' },
    'research/v24Replay.ts': { sourcePath: 'scripts/real-data/v24-replay.ts', sha256: 'b65258352e75718d' },
    // ── CRYPTORA glue (NOT source code): drives the verbatim replays per (symbol, timeframe) series and reduces the
    //    trade stream exactly like the source v2x-train.ts / v24-validate.ts `add()` (gross recovery, per-leg fees).
    'research/replayArmRunner.ts': { sourcePath: 'CRYPTORA glue — reduces like scripts/real-data/v22-train.ts (b55ef3e79bcd7e91), v23-train.ts (1e7344ab5bdb24fc), v24-train.ts (9b26bcd9379d388a), v24-validate.ts (afc72b7f8935366b)', sha256: 'n/a (not a source file)' },
    'sniperEntryLoop.ts': { sourcePath: 'CRYPTORA glue — entry loop of scripts/real-data/v25-train.ts / v26-train.ts (verbatim gating order; in-memory candles)', sha256: 'n/a (not a source file)' },
  }),
  settingsSnapshot: 'artifacts/research/v2-real-20260915-080338/settings.json (sha256 92311c4f…)',
  executionCodePorted: 'NONE' as const,
});

export { evaluateV2, paramsFromSettings } from './engine';
export { HTF_MAP, closedHtfCandles } from './htf';
export { trackOutcome } from './tracker';
export { resolveEntry } from './stateMachine';
export { executableLadder } from './v2Runner';
export { Settings as LegacySettings } from './legacySettings';
export { baseSniper, longAsymmetry, structuralTargetsV24 } from './v24Engine';
export { extremePoolKind, type PoolKind } from './corridorEntry';
export type { Candle as LegacyCandle, Timeframe as LegacyTimeframe } from './coreTypes';
export type { V2Setup, TargetPlan } from './types';
export { runSniperEntryLoop, toLegacyCandles, type ResolvedSlot, type LoopStats } from './sniperEntryLoop';
