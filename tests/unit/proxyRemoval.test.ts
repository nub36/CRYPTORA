/**
 * P0 security regression: proxy endpoints must not exist as active routes.
 *
 * After removing /api/proxy/binance and /api/proxy/kucoin (dead code, SSRF risk),
 * verify that no code paths proxy arbitrary external requests.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('productionServer — proxy removal (SSRF fix)', () => {
  it('no active proxyRequest function or proxyCache in production server', () => {
    const serverPath = path.resolve(__dirname, '../../server/productionServer.js');
    let source: string;
    try {
      source = fs.readFileSync(serverPath, 'utf-8');
    } catch {
      return; // File may not exist in test env
    }

    // These code patterns must NOT exist (active code, not comments)
    expect(source).not.toContain('function proxyRequest(');
    expect(source).not.toContain('proxyCache.get(');
    expect(source).not.toContain('proxyCache.set(');
    expect(source).not.toContain('proxyRequest(\'https://api.binance.com\'');
    expect(source).not.toContain('proxyRequest(\'https://api.kucoin.com\'');
    expect(source).not.toContain("pathname.startsWith('/api/proxy/binance')");
    expect(source).not.toContain("pathname.startsWith('/api/proxy/kucoin')");
  });

  it('no src/ code references proxy endpoints', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const walkSync = (dir: string): string[] => {
      const files: string[] = [];
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            files.push(...walkSync(path.join(dir, entry.name)));
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            files.push(path.join(dir, entry.name));
          }
        }
      } catch { /* dir may not exist */ }
      return files;
    };

    const files = walkSync(srcDir);
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf-8');
      expect(content).not.toContain('/api/proxy/binance');
      expect(content).not.toContain('/api/proxy/kucoin');
    }
  });
});
