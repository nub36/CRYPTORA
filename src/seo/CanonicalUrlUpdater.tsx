import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { buildCanonicalUrl } from './canonicalUrl';

/**
 * Держит `<link rel="canonical">` и `<meta property="og:url">` актуальными
 * для текущего маршрута SPA. Статические значения в index.html корректны для
 * корня «/»; этот компонент обновляет их при клиентской навигации, чтобы
 * deep-route (например /signals) получал свой канонический абсолютный URL.
 *
 * URL всегда строится от CANONICAL_SITE_ORIGIN — не от window.location —
 * чтобы каноническим оставался cryptonic.online даже при заходе по legacy-хосту.
 */
export function CanonicalUrlUpdater(): null {
  const { pathname } = useLocation();

  useEffect(() => {
    const url = buildCanonicalUrl(pathname);

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;

    let ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (!ogUrl) {
      ogUrl = document.createElement('meta');
      ogUrl.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrl);
    }
    ogUrl.setAttribute('content', url);
  }, [pathname]);

  return null;
}
