/**
 * Версия приложения для health-ответа.
 *
 * Читается один раз при загрузке модуля: health-запрос не должен ходить в
 * файловую систему. Отдаётся ТОЛЬКО номер версии из package.json —
 * ни путей, ни зависимостей, ни содержимого файла.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSION = (() => {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8');
    const value = JSON.parse(raw)?.version;
    return typeof value === 'string' && value.length <= 32 ? value : 'unknown';
  } catch {
    return 'unknown';
  }
})();

export function readPackageVersion() {
  return VERSION;
}
