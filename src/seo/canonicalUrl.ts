/**
 * CRYPTORA — Canonical production origin.
 *
 * Единственная константа абсолютных публичных URL приложения (canonical,
 * og:url, robots/sitemap). Меняется только домен; название продукта
 * остаётся CRYPTORA.
 *
 * Прежний production-hostname (DuckDNS) после миграции домена (2026-10-05)
 * постоянно 301-редиректит на canonical на уровне nginx и до приложения не
 * доходит — поэтому absolute-URL всегда строится от cryptonic.online,
 * независимо от того, как пользователь попал на сайт.
 * См. docs/agent-plan/DOMAIN_MIGRATION.md.
 */
export const CANONICAL_SITE_ORIGIN = 'https://cryptonic.online';

/**
 * Абсолютный canonical-URL для маршрута SPA.
 *
 * Правила: только path, без query и hash (параметры вида ?next=/signals не
 * создают отдельных канонических адресов); без завершающего слэша, кроме
 * корня; ведущий слэш гарантируется.
 */
export function buildCanonicalUrl(pathname: string): string {
  let path = String(pathname ?? '');
  const queryAt = path.indexOf('?');
  if (queryAt !== -1) path = path.slice(0, queryAt);
  const hashAt = path.indexOf('#');
  if (hashAt !== -1) path = path.slice(0, hashAt);
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '') path = '/';
  return `${CANONICAL_SITE_ORIGIN}${path}`;
}
