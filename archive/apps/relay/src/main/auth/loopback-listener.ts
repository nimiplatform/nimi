// RL-BOOT-005 — Loopback OAuth Listener
// Node.js HTTP server that captures OAuth callback on loopback hosts

import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export interface LoopbackListenerResult {
  code?: string;
  state?: string;
  error?: string;
}

function renderOAuthResultPage(status: 'success' | 'error'): string {
  if (status === 'success') {
    return [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8"><title>OAuth Complete - Nimi</title></head>',
      '<body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; background:#ffffff; color:#0f172a;">',
      '<main style="text-align:center; padding:32px;">',
      '<h1 style="margin:0 0 12px;">Authentication Complete!</h1>',
      '<p style="margin:0; color:#475569;">You have successfully signed in to Nimi. You can close this window now.</p>',
      '<script>setTimeout(function(){window.close();}, 3000);</script>',
      '</main></body></html>',
    ].join('');
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8"><title>OAuth Failed - Nimi</title></head>',
    '<body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; background:#fff1f2; color:#881337;">',
    '<main style="text-align:center; padding:32px;">',
    '<h1 style="margin:0 0 12px;">Authentication Failed</h1>',
    '<p style="margin:0;">Please return to the app and try again.</p>',
    '</main></body></html>',
  ].join('');
}

const SUCCESS_HTML = renderOAuthResultPage('success');
const ERROR_HTML = renderOAuthResultPage('error');

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost';
}

function parseRedirectUri(redirectUri: string): { host: string; bindHost: string; port: number; path: string } {
  const parsed = new URL(redirectUri);
  if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
    throw new Error('OAuth redirectUri must use http loopback');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('OAuth redirectUri must not include query or fragment');
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('OAuth redirectUri must include a valid port');
  }
  const path = parsed.pathname.trim() || '/';
  return {
    host: parsed.hostname.toLowerCase(),
    bindHost: parsed.hostname.toLowerCase() === 'localhost' ? '127.0.0.1' : parsed.hostname.toLowerCase(),
    port,
    path,
  };
}

function normalizeCallbackTarget(target: string, expectedPath: string): URL | null {
  const normalizedTarget = target.trim();
  if (!normalizedTarget || !normalizedTarget.startsWith('/') || normalizedTarget.startsWith('//') || normalizedTarget.includes('#')) {
    return null;
  }
  try {
    const parsed = new URL(`http://localhost${normalizedTarget}`);
    if (parsed.pathname !== expectedPath) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readCallbackParams(request: IncomingMessage, expectedPath: string): Promise<URLSearchParams | null> {
  const normalizedTarget = normalizeCallbackTarget(request.url || '/', expectedPath);
  if (!normalizedTarget) {
    return null;
  }

  const method = String(request.method || 'GET').trim().toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`OAuth callback only supports GET or POST, got ${method}`);
  }

  const params = new URLSearchParams(normalizedTarget.search);
  if (method === 'POST') {
    const body = await readRequestBody(request);
    const bodyParams = new URLSearchParams(body);
    bodyParams.forEach((value, key) => {
      params.set(key, value);
    });
  }

  return params;
}

function writeHtmlResponse(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

/**
 * Start an HTTP server on 127.0.0.1 listening for an OAuth callback.
 * Extracts `code` and `state` from the callback query params.
 */
export function listenForOAuthCallback(options: {
  redirectUri: string;
  timeoutMs: number;
}): Promise<LoopbackListenerResult> {
  return new Promise((resolve, reject) => {
    const redirect = parseRedirectUri(options.redirectUri);

    let settled = false;

    const server = http.createServer((req, res) => {
      void (async () => {
        if (settled) {
          res.writeHead(404);
          res.end();
          return;
        }

        let params: URLSearchParams | null;
        try {
          params = await readCallbackParams(req, redirect.path);
        } catch {
          writeHtmlResponse(res, 400, ERROR_HTML);
          return;
        }

        if (!params) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const code = String(params.get('code') || '').trim();
        const state = String(params.get('state') || '').trim();
        const error = String(params.get('error') || '').trim();

        if (error) {
          settled = true;
          writeHtmlResponse(res, 200, ERROR_HTML);
          cleanup();
          resolve({ error, state: state || undefined });
          return;
        }

        if (!code) {
          writeHtmlResponse(res, 400, ERROR_HTML);
          return;
        }

        settled = true;
        writeHtmlResponse(res, 200, SUCCESS_HTML);
        cleanup();
        resolve({ code, state: state || undefined });
      })().catch((error: unknown) => {
        if (settled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        writeHtmlResponse(res, 400, ERROR_HTML);
        cleanup();
        settled = true;
        reject(new Error(`Loopback listener error: ${message}`));
      });
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Timed out waiting for OAuth callback'));
      }
    }, options.timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Loopback listener error: ${err.message}`));
      }
    });

    server.listen(redirect.port, redirect.bindHost);
  });
}
