export function registerSignalNotificationListener(listener: ((signal: Record<string, unknown>, eventType: string) => unknown) | null): void;
export function emitSignalNotification(signal: Record<string, unknown> | null, eventType: string): void;
