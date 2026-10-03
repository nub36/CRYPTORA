let signalListener = null;

/** Register the server-owned side-effect consumer at process startup. */
export function registerSignalNotificationListener(listener) {
  signalListener = typeof listener === 'function' ? listener : null;
}

/**
 * Notification side effects run only after a signal transaction has committed.
 * They never participate in strategy decisions or make a successful lifecycle
 * write fail. Tests can inject/clear the listener without network access.
 */
export function emitSignalNotification(signal, eventType) {
  if (!signalListener || !signal) return;
  Promise.resolve(signalListener(signal, eventType)).catch((error) => {
    console.error('[signal-notification-dispatch]', JSON.stringify({ eventType, signalId: signal.id ?? null, result: 'failure', errorCode: 'DISPATCH_FAILED', message: error?.message }));
  });
}
