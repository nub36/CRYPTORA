/**
 * In-process notification for consumers of the PostgreSQL Scan Universe.
 *
 * PostgreSQL remains the source of truth. The notification only shortens
 * convergence after an Admin mutation; every consumer must still reread the
 * effective universe and therefore remains correct after a restart.
 */

const listeners = new Set();

export function notifyScanUniverseChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      // A consumer must never make a completed Admin write fail.
      console.error('[scanUniverse] change listener failed:', error instanceof Error ? error.message : String(error));
    }
  }
}

export function subscribeScanUniverseChanged(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam only. */
export function resetScanUniverseEventsForTests() {
  listeners.clear();
}
