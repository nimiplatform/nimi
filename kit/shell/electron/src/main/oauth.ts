import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { NimiElectronShellHostError, type NimiElectronIpcMainInvokeEvent, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';
import { normalizeRequiredToken, normalizeText, parseOptionalPositiveNumber, standardNestedPayload } from './paths.js';

const ELECTRON_OAUTH_SUCCESS_AUTO_CLOSE_MS = 3000;
const ELECTRON_OAUTH_MAX_BODY_BYTES = 16 * 1024;
const ELECTRON_OAUTH_REQUEST_TIMEOUT_MS = 10_000;
const ELECTRON_OAUTH_RESPONSE_GRACE_MS = 1000;

export async function openElectronExternalUrl(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly opened: boolean }> {
  const opener = host?.openExternalUrl;
  if (!opener) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const commandPayload = standardNestedPayload(payload, command);
  const url = normalizeRequiredToken(commandPayload.url, 'url');
  const parsed = parseElectronExternalUrl(url, command);
  await opener(parsed.toString());
  return { opened: true };
}
export function createElectronOauthCallbackHost() {
  const pending = new Map<NimiElectronIpcMainInvokeEvent['sender'], Map<string, AbortController>>();
  return {
    async invoke(
      sender: NimiElectronIpcMainInvokeEvent['sender'],
      payload: Readonly<Record<string, unknown>>,
      command: string,
      authorize: () => Promise<void>,
    ) {
      const input = standardNestedPayload(payload, command);
      if (input.requestId === undefined && input.cancel === undefined) {
        await authorize();
        return listenElectronOauthForCode(input, command);
      }
      const { requestId, cancel } = input;
      if (!sender || typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId)
        || (cancel !== undefined && (cancel !== true || Object.keys(input).length !== 2))) {
        throw new NimiElectronShellHostError({
          code: 'invalid-payload', message: 'Invalid OAuth listener request', reasonCode: 'electron-oauth-listener-request-invalid', actionHint: 'retry_oauth_authorization',
        });
      }
      let senderWaits = pending.get(sender);
      if (cancel) {
        await authorize();
        // Identity is scoped both to this renderer and to its exact wait.
        const wait = senderWaits?.get(requestId);
        wait?.abort();
        return { canceled: Boolean(wait) };
      }
      if (!senderWaits) {
        senderWaits = new Map();
        pending.set(sender, senderWaits);
      }
      if (senderWaits.has(requestId)) {
        throw new NimiElectronShellHostError({
          code: 'invalid-payload', message: 'Duplicate OAuth listener request', reasonCode: 'electron-oauth-listener-request-duplicate', actionHint: 'retry_oauth_authorization',
        });
      }
      // Reserve before awaiting policy. An already-dispatched cancellation can
      // retire this entry even while authorization is pending.
      const wait = new AbortController();
      senderWaits.set(requestId, wait);
      const close = () => wait.abort();
      sender.on?.('destroyed', close);
      sender.on?.('render-process-gone', close);
      try {
        await authorize();
        return await listenElectronOauthForCode(input, command, wait.signal);
      } finally {
        sender.removeListener?.('destroyed', close);
        sender.removeListener?.('render-process-gone', close);
        senderWaits.delete(requestId);
        if (!senderWaits.size) pending.delete(sender);
      }
    },
    close() {
      for (const waits of pending.values()) {
        for (const wait of waits.values()) wait.abort();
      }
    },
  };
}

