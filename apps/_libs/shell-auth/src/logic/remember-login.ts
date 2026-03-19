import type { RememberedLogin } from '../types/auth-types.js';

export const REMEMBER_LOGIN_KEY = 'nimi.rememberLogin';

export function loadRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(REMEMBER_LOGIN_KEY);
    if (stored) {
      return JSON.parse(stored) as RememberedLogin;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function saveRememberedLogin(login: RememberedLogin): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify(login));
  } catch {
    // ignore storage errors
  }
}

export function clearRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
  } catch {
    // ignore clear errors
  }
}
