/**
 * CRYPTORA — Domain migration guard (canonical: cryptonic.online, 2026-10-05).
 *
 * Финальное решение владельца: канонический production-домен —
 * https://cryptonic.online; `www` и legacy `cryptora.duckdns.org` постоянно
 * 301-редиректят на него НА УРОВНЕ NGINX и не являются application origins
 * (APP_ORIGIN единственный; APP_TRUSTED_ORIGINS не вводился).
 *
 * Этот файл — CI-версия after-deploy скана: в runtime-коде и конфигурационных
 * артефактах не должно остаться АКТИВНЫХ ссылок на cryptora.duckdns.org.
 * Разрешённые исключения:
 *   - nginx/cryptora.conf: server-block legacy-редиректа (и только он);
 *   - docs/**, исторические отчёты и заметки (documentation/history).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const LEGACY_HOST = 'cryptora.duckdns.org';
// Сам этот файл легально содержит литерал legacy-хоста (это и есть сканер).
const SELF_PATH = path.resolve(__filename);

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/** Рекурсный обход каталога репозитория (без node_modules/dist/.git/coverage). */
function listFiles(dirRel: string): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'coverage', '.generated'].includes(entry.name)) continue;
      const full = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, dirRel));
  return out;
}

function filesContainingLegacyHost(dirRel: string): string[] {
  return listFiles(dirRel)
    .filter((f) => f !== SELF_PATH)
    .filter((f) => fs.readFileSync(f, 'utf8').includes(LEGACY_HOST))
    .map((f) => path.relative(REPO_ROOT, f));
}

describe('Domain migration guard — активные ссылки на legacy-хост запрещены', () => {
  it('runtime-код (server/, src/, shared/) не ссылается на cryptora.duckdns.org', () => {
    const offenders = ['server', 'src', 'shared'].flatMap(filesContainingLegacyHost);
    expect(offenders).toEqual([]);
  });

  it('тесты и e2e не используют legacy-хост как production-фикстуру', () => {
    const offenders = ['tests', 'e2e'].filter(fs.existsSync).flatMap(filesContainingLegacyHost);
    expect(offenders).toEqual([]);
  });

  it('конфигурационные артефакты чисты (.env.example, systemd, workflows, index.html, public/)', () => {
    const files = [
      '.env.example',
      'systemd/cryptora.service',
      '.github/workflows/deploy.yml',
      'index.html',
      'public/robots.txt',
      'public/sitemap.xml',
    ];
    const offenders = files.filter((f) => readRepoFile(f).includes(LEGACY_HOST));
    expect(offenders).toEqual([]);
  });

  it('nginx-шаблон: legacy DuckDNS существует ТОЛЬКО как 301-редирект на canonical', () => {
    const conf = readRepoFile('nginx/cryptora.conf');

    // Legacy-имя присутствует (редирект обязателен)…
    const legacyAt = conf.indexOf('server_name cryptora.duckdns.org;');
    expect(legacyAt).toBeGreaterThan(-1);

    // …но его server-block НЕ раздаёт приложение и НЕ проксирует API.
    const block = conf.slice(legacyAt, conf.indexOf('\n}', legacyAt));
    expect(block).toContain('return 301 https://cryptonic.online$request_uri;');
    expect(block).not.toMatch(/\broot\s+\S/);
    expect(block).not.toContain('proxy_pass');
    expect(block).toContain('ssl_certificate /etc/letsencrypt/live/cryptora.duckdns.org/');

    // Canonical vhost обслуживает приложение и проксирует /api на loopback.
    expect(conf).toContain('server_name cryptonic.online;');
    expect(conf).toContain('proxy_pass http://127.0.0.1:3000;');

    // WWW — только редирект, отдельным server-block'ом.
    const wwwAt = conf.indexOf('server_name www.cryptonic.online;');
    expect(wwwAt).toBeGreaterThan(-1);
    const wwwBlock = conf.slice(wwwAt, conf.indexOf('\n}', wwwAt));
    expect(wwwBlock).toContain('return 301 https://cryptonic.online$request_uri;');
    expect(wwwBlock).not.toContain('proxy_pass');

    // Порт 3000 наружу не публикуется — только 127.0.0.1.
    expect(conf).not.toMatch(/listen[^\n]*3000/);
  });

  it('SEO-артефакты используют только canonical-домен', () => {
    const html = readRepoFile('index.html');
    expect(html).toContain('<link rel="canonical" href="https://cryptonic.online/" />');
    expect(html).toContain('<meta property="og:url" content="https://cryptonic.online/" />');
    expect(readRepoFile('public/robots.txt')).toContain('Sitemap: https://cryptonic.online/sitemap.xml');
    const sitemap = readRepoFile('public/sitemap.xml');
    expect(sitemap).toContain('<loc>https://cryptonic.online/</loc>');
    expect(sitemap).not.toContain(LEGACY_HOST);
  });

  it('systemd-юнит: бэкенд привязан к loopback, путь = /root/CRYPTORA', () => {
    const unit = readRepoFile('systemd/cryptora.service');
    expect(unit).toContain('Environment=HOST=127.0.0.1');
    expect(unit).not.toContain('0.0.0.0');
    expect(unit).toContain('WorkingDirectory=/root/CRYPTORA');
    expect(unit).not.toContain('/home/user/CRYPTORA');
  });
});
