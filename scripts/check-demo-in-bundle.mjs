import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEMO_MARKERS = [
  'CRYPTORA_DEMO_PROVIDER_IMPLEMENTATION',
  'DEMO_TIMESTAMP',
  'DEMO_ASSETS',
  'Deterministic mock datasets',
];
const DIST_DIR = './dist/assets';

if (!existsSync(DIST_DIR)) {
  console.error('❌ dist/assets не найден. Сначала выполни npm run build');
  process.exit(1);
}
const files = readdirSync(DIST_DIR).filter((file) => file.endsWith('.js'));
if (files.length === 0) {
  console.error('❌ JS файлы в dist/assets не найдены');
  process.exit(1);
}
let found = false;
for (const file of files) {
  const content = readFileSync(join(DIST_DIR, file), 'utf8');
  for (const marker of DEMO_MARKERS) {
    if (content.includes(marker)) {
      console.error(`❌ DEMO marker "${marker}" найден в: ${file}`);
      found = true;
    }
  }
}
if (found) {
  console.error('\n💥 Demo код найден в production bundle!');
  process.exit(1);
}
console.log(`✅ Demo маркеры не найдены в ${files.length} JS файлах bundle`);
