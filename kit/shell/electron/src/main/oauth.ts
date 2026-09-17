import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';
import { asRecord, normalizeRequiredToken, normalizeText, parseOptionalPositiveNumber, standardNestedPayload } from './paths.js';

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
export type NimiElectronOauthTokenExchangeInput = {
  readonly provider: string;
  readonly clientId: string;
  readonly code: string;
  readonly codeVerifier?: string;
  readonly redirectUri?: string;
};

export type NimiElectronOauthTokenExchangeResult = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType?: string;
  readonly expiresIn?: number;
  readonly scope?: string;
};

export type NimiElectronOauthTokenExchangeFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>;

const MANAGED_CONNECTOR_OAUTH_COMMAND = 'connector_auth_acquire_managed_credential';

export async function exchangeElectronOauthTokenInHost(
  input: NimiElectronOauthTokenExchangeInput,
  fetcher: NimiElectronOauthTokenExchangeFetch = defaultElectronOauthTokenExchangeFetch,
  signal?: AbortSignal,
): Promise<NimiElectronOauthTokenExchangeResult> {
  throwIfElectronOauthAborted(signal);
  const command = MANAGED_CONNECTOR_OAUTH_COMMAND;
  const provider = parseElectronOauthTokenExchangeProvider(input.provider, command);
  const clientId = normalizeRequiredToken(input.clientId, 'clientId');
  const code = normalizeRequiredToken(input.code, 'code');
  const codeVerifier = normalizeRequiredToken(input.codeVerifier, 'codeVerifier');
  const redirectUri = normalizeRequiredToken(input.redirectUri, 'redirectUri');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  let response: Awaited<ReturnType<typeof fetcher>>;
  const url = electronOauthTokenExchangeUrl();
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal,
    });
  } catch (error) {
    throwIfElectronOauthAborted(signal);
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron OAuth token exchange request failed: ${errorMessage(error)}`,
      reasonCode: 'electron-oauth-token-exchange-request-failed',
      actionHint: 'retry_oauth_token_exchange_or_check_provider_status',
      details: { command, provider, cause: errorMessage(error) },
    });
  }
  throwIfElectronOauthAborted(signal);
  const text = await response.text();
  throwIfElectronOauthAborted(signal);
  if (!response.ok) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron OAuth token exchange failed with HTTP ${response.status}`,
      reasonCode: 'electron-oauth-token-exchange-http-failed',
      actionHint: 'retry_oauth_token_exchange_or_restart_authorization',
      details: { command, provider, status: response.status },
    });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = asRecord(JSON.parse(text) as unknown, 'Electron OAuth token response must be a JSON object') as Record<string, unknown>;
  } catch {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Electron OAuth token response is not valid JSON',
      reasonCode: 'electron-oauth-token-response-invalid-json',
      actionHint: 'check_oauth_provider_response',
      details: { command, provider },
    });
  }
  const accessToken = normalizeText(parsed.access_token);
  if (!accessToken) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Electron OAuth token response missing access_token',
      reasonCode: 'electron-oauth-token-response-missing-access-token',
      actionHint: 'check_oauth_provider_response',
      details: { command, provider },
    });
  }
  return {
    accessToken,
    refreshToken: normalizeText(parsed.refresh_token) || undefined,
    tokenType: normalizeText(parsed.token_type) || undefined,
    expiresIn: parseOptionalPositiveNumber(parsed.expires_in),
    scope: normalizeText(parsed.scope) || undefined,
  };
}
// @nimi-authority: rule.nimi.desktop.bridge-ipc.r021
export async function listenElectronOauthForCode(
  payload: Readonly<Record<string, unknown>>,
  command: string,
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
    server.listen(redirect.port, redirect.bindHost);
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
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;background:#fff;color:#1f2937}
    main{text-align:center;padding:32px}
    h1{margin:0 0 10px;font-size:24px}
    p{margin:0;color:#6b7280}
  </style>
</head>
<body>
  <main>
    <h1>Authorization received</h1>
    <p>Return to Nimi to finish signing in. This window will close shortly.</p>
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
type ElectronOauthTokenExchangeProvider = 'CODEX';

function parseElectronOauthTokenExchangeProvider(
  value: unknown,
  command: string,
): ElectronOauthTokenExchangeProvider {
  const provider = normalizeText(value).toUpperCase();
  if (provider === 'CODEX') {
    return provider;
  }
  throw new NimiElectronShellHostError({
    code: 'invalid-payload',
    message: `Electron OAuth token exchange provider is not admitted: ${provider || '<missing>'}`,
    reasonCode: 'electron-oauth-token-provider-not-admitted',
    actionHint: 'use_admitted_oauth_token_exchange_provider',
    details: { command, provider },
  });
}

function electronOauthTokenExchangeUrl(): string {
  return 'https://auth.openai.com/oauth/token';
}

async function defaultElectronOauthTokenExchangeFetch(
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
): Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }> {
  return fetch(url, init);
}

function throwIfElectronOauthAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Electron OAuth token exchange was canceled', 'AbortError');
  }
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
