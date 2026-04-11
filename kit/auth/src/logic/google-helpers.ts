import type { ShellAuthWindow } from '../types/auth-types.js';
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

    const win = window as ShellAuthWindow;
    if (win.google?.accounts?.oauth2?.initTokenClient) {
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
