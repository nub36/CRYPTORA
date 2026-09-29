/**
 * CRYPTORA — Which login providers are actually configured on the backend.
 *
 * GET /api/auth/providers is public and contains booleans only (plus the
 * public Telegram bot username). While loading — and if the backend is
 * unreachable — social buttons are simply not rendered: a provider button
 * must never appear unless it will actually work.
 */

import { useEffect, useState } from 'react';
import type { AuthProvidersConfig } from '@/context/AuthContext';

const FALLBACK: AuthProvidersConfig = {
  emailPassword: true,
  emailVerification: true,
  google: false,
  telegram: false,
  yandex: false,
  vk: false,
  telegramBotName: null,
};

export function useAuthProviders(): { providers: AuthProvidersConfig; loading: boolean } {
  const [providers, setProviders] = useState<AuthProvidersConfig>(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/providers', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (active && body && typeof body === 'object') {
          setProviders({ ...FALLBACK, ...body });
        }
      })
      .catch(() => {
        /* backend unreachable — keep the fallback (email/password only) */
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { providers, loading };
}
