/**
 * Шим `node:sqlite` для тестов.
 *
 * Vite (движок vitest) не знает встроенный модуль Node 22 `node:sqlite` и
 * пытается резолвить его как пакет. Шим подгружает НАСТОЯЩИЙ встроенный модуль
 * через `createRequire`, поэтому тесты работают с тем же SQLite, что и прод.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite') as typeof import('node:sqlite');

export const DatabaseSync = sqlite.DatabaseSync;
export default sqlite;
