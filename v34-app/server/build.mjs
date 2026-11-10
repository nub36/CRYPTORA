/**
 * Сборка сервера в один ESM-файл.
 *
 * Ядро V3.4 подключается как TS-исходник и бандлится вместе с сервером: на VPS
 * не требуется ни ts-node, ни отдельная сборка пакета. `express` и `jose`
 * оставлены внешними — они ставятся из npm на сервере.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(HERE, 'src/index.ts')],
  outfile: path.join(HERE, 'dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  alias: { '@v34/core': path.join(HERE, '../packages/v34-core/src/index.ts') },
  external: ['express', 'jose'],
});

await build({
  entryPoints: [path.join(HERE, 'src/scanOnce.ts')],
  outfile: path.join(HERE, 'dist/scan-once.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  alias: { '@v34/core': path.join(HERE, '../packages/v34-core/src/index.ts') },
  external: ['express', 'jose'],
});
