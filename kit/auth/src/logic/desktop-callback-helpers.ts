import { toErrorMessage } from '@nimiplatform/nimi-kit/core/oauth';
import type { DesktopCallbackRequest } from '../types/auth-types.js';
import {
  normalizeLoopbackCallbackUrl,
  createDesktopCallbackState as createSharedDesktopCallbackState,
  validateDesktopCallbackState as validateSharedDesktopCallbackState,
  createDesktopCallbackRedirectUri as createSharedDesktopCallbackRedirectUri,
  readEnv,
} from '@nimiplatform/nimi-kit/core/oauth';
import { AUTH_COPY } from './auth-copy.js';

export function readLocationQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }

  const params = new URLSearchParams(window.location.search);
  const hash = String(window.location.hash || '');
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) {
    return params;
  }

  const hashQuery = hash.slice(queryStart + 1);
  const hashParams = new URLSearchParams(hashQuery);
  hashParams.forEach((value, key) => {
    params.set(key, value);
  });
  return params;
}

export function resolveDesktopCallbackRequestFromLocation(): DesktopCallbackRequest | null {
  const params = readLocationQueryParams();
  const callbackUrl = normalizeLoopbackCallbackUrl(String(params.get('desktop_callback') || ''));
  if (!callbackUrl) {
    return null;
  }

  return {
    callbackUrl,
    state: String(params.get('desktop_state') || '').trim(),
  };
}

export function buildDesktopCallbackReturnUrl(input: {
  request: DesktopCallbackRequest;
  accessToken: string;
}): string {
  const normalizedCallbackUrl = normalizeLoopbackCallbackUrl(input.request.callbackUrl);
  if (!normalizedCallbackUrl) {
    throw new Error('Desktop callback URL must resolve to an allowed loopback address');
  }
  const callbackUrl = new URL(normalizedCallbackUrl);
  callbackUrl.searchParams.set('code', input.accessToken);
  if (input.request.state) {
    callbackUrl.searchParams.set('state', input.request.state);
  }
  return callbackUrl.toString();
}

export function submitDesktopCallbackResult(input: {
  request: DesktopCallbackRequest;
  code?: string;
  state?: string;
  error?: string;
}): void {
  if (typeof document === 'undefined') {
    throw new Error('Desktop callback POST requires a browser document context');
  }
  const normalizedCallbackUrl = normalizeLoopbackCallbackUrl(input.request.callbackUrl);
  if (!normalizedCallbackUrl) {
    throw new Error('Desktop callback URL must resolve to an allowed loopback address');
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = normalizedCallbackUrl;
  form.style.display = 'none';

  const fields = new Map<string, string>();
  const code = String(input.code || '').trim();
  if (code) {
    fields.set('code', code);
  }
  const state = String(input.state || input.request.state || '').trim();
  if (state) {
    fields.set('state', state);
  }
  const error = String(input.error || '').trim();
  if (error) {
    fields.set('error', error);
  }

  for (const [name, value] of fields) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    field.value = value;
    form.appendChild(field);
  }

  document.body.appendChild(form);
  form.submit();
}

export function createDesktopCallbackState(): string {
  return createSharedDesktopCallbackState('desktop-web-auth');
}

export function validateDesktopCallbackState(input: {
  expectedState: string;
  actualState: string;
  maxAgeMs?: number;
  nowMs?: number;
}): boolean {
  return validateSharedDesktopCallbackState({
    ...input,
    flowKind: 'desktop-web-auth',
  });
}

export function createDesktopCallbackRedirectUri(): string {
  return createSharedDesktopCallbackRedirectUri();
}

export function normalizeWebAuthLaunchPath(input: URL): URL {
  const normalized = new URL(input.toString());
  if (!normalized.hash) {
    normalized.hash = '#/login';
  }
  return normalized;
}

export function resolveDesktopWebAuthLaunchBaseUrl(inputBaseUrl?: string): string {
  const baseUrl = String(inputBaseUrl || readEnv('NIMI_WEB_URL') || 'http://localhost').trim();

  try {
    const parsed = normalizeWebAuthLaunchPath(new URL(baseUrl));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(AUTH_COPY.desktopBrowserLaunchProtocolInvalid);
    }

    return parsed.toString();
  } catch (error) {
    throw new Error(
      `无效的 NIMI_WEB_URL：${toErrorMessage(error, '配置解析失败')}`,
      { cause: error },
    );
  }
}

export function buildDesktopWebAuthLaunchUrl(input: {
  callbackUrl: string;
  state: string;
  baseUrl?: string;
}): string {
  const url = new URL(resolveDesktopWebAuthLaunchBaseUrl(input.baseUrl));
  if (url.hash) {
    const hashRaw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [hashPathRaw = '', hashQueryRaw = ''] = hashRaw.split('?');
    const hashPath = hashPathRaw.trim() || '/login';
    const hashQuery = new URLSearchParams(hashQueryRaw);
    hashQuery.set('desktop_callback', input.callbackUrl);
    hashQuery.set('desktop_state', input.state);
    const encodedHashQuery = hashQuery.toString();
    url.hash = encodedHashQuery ? `#${hashPath}?${encodedHashQuery}` : `#${hashPath}`;
    return url.toString();
  }

  url.searchParams.set('desktop_callback', input.callbackUrl);
  url.searchParams.set('desktop_state', input.state);
  return url.toString();
}
