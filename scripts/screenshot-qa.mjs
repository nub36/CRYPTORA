#!/usr/bin/env node
/**
 * CRYPTORA — Screenshot & Layout QA harness
 * ---------------------------------------------------------------------------
 * Реальный браузерный QA (Chromium через Playwright) для проверки вёрстки
 * viewport-by-viewport: делает фактический скриншот + измеряет геометрию DOM
 * (horizontal overflow, clipping, размеры шрифтов навигации).
 *
 * Использование:
 *   node scripts/screenshot-qa.mjs --tag=before
 *   node scripts/screenshot-qa.mjs --base=http://localhost:5173 --tag=after
 *
 * Переменные окружения (все опциональны):
 *   CRYPTORA_CHROMIUM_PATH      — путь к исполняемому файлу Chromium/Chrome
 *   CRYPTORA_CHROMIUM_LD_PATH   — LD_LIBRARY_PATH для кастомного Chromium
 *   CRYPTORA_QA_FONTS_DIR       — каталог с @fontsource/{inter,jetbrains-mono}
 *                                 (нужен для метрик реальных шрифтов продакшена)
 *
 * Скриншоты и JSON-отчёт складываются в `screenshots/` (артефакт, не в git).
 * Код возврата != 0 — найдены layout-регрессии.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE = arg('base', process.env.CRYPTORA_QA_BASE || 'http://localhost:5173');
const TAG = arg('tag', 'latest');
const OUT_DIR = resolve(repoRoot, arg('out', 'screenshots'));

// Production-oriented QA: единственный пользовательский режим — LIVE.
// `--mode=qa-fixture` — служебный прогон против dev-сервера (`npm run dev`) с
// детерминированным QA-датасетом; в production-сборке этот ключ игнорируется,
// поэтому «два пользовательских режима» скриптом больше не тестируются.
const MODE = arg('mode', 'live'); // live (production) | qa-fixture (только dev-сервер)
if (!['live', 'qa-fixture'].includes(MODE)) {
  console.error(`[screenshot-qa] unknown --mode=${MODE}; allowed: live | qa-fixture`);
  process.exit(2);
}

const ROUTES = arg('routes', '/,/coin/BTC')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

const VIEWPORTS = arg('viewports', '390x844,768x1024,1024x768,1280x800,1366x768,1440x900,1920x1080')
  .split(',')
  .map((v) => {
    const [w, h] = v.split('x').map(Number);
    return { width: w, height: h, name: `${w}x${h}` };
  });

/** Находит Chromium: сначала кастомный (serverless/песочница), затем встроенный в Playwright. */
function resolveChromium() {
  const explicit = process.env.CRYPTORA_CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) {
    return { executablePath: explicit, ldPath: process.env.CRYPTORA_CHROMIUM_LD_PATH || null };
  }
  if (existsSync('/tmp/chromium')) {
    return { executablePath: '/tmp/chromium', ldPath: process.env.CRYPTORA_CHROMIUM_LD_PATH || null };
  }
  return { executablePath: undefined, ldPath: null };
}

/**
 * Прод-вёрстка использует Inter + JetBrains Mono (Google Fonts).
 * В изолированных CI-песочницах внешние шрифты недоступны, поэтому подменяем
 * их локальными woff2-сабсетами через @font-face(data URI) — метрики текста
 * в скриншотах совпадают с продакшеном.
 */
