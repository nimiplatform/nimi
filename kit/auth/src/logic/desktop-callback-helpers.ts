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

const DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID = 'nimi-desktop-callback-success-overlay';
const DESKTOP_CALLBACK_SUCCESS_STYLE_ID = 'nimi-desktop-callback-success-style';
const DESKTOP_CALLBACK_SUCCESS_CLOSE_DELAY_MS = 3000;

function closeWindowSafely(): void {
  if (typeof window !== 'undefined' && typeof window.close === 'function') {
    window.close();
  }
}

function showDesktopCallbackSuccessState(): void {
  if (typeof document === 'undefined' || !document.body) {
    closeWindowSafely();
    return;
  }

  if (!document.getElementById(DESKTOP_CALLBACK_SUCCESS_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = DESKTOP_CALLBACK_SUCCESS_STYLE_ID;
    style.textContent = `
      #${DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(248, 250, 252, 0.88);
        backdrop-filter: blur(8px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID} .nimi_desktop_callback_card {
        width: min(460px, calc(100vw - 48px));
        padding: 32px 28px;
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.16);
        text-align: center;
        color: #0f172a;
      }
      #${DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID} .nimi_desktop_callback_badge {
        width: 52px;
        height: 52px;
        margin: 0 auto 18px;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #ffffff;
        font-size: 28px;
        font-weight: 700;
      }
      #${DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID} .nimi_desktop_callback_title {
        margin: 0;
        font-size: 24px;
        font-weight: 700;
        line-height: 1.2;
      }
      #${DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID} .nimi_desktop_callback_message {
        margin: 12px 0 0;
        color: #475569;
        font-size: 15px;
        line-height: 1.6;
      }
    `;
    document.head?.appendChild(style);
  }

  document.getElementById(DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = DESKTOP_CALLBACK_SUCCESS_OVERLAY_ID;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="nimi_desktop_callback_card">
      <div class="nimi_desktop_callback_badge">✓</div>
      <h1 class="nimi_desktop_callback_title">Authentication Complete!</h1>
      <p class="nimi_desktop_callback_message">You have successfully signed in to Nimi. This window will close in a moment.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    window.setTimeout(() => {
      closeWindowSafely();
    }, DESKTOP_CALLBACK_SUCCESS_CLOSE_DELAY_MS);
    return;
  }

  closeWindowSafely();
}

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

export function hasDesktopCallbackRequestInLocation(
  locationLike: Pick<Location, 'search' | 'hash'> | null | undefined = typeof window !== 'undefined'
    ? window.location
    : null,
): boolean {
  if (!locationLike) {
    return false;
  }

  const params = new URLSearchParams(String(locationLike.search || ''));
  const hash = String(locationLike.hash || '');
  const queryStart = hash.indexOf('?');
  if (queryStart >= 0) {
    const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
  }

  return Boolean(String(params.get('desktop_callback') || '').trim());
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

  const encodedBody = new URLSearchParams(Array.from(fields.entries())).toString();
  if (typeof window !== 'undefined' && typeof window.navigator?.sendBeacon === 'function') {
    const accepted = window.navigator.sendBeacon(
      normalizedCallbackUrl,
      new Blob([encodedBody], {
        type: 'application/x-www-form-urlencoded;charset=UTF-8',
      }),
    );
    if (accepted) {
      showDesktopCallbackSuccessState();
      return;
    }
  }

  const submissionTargetName = `nimiDesktopCallbackSink_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.name = submissionTargetName;
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = normalizedCallbackUrl;
  form.target = submissionTargetName;
  form.style.display = 'none';

  for (const [name, value] of fields) {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    field.value = value;
    form.appendChild(field);
  }

  document.body.appendChild(iframe);
  document.body.appendChild(form);
  form.submit();
  showDesktopCallbackSuccessState();
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
