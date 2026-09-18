/**
 * CRYPTORA — HTTP harness for the integration suite.
 *
 * Boots the REAL Express app from server/app.js on an ephemeral port and
 * talks to it over real HTTP with `fetch`, carrying cookies manually so the
 * full session flow (Set-Cookie → subsequent authenticated request) is
 * exercised end to end.
 *
 * No supertest: Node 22's global fetch is enough and avoids another dev dep.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Express } from 'express';

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: unknown;
  setCookie: string[];
}

export class HttpClient {
  private jar = new Map<string, string>();

  constructor(private readonly base: string) {}

  /** Cookie header built from the jar, e.g. `sid=...`. */
  cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** Store Set-Cookie values into the jar (last-write-wins per name). */
  private absorb(res: globalThis.Response): void {
    // getSetCookie() is available on Node 18.14+ / undici.
    const raw =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [res.headers.get('set-cookie') ?? ''].filter(Boolean);

    for (const c of raw) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  clearCookies(): void {
    this.jar.clear();
  }

  async request(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = {
      // Same-origin by default: the CSRF middleware expects this.
      Origin: new URL(this.base).origin,
      ...opts.headers,
    };

    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(opts.body);
    }

    const res = await fetch(`${this.base}${path}`, { method, headers, body: payload });
    this.absorb(res);

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body stays a string */
    }

    return {
      status: res.status,
      headers: res.headers,
      body,
      setCookie:
        typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
          ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
          : [res.headers.get('set-cookie') ?? ''].filter(Boolean),
    };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request('GET', path, { headers });
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', path, { body, headers });
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('PATCH', path, { body, headers });
  }
}

/** Start `app` on an ephemeral port; returns a client and a teardown fn. */
export async function listen(app: Express): Promise<{ client: HttpClient; close: () => Promise<void>; port: number }> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = (server.address() as AddressInfo).port;
  return {
    client: new HttpClient(`http://127.0.0.1:${port}`),
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
