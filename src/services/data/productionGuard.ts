/** Prevents the deterministic QA provider from being instantiated by a production runtime. */
export function assertDemoNotInProduction(context = 'DemoMarketDataProvider'): void {
  const nodeProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';
  const viteProduction = Boolean((import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD);
  if (nodeProduction || viteProduction) {
    throw new Error(
      `[CRITICAL] ${context} loaded in production environment. `
      + 'This is a build/configuration error.',
    );
  }
}
