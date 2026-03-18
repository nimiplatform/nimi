// RL-BOOT-005 — Desktop Browser Auth Flow
// Opens system browser for web login, captures token via loopback callback

import { shell } from 'electron';
import { listenForOAuthCallback } from './loopback-listener.js';

const DESKTOP_CALLBACK_PATH = '/oauth/callback';
const DESKTOP_CALLBACK_TIMEOUT_MS = 300_000;

function createCallbackState(): string {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `desktop-${Date.now().toString(36)}-${entropy}`;
}

function createCallbackRedirectUri(): string {
  const port = 43_000 + Math.floor(Math.random() * 10_000);
  return `http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`;
}

function buildLaunchUrl(options: {
  webUrl: string;
  callbackUrl: string;
  state: string;
}): string {
  const url = new URL(options.webUrl);

  // Web app uses hash routing — inject params into hash query
  if (url.hash) {
    const hashRaw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [hashPathRaw = '', hashQueryRaw = ''] = hashRaw.split('?');
    const hashPath = hashPathRaw.trim() || '/login';
    const hashQuery = new URLSearchParams(hashQueryRaw);
    hashQuery.set('desktop_callback', options.callbackUrl);
    hashQuery.set('desktop_state', options.state);
    url.hash = `#${hashPath}?${hashQuery.toString()}`;
    return url.toString();
  }

  // Non-hash routing fallback
  url.searchParams.set('desktop_callback', options.callbackUrl);
  url.searchParams.set('desktop_state', options.state);
  return url.toString();
}

/**
 * Perform desktop browser auth:
 * 1. Generate random loopback callback URL + CSRF state
 * 2. Open system browser to web login page
 * 3. Wait for loopback callback with access token
 * 4. Validate state and return token
 */
export async function performDesktopBrowserAuth(options: {
  webUrl: string;
}): Promise<{ accessToken: string }> {
  const callbackUrl = createCallbackRedirectUri();
  const state = createCallbackState();

  // Normalize web URL — ensure it has a login hash path
  let webUrl = options.webUrl;
  try {
    const parsed = new URL(webUrl);
    if (!parsed.hash) {
      parsed.hash = '#/login';
    }
    webUrl = parsed.toString();
  } catch {
    throw new Error(`无效的 NIMI_WEB_URL: ${webUrl}`);
  }

  const launchUrl = buildLaunchUrl({ webUrl, callbackUrl, state });

  // Start listener BEFORE opening browser
  const listenerPromise = listenForOAuthCallback({
    redirectUri: callbackUrl,
    timeoutMs: DESKTOP_CALLBACK_TIMEOUT_MS,
  });

  // Open system browser
  await shell.openExternal(launchUrl);

  // Wait for callback
  const result = await listenerPromise;

  // Validate state
  if (result.state !== state) {
    throw new Error('OAuth state 不匹配，可能存在 CSRF 攻击');
  }

  // The web app sends the accessToken as the "code" param
  if (!result.code) {
    throw new Error('缺少 access token');
  }

  return { accessToken: result.code };
}
