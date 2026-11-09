import { readRuntimeConnectRequest, runtimeConnectSearch } from './runtime-connect-request.js';

export const accountDestinations = [
  '/account',
  '/account/profile',
  '/account/friends',
  '/account/privacy',
  '/account/security',
  '/account/sessions',
  '/account/runtime',
  '/account/connect',
  '/account/data',
  '/account/delete',
] as const;
export type AccountDestination = (typeof accountDestinations)[number];

export function accountHandle(value: unknown): string {
  return String(value ?? '').replace(/^@/, '');
}

function admittedDestination(value: string | null): string {
  const [path, search = ''] = String(value || '').split('?');
  const admitted = accountDestinations.find((item) => item === path) ?? '/account';
  if (admitted === '/account/connect') {
    const request = readRuntimeConnectRequest(search);
    return request ? `${admitted}?${runtimeConnectSearch(request)}` : '/account';
  }
  const view = new URLSearchParams(search).get('view');
  const intent = new URLSearchParams(search).get('intent');
  if (admitted === '/account/runtime') {
    const callback = new URLSearchParams(search);
    const state = callback.get('state');
    if ([...callback].length === 2 && state && /^[A-Za-z0-9_-]{43}$/.test(state)
      && (/^[A-Za-z0-9_-]{43}$/.test(callback.get('code') || '') || callback.get('error') === 'access_denied')) {
      return `${admitted}?${callback.toString()}`;
    }
  }
  if (admitted === '/account/runtime' && intent && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intent)) {
    return `${admitted}?intent=${encodeURIComponent(intent)}`;
  }
  return admitted === '/account/friends' && view && ['received', 'sent', 'blocked'].includes(view)
    ? `${admitted}?view=${view}`
    : admitted;
}

/** Ordinary account navigation is separate from an owner-issued OAuth continuation. */
export function accountReturnTo(search: string): string {
  const value = new URLSearchParams(search).get('returnTo');
  return admittedDestination(value);
}

export function accountLoginUrl(path: string, search = ''): string {
  const admitted = admittedDestination(path + search);
  return `/login?returnTo=${encodeURIComponent(admitted)}`;
}

export function profilePatch(
  original: Record<string, unknown>,
  draft: { displayName: string; bio: string; city: string; countryCode: string },
) {
  return Object.fromEntries(
    Object.entries(draft)
      .filter(([key, value]) => value !== String(original[key] ?? ''))
      .map(([key, value]) => [key, key === 'displayName' ? value.trim() : value.trim() || null]),
  );
}
