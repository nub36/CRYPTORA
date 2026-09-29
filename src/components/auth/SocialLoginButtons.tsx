/**
 * CRYPTORA — Social login buttons (Google / Telegram / Yandex / VK ID).
 *
 * Only providers the backend reports as configured are rendered — a button
 * that would 404 or dead-end must never appear. Google/Yandex/VK are plain
 * navigations to the server-side OAuth start endpoint (the browser never
 * sees a client secret). Telegram renders the official Login Widget iframe.
 */

import React, { useEffect, useRef } from 'react';
import type { AuthProvidersConfig } from '@/context/AuthContext';

interface SocialLoginButtonsProps {
  providers: AuthProvidersConfig;
  /** Internal path to return to after a successful sign-in. */
  returnTo?: string;
}

/** Official Telegram Login Widget — injects the script into a container. */
const TelegramLoginWidget: React.FC<{ botName: string }> = ({ botName }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '6');
    // The widget redirects here with the signed payload; the server verifies
    // the HMAC signature before trusting a single field.
    script.setAttribute('data-auth-url', `${window.location.origin}/api/auth/oauth/telegram/callback`);
    script.setAttribute('data-request-access', 'write');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [botName]);

  return <div ref={containerRef} className="flex justify-center" data-testid="telegram-widget" />;
};

const buttonClass =
  'flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-surface-2 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-cyan-400/40 hover:text-white';

export const SocialLoginButtons: React.FC<SocialLoginButtonsProps> = ({ providers, returnTo = '/' }) => {
  const anyConfigured = providers.google || providers.telegram || providers.yandex || providers.vk;
  if (!anyConfigured) return null;

  const startUrl = (provider: string) =>
    `/api/auth/oauth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <div className="h-px flex-1 bg-white/10" />
        <span>или</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <div className="mt-4 space-y-2.5">
        {providers.google && (
          <a href={startUrl('google')} className={buttonClass} data-testid="social-google">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path fill="#EA4335" d="M12 5.04c1.62 0 3.06.56 4.2 1.64l3.12-3.12C17.46 1.8 14.97.75 12 .75 7.62.75 3.85 3.26 2 6.94l3.66 2.84C6.54 7.02 9.04 5.04 12 5.04Z" />
              <path fill="#4285F4" d="M23.25 12.27c0-.92-.08-1.6-.26-2.31H12v4.51h6.44c-.13 1.08-.83 2.7-2.39 3.79l3.57 2.77c2.14-1.97 3.63-4.88 3.63-8.76Z" />
              <path fill="#FBBC05" d="M5.66 14.22a7.06 7.06 0 0 1 0-4.44L2 6.94a11.26 11.26 0 0 0 0 10.12l3.66-2.84Z" />
              <path fill="#34A853" d="M12 23.25c3.04 0 5.6-1 7.46-2.72l-3.57-2.77c-.96.67-2.25 1.13-3.89 1.13-2.96 0-5.46-1.98-6.34-4.67L2 17.06c1.85 3.68 5.62 6.19 10 6.19Z" />
            </svg>
            Google
          </a>
        )}

        {providers.yandex && (
          <a href={startUrl('yandex')} className={buttonClass} data-testid="social-yandex">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <rect width="24" height="24" rx="4" fill="#FC3F1D" />
              <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#FFFFFF">
                Я
              </text>
            </svg>
            Yandex
          </a>
        )}

        {providers.vk && (
          <a href={startUrl('vk')} className={buttonClass} data-testid="social-vk">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <rect width="24" height="24" rx="4" fill="#0077FF" />
              <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#FFFFFF">
                VK
              </text>
            </svg>
            VK ID
          </a>
        )}

        {providers.telegram && providers.telegramBotName && (
          <TelegramLoginWidget botName={providers.telegramBotName} />
        )}
      </div>
    </div>
  );
};