function loadFontCss() {
  const dirs = [
    process.env.CRYPTORA_QA_FONTS_DIR,
    '/tmp/chrome-env/node_modules/@fontsource',
    join(repoRoot, 'node_modules/@fontsource'),
  ].filter(Boolean);

  const base = dirs.find((d) => existsSync(d));
  if (!base) return '';

  const families = [
    { css: 'Inter', pkg: 'inter', slug: 'inter', weights: [400, 500, 600, 700] },
    { css: 'JetBrains Mono', pkg: 'jetbrains-mono', slug: 'jetbrains-mono', weights: [400, 500, 600, 700] },
  ];
  const subsets = ['latin', 'cyrillic'];
  const blocks = [];

  for (const family of families) {
    for (const weight of family.weights) {
      for (const subset of subsets) {
        const file = join(base, family.pkg, 'files', `${family.slug}-${subset}-${weight}-normal.woff2`);
        if (!existsSync(file)) continue;
        const b64 = readFileSync(file).toString('base64');
        blocks.push(
          `@font-face{font-family:'${family.css}';font-style:normal;font-weight:${weight};` +
            `font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
        );
      }
    }
  }
  return blocks.join('\n');
}

/** Измерения в браузере: overflow, clipping, типографика навигации. */
const DIAGNOSTICS = () => {
  const vw = window.innerWidth;
  const docEl = document.documentElement;
  const body = document.body;
  const header = document.querySelector('header');

  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: String(el.className || '').replace(/\s+/g, ' ').slice(0, 90),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    left: Math.round(el.getBoundingClientRect().left * 10) / 10,
    right: Math.round(el.getBoundingClientRect().right * 10) / 10,
    width: Math.round(el.getBoundingClientRect().width * 10) / 10,
  });

  const headerOverflow = [];
  const headerClipped = [];
  if (header) {
    for (const el of header.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > vw + 0.5) headerOverflow.push(describe(el));
      // Любой контент, который не помещается в свой контейнер и не раскрывается
      // дальше по DOM (включая overflow: visible — это и есть невидимый clipping).
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        const st = getComputedStyle(el);
        const suppressed =
          st.overflowX === 'hidden' ||
          st.overflowX === 'auto' ||
          st.overflowX === 'scroll' ||
          st.textOverflow === 'ellipsis';
        headerClipped.push({
          ...describe(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          suppressed,
        });
      }
    }
  }

  const nav = header?.querySelector('nav[aria-label="Главная навигация"]');
  const navLinks = nav ? [...nav.querySelectorAll('a, button')].filter((el) => el.getBoundingClientRect().width > 1) : [];
  const navFontSizes = navLinks.map((el) => parseFloat(getComputedStyle(el).fontSize));
  const navFontWeights = navLinks.map((el) => getComputedStyle(el).fontWeight);

  // Пересечение соседних кластеров шапки: бренд | навигация | service controls.
  // Именно этот дефект (наложение «Обзор» на бейдж версии) пропускали assertions.
  const overlaps = [];
  if (header) {
    const row = header.firstElementChild;
    if (row) {
      const clusters = [...row.children].map((el) => ({
        el,
        box: el.getBoundingClientRect(),
        label: String(el.className || '').slice(0, 40),
      }));
      for (let i = 0; i < clusters.length; i += 1) {
        for (let j = i + 1; j < clusters.length; j += 1) {
          const a = clusters[i].box;
          const b = clusters[j].box;
          if (a.width < 1 || b.width < 1) continue;
          const horizontallyOverlaps = a.right > b.left + 1 && b.right > a.left + 1;
          const verticallyOverlaps = a.bottom > b.top + 1 && b.bottom > a.top + 1;
          if (horizontallyOverlaps && verticallyOverlaps) {
            overlaps.push(
              `${clusters[i].label} ∩ ${clusters[j].label} (${Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left))}px)`
            );
          }
        }
      }
    }
  }

  const headerRect = header?.getBoundingClientRect();

  // Пустые вертикальные зоны перед footer (крупные, но пустые блоки).
  const bottomGaps = [];
  const footer = document.querySelector('footer');
  if (footer) {
    const fr = footer.getBoundingClientRect();
    const scan = document.querySelectorAll('main > div > *');
    for (const el of scan) {
      const r = el.getBoundingClientRect();
      if (r.height >= 120) {
        const st = getComputedStyle(el);
        const padTop = parseFloat(st.paddingTop) || 0;
        const padBottom = parseFloat(st.paddingBottom) || 0;
        const childHeight = [...el.children].reduce((acc, c) => acc + c.getBoundingClientRect().height, 0);
        const contentHeight = Math.max(childHeight, el.getBoundingClientRect().height - padTop - padBottom);
        const emptyRatio = 1 - contentHeight / Math.max(r.height, 1);
        if (emptyRatio > 0.45 && el.getBoundingClientRect().top < fr.top) {
          bottomGaps.push({ ...describe(el), height: Math.round(r.height), emptyRatio: Math.round(emptyRatio * 100) / 100 });
        }
      }
    }
  }

  return {
    viewport: { width: vw, height: window.innerHeight },
    documentScrollWidth: docEl.scrollWidth,
    bodyScrollWidth: body.scrollWidth,
    horizontalOverflowPx: Math.max(0, Math.round(docEl.scrollWidth - vw)),
    header: headerRect
      ? {
          height: Math.round(headerRect.height),
          scrollWidth: header.scrollWidth,
          clientWidth: header.clientWidth,
          overflowPx: Math.max(0, header.scrollWidth - header.clientWidth),
        }
      : null,
    headerRows: (() => {
      if (!header) return [];
      const row = header.firstElementChild;
      if (!row) return [];
      const kids = [...row.children].filter((el) => el.getBoundingClientRect().width > 1);
      const byTop = new Map();
      for (const el of kids) {
        const top = Math.round(el.getBoundingClientRect().top);
        const key = [...byTop.keys()].find((t) => Math.abs(t - top) <= 12) ?? top;
        byTop.set(key, (byTop.get(key) || 0) + el.getBoundingClientRect().width);
      }
      return [...byTop.entries()].map(([top, used]) => ({
        top,
        used: Math.round(used),
        slack: Math.round(window.innerWidth - 32 - used),
      }));
    })(),
    dataModeChip: (() => {
      const chip = header?.querySelector('button[title^="Режим LIVE"], button[title^="Нажмите"]');
      if (!chip) return null;
      const r = chip.getBoundingClientRect();
      return { text: (chip.textContent || '').trim().replace(/\s+/g, ' '), width: Math.round(r.width), right: Math.round(r.right) };
    })(),
    headerOverflow: headerOverflow.slice(0, 12),
    headerOverflowCount: headerOverflow.length,
    headerClipped: headerClipped.slice(0, 12),
    headerClippedCount: headerClipped.length,
    headerOverlaps: overlaps,
    nav: {
      itemCount: navLinks.length,
      minFontSizePx: navFontSizes.length ? Math.min(...navFontSizes) : null,
      maxFontSizePx: navFontSizes.length ? Math.max(...navFontSizes) : null,
      weights: [...new Set(navFontWeights)],
      labels: navLinks.map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)),
    },
    bottomGaps: bottomGaps.slice(0, 8),
  };
};

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fontCss = loadFontCss();
  const { executablePath, ldPath } = resolveChromium();

  const launchOptions = {
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
      '--force-color-profile=srgb',
    ],
  };
  if (ldPath) launchOptions.env = { ...process.env, LD_LIBRARY_PATH: ldPath };

  const browser = await chromium.launch(launchOptions);
  const report = {
    tag: TAG,
    base: BASE,
    chromium: executablePath || '(playwright bundled)',
    fontsInjected: Boolean(fontCss),
    startedAt: new Date().toISOString(),
    results: [],
    failures: [],
  };

  const MODES = [MODE];

  for (const currentMode of MODES) {
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));

      await page.addInitScript(
        ({ mode, watchlist, alerts }) => {
          try {
            localStorage.removeItem('cryptora_data_mode'); // устаревший ключ, не используется
            if (mode === 'qa-fixture') localStorage.setItem('cryptora_qa_fixture', '1');
            else localStorage.removeItem('cryptora_qa_fixture');
            localStorage.setItem('cryptora_watchlist', JSON.stringify(watchlist));
            localStorage.setItem('cryptora_alerts', JSON.stringify(alerts));
          } catch {
            /* localStorage может быть недоступен — режим по умолчанию LIVE */
          }
        },
        { mode: currentMode, watchlist: ['BTC', 'ETH', 'SOL'], alerts: ['alert-btc-vol', 'alert-eth-funding'] }
      );

      if (fontCss) {
        await page.addInitScript((css) => {
          document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
          });
        }, fontCss);
      }

      await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('header', { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);

      const diagnostics = await page.evaluate(DIAGNOSTICS);

      const slugRoute = route === '/' ? 'home' : route.replace(/[/]/g, '-').replace(/^-/, '');
      const prefix = `${TAG}-${currentMode}-${slugRoute}-${vp.name}`;
      await page.screenshot({ path: join(OUT_DIR, `${prefix}-full.png`), fullPage: true });
      const headerBox = await page.evaluate(() => {
        const h = document.querySelector('header');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return { x: 0, y: 0, width: Math.min(Math.ceil(r.width), window.innerWidth), height: Math.ceil(r.height) };
      });
      if (headerBox) {
        await page.screenshot({ path: join(OUT_DIR, `${prefix}-header.png`), clip: headerBox });
      }
      await page.screenshot({
        path: join(OUT_DIR, `${prefix}-viewport.png`),
        clip: { x: 0, y: 0, width: vp.width, height: Math.min(vp.height, 1400) },
      });

      // Ошибки недоступности внешних биржевых API — особенность изолированной среды,
      // а не регрессия вёрстки: фиксируем отдельно, без провала проверки.
      const DATA_SOURCE_ERROR = /unavailable from|unavailable for|Live market data|Live asset detail|Candle data|Failed to load resource|net::ERR|WebSocket/i;
      const layoutErrors = consoleErrors.filter((e) => !DATA_SOURCE_ERROR.test(e));
      const environmentErrors = consoleErrors.filter((e) => DATA_SOURCE_ERROR.test(e));

      const vpFailures = [];
      if (diagnostics.horizontalOverflowPx > 0) {
        vpFailures.push(`document horizontal overflow: +${diagnostics.horizontalOverflowPx}px`);
      }
      if (diagnostics.header?.overflowPx > 0) {
        vpFailures.push(`header content wider than header: +${diagnostics.header.overflowPx}px`);
      }
      if (diagnostics.headerOverflowCount > 0) {
        vpFailures.push(`header elements outside viewport: ${diagnostics.headerOverflowCount}`);
      }
      if (diagnostics.headerClippedCount > 0) {
        vpFailures.push(`header content clipped inside container: ${diagnostics.headerClippedCount}`);
      }
      if (diagnostics.headerOverlaps.length > 0) {
        vpFailures.push(`header clusters overlap: ${diagnostics.headerOverlaps.join('; ')}`);
      }
      if (diagnostics.header?.scrollWidth > diagnostics.header?.clientWidth + 2) {
        vpFailures.push(`header scrollable beyond viewport: +${diagnostics.header.scrollWidth - diagnostics.header.clientWidth}px`);
      }
      if (vp.width >= 1024 && diagnostics.nav.itemCount > 0 && diagnostics.nav.minFontSizePx < 12) {
        vpFailures.push(`primary nav font-size too small: ${diagnostics.nav.minFontSizePx}px`);
      }
      if (layoutErrors.length) {
        vpFailures.push(`page errors: ${layoutErrors.slice(0, 2).join(' | ')}`);
      }

      report.results.push({
        mode: currentMode,
        route,
        viewport: vp.name,
        diagnostics,
        screenshots: prefix,
        consoleErrors: layoutErrors,
        environmentNotes: environmentErrors.slice(0, 3),
      });
      for (const f of vpFailures) {
        report.failures.push({ mode: currentMode, route, viewport: vp.name, issue: f });
      }

      const status = vpFailures.length ? 'FAIL' : ' OK ';
      const rowSummary = diagnostics.headerRows.map((r) => r.slack).join('/');
      console.log(
        `[${status}] ${currentMode.toUpperCase().padEnd(4)} ${route} @ ${vp.name.padEnd(9)} ` +
          `navItems=${diagnostics.nav.itemCount} navFont=${diagnostics.nav.minFontSizePx ?? '-'}px ` +
          `rowSlack=${rowSummary || '-'} chip="${diagnostics.dataModeChip?.text ?? '-'}" ` +
          `docOverflow=${diagnostics.horizontalOverflowPx}px offscreen=${diagnostics.headerOverflowCount} ` +
          `clipped=${diagnostics.headerClippedCount} overlaps=${diagnostics.headerOverlaps.length}`
      );
      for (const f of vpFailures) console.log(`         ↳ ${f}`);

      await context.close();
    }
  }
  }

  await browser.close();
  const reportPath = join(OUT_DIR, `qa-report-${TAG}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nScreenshots: ${OUT_DIR}`);
  console.log(`Report:      ${reportPath}`);
  console.log(`Failures:    ${report.failures.length}`);
  process.exit(report.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
