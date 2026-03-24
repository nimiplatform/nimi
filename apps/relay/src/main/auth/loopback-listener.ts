// RL-BOOT-005 — Loopback OAuth Listener
// Node.js HTTP server that captures OAuth callback on 127.0.0.1

import http from 'node:http';
import { renderDesktopOAuthResultPage } from '@nimiplatform/shell-auth/native-oauth-result-page';

export interface LoopbackListenerResult {
  code: string;
  state: string;
}

const SUCCESS_HTML = renderDesktopOAuthResultPage({ status: 'success' });
const ERROR_HTML = renderDesktopOAuthResultPage({ status: 'error' });

/**
 * Start an HTTP server on 127.0.0.1 listening for an OAuth callback.
 * Extracts `code` and `state` from the callback query params.
 */
export function listenForOAuthCallback(options: {
  redirectUri: string;
  timeoutMs: number;
}): Promise<LoopbackListenerResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(options.redirectUri);
    const port = Number(parsed.port);
    const expectedPath = parsed.pathname;

    let settled = false;

    const server = http.createServer((req, res) => {
      if (settled) {
        res.writeHead(404);
        res.end();
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);

      if (reqUrl.pathname !== expectedPath) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(ERROR_HTML);
        return;
      }

      settled = true;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);

      cleanup();
      resolve({ code, state: state || '' });
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

    server.listen(port, '127.0.0.1');
  });
}
