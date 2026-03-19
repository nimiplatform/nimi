import type { GoogleWindow } from '../types/auth-types.js';
import { readEnv } from '@nimiplatform/shell-core/oauth';

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
      reject(new Error('window is undefined'));
      return;
    }

    const win = window as GoogleWindow;
    if (win.google?.accounts?.oauth2?.initTokenClient) {
      resolve();
      return;
    }

    const existingScript = document.getElementById('google-identity-services');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () =>
        reject(new Error('Failed to load Google Identity Services script')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.head.appendChild(script);
  });
}