// @nimi-authority: rule.nimi.desktop.bridge-ipc.r021
export async function listenElectronOauthForCode(
  payload: Readonly<Record<string, unknown>>,
  command: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const commandPayload = standardNestedPayload(payload, command);
  const redirect = parseElectronOauthRedirectUri(normalizeRequiredToken(commandPayload.redirectUri, 'redirectUri'), command);
  const expectedState = normalizeRequiredToken(commandPayload.expectedState, 'expectedState');
  const timeoutMs = clampNumber(parseOptionalPositiveNumber(commandPayload.timeoutMs) ?? 180_000, 10_000, 600_000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const sockets = new Set<Socket>();
    const server = createServer({
      headersTimeout: ELECTRON_OAUTH_REQUEST_TIMEOUT_MS,
      requestTimeout: ELECTRON_OAUTH_REQUEST_TIMEOUT_MS,
      connectionsCheckingInterval: 1000,
    }, (request, response) => {
      // Teardown can abort another request, including a pipelined request on
      // the winning socket. Such late stream errors are connection-local.
      request.on('error', () => undefined);
      response.on('error', () => response.destroy());
      if (settled) return;
      void handleElectronOauthCallbackRequest(request, redirect)
        .then((result) => {
          if (settled) return;
          // Correlate carriage before consuming the listener. The Runtime
          // broker still owns full attempt validation and code exchange.
          if (result.state !== expectedState || (!result.code && !result.error)) {
            throw new Error('OAuth callback does not match the pending authorization');
          }
          const acceptedSocket = response.socket ?? undefined;
          sendElectronOauthResponse(response, 200, 'text/html; charset=utf-8', result.error
            ? '<!doctype html><title>Authorization failed</title><p>Authorization failed. Return to Nimi to try again.</p>'
            : renderElectronOauthSuccessPage());
          settle(undefined, result, acceptedSocket);
        })
        .catch((error: unknown) => {
          if (settled) return;
          sendElectronOauthResponse(response,
            error instanceof ElectronOauthRequestError ? error.status : 400,
            'text/plain; charset=utf-8', errorMessage(error));
        });
    });
    server.on('connection', (socket) => {
      if (settled) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    const timer = setTimeout(() => {
      settle(new NimiElectronShellHostError({
        code: 'host-internal-error',
        message: 'Electron OAuth callback timed out',
        reasonCode: 'electron-oauth-callback-timeout',
        actionHint: 'retry_oauth_authorization',
        details: { command, redirectUri: redirect.redirectUri, timeoutMs },
      }));
    }, timeoutMs);

    const settle = (error?: unknown, value?: Record<string, unknown>, acceptedSocket?: Socket) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      // The caller's result must never depend on another HTTP peer finishing.
      // Preserve only the accepted response's bounded flush window.
      server.close();
      for (const socket of sockets) {
        if (socket !== acceptedSocket) socket.destroy();
      }
      if (error) reject(error);
      else resolve(value ?? {});
    };

    server.once('error', (error) => {
      settle(new NimiElectronShellHostError({
        code: 'host-internal-error',
        message: `Electron OAuth callback listener failed: ${errorMessage(error)}`,
        reasonCode: 'electron-oauth-callback-listener-failed',
        actionHint: 'choose_available_loopback_redirect_port',
        details: { command, redirectUri: redirect.redirectUri, cause: errorMessage(error) },
      }));
    });
    const cancel = () => settle(new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Electron OAuth callback wait ended',
      reasonCode: 'electron-oauth-callback-canceled',
      actionHint: 'retry_oauth_authorization',
    }));
    if (signal?.aborted) cancel();
    else {
      signal?.addEventListener('abort', cancel, { once: true });
      server.listen(redirect.port, redirect.bindHost);
    }
  });
}

function sendElectronOauthResponse(response: ServerResponse, status: number, contentType: string, body: string): void {
  if (response.destroyed || response.writableEnded) return;
  const socket = response.socket;
  const cleanupTimer = setTimeout(() => socket?.destroy(), ELECTRON_OAUTH_RESPONSE_GRACE_MS);
  cleanupTimer.unref();
  socket?.once('close', () => clearTimeout(cleanupTimer));
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(body);
}

function renderElectronOauthSuccessPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorization received - Nimi</title>
  <style>
    :root{color-scheme:light dark;--bg:#f5f7fa;--card:#ffffff;--border:rgba(226,232,240,.9);--ink:#111827;--muted:#4b5563;--accent:#1476d4;--accent-hover:#1166b8}
    @media (prefers-color-scheme:dark){:root{--bg:#081019;--card:#162033;--border:rgba(148,163,184,.24);--ink:#f8fafc;--muted:#cbd5e1}}
    @media (prefers-contrast:more){:root{--border:currentColor}}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-optical-sizing:auto;display:grid;min-height:100vh;margin:0;padding:1.5rem;place-items:center;background:var(--bg);color:var(--ink)}
    main{max-width:26rem;width:100%;text-align:center;padding:2rem;border-radius:1rem;background:var(--card);border:1px solid var(--border)}
    h1{margin:0 0 .625rem;font-size:1.5rem;line-height:1.25;letter-spacing:-0.02em}
    p{margin:0 0 1.25rem;font-size:.9375rem;line-height:1.5;color:var(--muted)}
    button{min-height:2.5rem;padding:.5rem 1.25rem;border:none;border-radius:.75rem;background:var(--accent);color:#fff;font:600 .875rem/1 inherit;cursor:pointer;transition:background-color 120ms ease,transform 100ms ease}
    button:hover{background:var(--accent-hover)}
    button:active{transform:scale(.97)}
    button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    @media (prefers-reduced-motion:reduce){button{transition:none}button:active{transform:none}}
  </style>
</head>
<body>
  <main>
    <h1>Authorization received</h1>
    <p>Return to Nimi to finish signing in. You can safely close this tab.</p>
    <button type="button" onclick="window.close()">Close tab</button>
  </main>
  <script>setTimeout(function(){window.close();}, ${ELECTRON_OAUTH_SUCCESS_AUTO_CLOSE_MS});</script>
</body>
</html>`;
}

function parseElectronExternalUrl(value: string, command: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron OAuth external URL is invalid: ${errorMessage(error)}`,
      reasonCode: 'electron-oauth-external-url-invalid',
      actionHint: 'provide_absolute_https_or_loopback_http_url',
      details: { command, url: value, cause: errorMessage(error) },
    });
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopbackHttp = parsed.protocol === 'http:' && isElectronOauthLoopbackHost(host);
  if (isLoopbackHttp && isDesktopOpenReservedOauthUrl(parsed)) {
    throw new NimiElectronShellHostError({
      code: 'forbidden-renderer-access',
      message: `Electron OAuth external URL targets a reserved Desktop Open route: ${parsed.toString()}`,
      reasonCode: 'electron-oauth-external-url-not-allowed',
      actionHint: 'use_https_or_loopback_http_oauth_url',
      details: { command, url: parsed.toString() },
    });
  }
  if (parsed.protocol === 'https:' || isLoopbackHttp) {
    return parsed;
  }
  throw new NimiElectronShellHostError({
    code: 'forbidden-renderer-access',
    message: `Electron OAuth external URL is not allowed: ${parsed.toString()}`,
    reasonCode: 'electron-oauth-external-url-not-allowed',
    actionHint: 'use_https_or_loopback_http_oauth_url',
    details: { command, url: parsed.toString() },
  });
}
function parseElectronOauthRedirectUri(value: string, command: string): {
  readonly redirectUri: string;
  readonly bindHost: string;
  readonly port: number;
  readonly expectedPath: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron OAuth redirectUri is invalid: ${errorMessage(error)}`,
      reasonCode: 'electron-oauth-redirect-uri-invalid',
      actionHint: 'provide_loopback_http_redirect_uri',
      details: { command, redirectUri: value, cause: errorMessage(error) },
    });
  }
  const host = parsed.hostname.toLowerCase();
  const port = Number(parsed.port || (parsed.protocol === 'http:' ? 80 : 0));
  if (parsed.protocol !== 'http:' || !isElectronOauthLoopbackHost(host) || !Number.isInteger(port) || port <= 0) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron OAuth redirectUri must be loopback http with an explicit port: ${value}`,
      reasonCode: 'electron-oauth-redirect-uri-not-loopback',
      actionHint: 'provide_loopback_http_redirect_uri',
      details: { command, redirectUri: value },
    });
  }
  if (isDesktopOpenReservedOauthUrl(parsed)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron OAuth redirectUri targets a reserved Desktop Open route: ${value}`,
      reasonCode: 'electron-oauth-redirect-uri-reserved-desktop-open-route',
      actionHint: 'provide_non_desktop_open_redirect_uri',
      details: { command, redirectUri: value },
    });
  }
  if (parsed.search || parsed.hash) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron OAuth redirectUri must not include query or fragment',
      reasonCode: 'electron-oauth-redirect-uri-has-query-or-fragment',
      actionHint: 'provide_redirect_uri_without_query_or_fragment',
      details: { command, redirectUri: value },
    });
  }
  return {
    redirectUri: parsed.toString(),
    bindHost: host === 'localhost' ? '127.0.0.1' : normalizeElectronOauthBindHost(host),
    port,
    expectedPath: parsed.pathname || '/',
  };
}

function isDesktopOpenReservedOauthUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'http:' || !isElectronOauthLoopbackHost(host)) {
    return false;
  }
  const candidates = new Set<string>([parsed.pathname]);
  try {
    candidates.add(decodeURIComponent(parsed.pathname));
  } catch {
    // Keep the raw path candidate.
  }
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\/+$/u, '') || '/';
    const lower = normalized.toLowerCase();
    if (lower === '/v1/open-intent') {
      return true;
    }
    if (lower === '/__nimi_desktop_launch__' || lower.startsWith('/__nimi_desktop_launch__/')) {
      return true;
    }
    if (lower === '/desktop-open' || lower.startsWith('/desktop-open/')) {
      return true;
    }
  }
  return false;
}

function isElectronOauthLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function normalizeElectronOauthBindHost(host: string): string {
  return host === '[::1]' ? '::1' : host;
}

async function handleElectronOauthCallbackRequest(
  request: IncomingMessage,
  redirect: { readonly port: number; readonly expectedPath: string },
): Promise<Record<string, unknown>> {
  const method = normalizeText(request.method).toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`OAuth callback only supports GET or POST, got ${method || '<missing>'}`);
  }
  const requestUrl = new URL(request.url || '/', `http://localhost:${redirect.port}`);
  if (requestUrl.pathname !== redirect.expectedPath) {
    throw new Error(`OAuth callback path mismatch: expected=${redirect.expectedPath} actual=${requestUrl.pathname}`);
  }
  const params = new URLSearchParams(requestUrl.search);
  if (method === 'POST') {
    const body = await readRequestBody(request);
    for (const [key, value] of new URLSearchParams(body)) {
      params.set(key, value);
    }
  }
  const callbackUrl = `http://localhost:${redirect.port}${requestUrl.pathname}${requestUrl.search}`;
  const result: Record<string, unknown> = {
    callbackUrl,
  };
  addOptionalField(result, 'code', params.get('code'));
  addOptionalField(result, 'state', params.get('state'));
  addOptionalField(result, 'error', params.get('error'));
  return result;
}

