/**
 * Типы загрузчика исследовательского ядра Strategy Lab (RESEARCH ONLY).
 * Ядро собирается esbuild'ом из src/services/strategyLab — здесь объявлен
 * только публичный контракт загрузчика для TypeScript-тестов и серверного JS.
 */
export function loadLabCore(): Promise<Record<string, any>>;
