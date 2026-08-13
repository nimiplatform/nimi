import type { WebAccountAuthWindow } from '../types/auth-types.js';
import { readEnv } from './oauth-helpers.js';
import { AUTH_COPY } from './auth-copy.js';

export function getGoogleClientId(): string {
  return (
    readEnv('VITE_NIMI_GOOGLE_CLIENT_ID')
    || readEnv('VITE_GOOGLE_CLIENT_ID')
    || readEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID')
  );
}

export function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error(AUTH_COPY.googleInitFailed));
      return;
    }

    const win = window as WebAccountAuthWindow;
    if (win.google?.accounts?.id?.initialize && win.google.accounts.id.prompt) {
      resolve();
      return;
    }

    const existingScript = document.getElementById('google-identity-services');
    if (existingScript) {
      if (existingScript.getAttribute('data-loaded') === 'true') {
        resolve();
        return;
      }
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () =>
        reject(new Error(AUTH_COPY.googleScriptLoadFailed)));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.setAttribute('data-loaded', 'true');
      resolve();
    };
    script.onerror = () => reject(new Error(AUTH_COPY.googleScriptLoadFailed));
    document.head.appendChild(script);
  });
}

export async function requestGoogleIdToken(clientId: string): Promise<string> {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    throw new Error(AUTH_COPY.googleClientIdMissing);
  }
  await loadGoogleScript();
  const win = window as WebAccountAuthWindow;
  const googleIdentity = win.google?.accounts?.id;
  if (!googleIdentity?.initialize || !googleIdentity.prompt) {
    throw new Error(AUTH_COPY.googleOAuthInitFailed);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    googleIdentity.initialize?.({
      client_id: normalizedClientId,
      callback: (response) => {
        const idToken = String(response?.credential || '').trim();
        if (!idToken) {
          fail(AUTH_COPY.googleIdTokenMissing);
          return;
        }
        if (settled) return;
        settled = true;
        resolve(idToken);
      },
    });
    googleIdentity.prompt?.((notification) => {
      if (
        notification.isNotDisplayed?.()
        || notification.isSkippedMoment?.()
      ) {
        fail(AUTH_COPY.googleInitFailed);
      }
    });
  });
}
