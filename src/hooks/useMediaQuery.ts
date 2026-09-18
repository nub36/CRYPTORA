import { useEffect, useState } from 'react';

/**
 * Безопасный media-query хук.
 * В средах без `window.matchMedia` (JSDOM в unit/E2E-тестах) возвращает `false`
 * и не бросает исключений — тестовое окружение остаётся детерминированным.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => evaluate(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    setMatches(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    return undefined;
  }, [query]);

  return matches;
}

function evaluate(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}
