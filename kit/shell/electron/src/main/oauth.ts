import { createServer, type IncomingMessage } from 'node:http';
import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';
import { asRecord, normalizeRequiredToken, normalizeText, parseOptionalPositiveNumber, standardNestedPayload } from './paths.js';

const ELECTRON_OAUTH_SUCCESS_AUTO_CLOSE_MS = 3000;

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
export async function exchangeElectronOauthToken(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<Record<string, unknown>> {
  const commandPayload = standardNestedPayload(payload, command);
  const provider = parseElectronOauthTokenExchangeProvider(commandPayload.provider, command);
  const clientId = normalizeRequiredToken(commandPayload.clientId, 'clientId');
  const code = normalizeRequiredToken(commandPayload.code, 'code');
  const codeVerifier = normalizeRequiredToken(commandPayload.codeVerifier, 'codeVerifier');
  const redirectUri = normalizeRequiredToken(commandPayload.redirectUri, 'redirectUri');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  if (provider === 'TIKTOK') {
    body.set('client_key', clientId);
  }
  const fetcher = host?.oauthTokenExchangeFetch ?? defaultElectronOauthTokenExchangeFetch;
  let response: Awaited<ReturnType<typeof fetcher>>;
  const url = electronOauthTokenExchangeUrl(provider);
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (error) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron OAuth token exchange request failed: ${errorMessage(error)}`,
      reasonCode: 'electron-oauth-token-exchange-request-failed',
      actionHint: 'retry_oauth_token_exchange_or_check_provider_status',
      details: { command, provider, cause: errorMessage(error) },
    });
  }
  const text = await response.text();
  if (!response.ok) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron OAuth token exchange failed: HTTP ${response.status} body=${redactElectronOauthBodyPreview(text, 300)}`,
      reasonCode: 'electron-oauth-token-exchange-http-failed',
      actionHint: 'retry_oauth_token_exchange_or_restart_authorization',
      details: { command, provider, status: response.status },
    });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = asRecord(JSON.parse(text) as unknown, 'Electron OAuth token response must be a JSON object') as Record<string, unknown>;
  } catch (error) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: `Electron OAuth token response is not JSON: ${errorMessage(error)}`,
      reasonCode: 'electron-oauth-token-response-invalid-json',
      actionHint: 'check_oauth_provider_response',
      details: { command, provider, cause: errorMessage(error) },
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
    raw: parsed,
  };
}
export async function listenElectronOauthForCode(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<Record<string, unknown>> {
  const commandPayload = standardNestedPayload(payload, command);
  const redirect = parseElectronOauthRedirectUri(normalizeRequiredToken(commandPayload.redirectUri, 'redirectUri'), command);
  const timeoutMs = clampNumber(parseOptionalPositiveNumber(commandPayload.timeoutMs) ?? 180_000, 10_000, 600_000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((request, response) => {
      void handleElectronOauthCallbackRequest(request, redirect)
        .then((result) => {
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'close',
          });
          response.end(renderElectronOauthSuccessPage());
          settle(undefined, result);
        })
        .catch((error: unknown) => {
          response.writeHead(400, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'close',
          });
          response.end(errorMessage(error));
        });
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

    const settle = (error?: unknown, value?: Record<string, unknown>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close(() => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value ?? {});
      });
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

function renderElectronOauthSuccessPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OAuth Complete - Nimi</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;background:#fff;color:#1f2937}
    main{text-align:center;padding:32px}
    h1{margin:0 0 10px;font-size:24px}
    p{margin:0;color:#6b7280}
  </style>
</head>
<body>
  <main>
    <h1>Authentication Complete!</h1>
    <p>You have successfully signed in to Nimi. This window will close shortly.</p>
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
  const isLoopbackHttp = parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
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
type ElectronOauthTokenExchangeProvider = 'CODEX' | 'TWITTER' | 'TIKTOK';

function parseElectronOauthTokenExchangeProvider(
  value: unknown,
  command: string,
): ElectronOauthTokenExchangeProvider {
  const provider = normalizeText(value).toUpperCase();
  if (provider === 'CODEX' || provider === 'TWITTER' || provider === 'TIKTOK') {
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

function electronOauthTokenExchangeUrl(provider: ElectronOauthTokenExchangeProvider): string {
  if (provider === 'CODEX') {
    return 'https://auth.openai.com/oauth/token';
  }
  if (provider === 'TWITTER') {
    return 'https://api.twitter.com/2/oauth2/token';
  }
  return 'https://open.tiktokapis.com/v2/oauth/token/';
}

async function defaultElectronOauthTokenExchangeFetch(
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
): Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }> {
  return fetch(url, init);
}

function redactElectronOauthBodyPreview(input: string, maxBytes: number): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      redactElectronOauthJsonValue(parsed);
      return previewElectronOauthText(JSON.stringify(parsed), maxBytes);
    } catch {
      return '<unparseable response body>';
    }
  }
  return '<unparseable response body>';
}

function redactElectronOauthJsonValue(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      redactElectronOauthJsonValue(item);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (isElectronOauthSensitiveKey(key)) {
      record[key] = '[REDACTED]';
    } else {
      redactElectronOauthJsonValue(record[key]);
    }
  }
}

function isElectronOauthSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized === 'authorization'
    || normalized === 'cookie'
    || normalized.includes('token')
    || normalized.includes('password')
    || normalized.includes('secret')
    || normalized.includes('api_key')
    || normalized.includes('apikey');
}

function previewElectronOauthText(input: string, maxBytes: number): string {
  if (input.length <= maxBytes) {
    return input;
  }
  let end = Math.min(input.length, maxBytes);
  while (end > 0 && input.charCodeAt(end) >= 0xDC00 && input.charCodeAt(end) <= 0xDFFF) {
    end -= 1;
  }
  return `${input.slice(0, end)}... (truncated, ${input.length} bytes total)`;
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
  if (parsed.protocol !== 'http:' || (host !== 'localhost' && host !== '127.0.0.1') || !Number.isInteger(port) || port <= 0) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `Electron OAuth redirectUri must be loopback http with an explicit port: ${value}`,
      reasonCode: 'electron-oauth-redirect-uri-not-loopback',
      actionHint: 'provide_loopback_http_redirect_uri',
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
    bindHost: host === 'localhost' ? '127.0.0.1' : host,
    port,
    expectedPath: parsed.pathname || '/',
  };
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

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
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
