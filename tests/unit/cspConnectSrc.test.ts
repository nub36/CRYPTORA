import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Каждый внешний хост, к которому обращается фронтенд, должен быть разрешён в CSP connect-src production-сервера —
 * иначе на VPS адаптер молча падает в «ИСТОЧНИК НЕДОСТУПЕН».
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('production CSP connect-src covers all external origins used in src/', () => {
  it('every https/wss origin referenced by src/ is present in server/productionServer.js CONNECT_SRC', () => {
    const server = readFileSync('server/productionServer.js', 'utf8');
    const block = server.slice(server.indexOf('const CONNECT_SRC'), server.indexOf('];', server.indexOf('const CONNECT_SRC')));
    const allowed = new Set(Array.from(block.matchAll(/'((?:https|wss):\/\/[^']+)'/g), (m) => m[1]));

    const origins = new Set<string>();
    for (const f of walk('src')) {
      const txt = readFileSync(f, 'utf8');
      for (const m of txt.matchAll(/(https|wss):\/\/([a-zA-Z0-9.-]+)(:\d+)?/g)) {
        const host = m[2];
        if (/github|keepachangelog|localhost|example|w3\.org|schema|vitejs|react/.test(host)) continue;
        origins.add(`${m[1]}://${host}${m[3] ?? ''}`);
      }
    }
    const missing = [...origins].filter((o) => !allowed.has(o));
    // nginx выставляет собственный CSP; браузер применяет пересечение, поэтому он обязан содержать те же origin.
    const nginx = readFileSync('nginx/cryptora.conf', 'utf8');
    const nginxMissing = [...allowed].filter((o) => !nginx.includes(o));
    expect(nginxMissing, `нет в nginx/cryptora.conf: ${nginxMissing.join(', ')}`).toEqual([]);
    expect(missing, `не разрешены в CSP: ${missing.join(', ')}`).toEqual([]);
    expect(origins.size).toBeGreaterThanOrEqual(10);
  });
});
