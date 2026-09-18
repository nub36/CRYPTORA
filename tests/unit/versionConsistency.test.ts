import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Версия в package.json — источник истины; бейджи Header/Footer и e2e-инвариант не должны отставать. */
describe('version consistency', () => {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  it.each(['src/components/layout/Header.tsx', 'src/components/layout/Footer.tsx', 'e2e/uiRegression.spec.tsx'])(
    '%s содержит v%s и никакой другой v0.x.y',
    (file) => {
      const txt = readFileSync(file, 'utf8');
      expect(txt).toContain(`v${version}`);
      const others = [...new Set(Array.from(txt.matchAll(/v(\d+\.\d+\.\d+)/g), (m) => m[1]))].filter((v) => v !== version);
      expect(others, `устаревшие версии в ${file}`).toEqual([]);
    },
  );
  it('productionServer.js берёт версию из package.json, а не из константы', () => {
    const txt = readFileSync('server/productionServer.js', 'utf8');
    expect(txt).toContain('APP_VERSION');
    expect(txt).not.toMatch(/version: '\d+\.\d+\.\d+'/);
  });
  it('CHANGELOG начинается с текущей версии', () => {
    const txt = readFileSync('CHANGELOG.md', 'utf8');
    const first = txt.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
    expect(first).toBe(version);
  });
});
