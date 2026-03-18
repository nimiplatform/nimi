// RL-BOOT-005 — Loopback OAuth Listener
// Node.js HTTP server that captures OAuth callback on 127.0.0.1

import http from 'node:http';

export interface LoopbackListenerResult {
  code: string;
  state: string;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权成功</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:2rem}.check{font-size:3rem;margin-bottom:1rem}p{color:#999;margin-top:.5rem}</style>
</head><body><div class="card"><div class="check">✓</div><h2>授权成功</h2><p>可以关闭此浏览器窗口</p></div></body></html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权失败</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:2rem}.icon{font-size:3rem;margin-bottom:1rem}p{color:#999;margin-top:.5rem}</style>
</head><body><div class="card"><div class="icon">✗</div><h2>授权失败</h2><p>请返回应用重试</p></div></body></html>`;

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
        reject(new Error('等待 OAuth 回调超时'));
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