class ElectronOauthRequestError extends Error {
  constructor(readonly status: 408 | 413, message: string) {
    super(message);
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers['content-length']) > ELECTRON_OAUTH_MAX_BODY_BYTES) {
    request.pause();
    return Promise.reject(new ElectronOauthRequestError(413, 'OAuth callback body exceeds 16 KiB'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('aborted', onAborted);
      request.off('error', onError);
      request.off('close', onAborted);
      if (error) {
        // Do not destroy the socket before its 408/413 response can flush.
        request.pause();
        reject(error);
      } else {
        resolve(Buffer.concat(chunks, totalBytes).toString('utf8'));
      }
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > ELECTRON_OAUTH_MAX_BODY_BYTES) {
        finish(new ElectronOauthRequestError(413, 'OAuth callback body exceeds 16 KiB'));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => finish();
    const onAborted = () => finish(new Error('OAuth callback request was closed before completion'));
    const onError = (error: Error) => finish(error);
    // An absolute deadline: receiving another byte must not extend it.
    const timer = setTimeout(() => finish(new ElectronOauthRequestError(408, 'OAuth callback body read timed out')),
      ELECTRON_OAUTH_REQUEST_TIMEOUT_MS);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
    request.once('close', onAborted);
  });
}

function addOptionalField(target: Record<string, unknown>, key: string, value: unknown): void {
  const normalized = normalizeText(value);
  if (normalized) {
    target[key] = normalized;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
