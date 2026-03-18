import { useState, useCallback } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { overtoneTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import { initRealmInstance } from '@renderer/bridge/realm-sdk.js';
import { handleSocialLogin, readEnv, type SocialOauthProvider } from '@nimiplatform/shell-core/oauth';

export function OvertoneLogin() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const onOAuthLogin = useCallback(async (provider: SocialOauthProvider) => {
    setError('');
    setSubmitting(true);

    const baseUrl = String(readEnv('VITE_NIMI_REALM_BASE_URL') || '').trim();
    if (!baseUrl) {
      setError('Missing VITE_NIMI_REALM_BASE_URL configuration');
      setSubmitting(false);
      return;
    }

    // Initialize a temporary realm instance for the login request
    const tempRealm = initRealmInstance(baseUrl, '');

    await handleSocialLogin({
      provider,
      bridge: overtoneTauriOAuthBridge,
      realmRequest: async (method, path, body) => {
        const url = `${baseUrl}${path}`;
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Request failed: HTTP ${response.status} ${text.slice(0, 200)}`);
        }
        return response.json() as Promise<Record<string, unknown>>;
      },
      onSuccess: (result) => {
        const store = useAppStore.getState();
        const user = result.user;
        store.setAuthSession(
          {
            id: String(user.id || ''),
            displayName: String(user.displayName || user.name || ''),
          },
          result.accessToken,
          result.refreshToken,
        );

        // Re-initialize realm with the real token
        initRealmInstance(baseUrl, result.accessToken);
        store.setRealmConnection(true, true);
        setSubmitting(false);
      },
      onError: (message) => {
        setError(message);
        setSubmitting(false);
      },
    });
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
      <div className="w-80 space-y-4">
        <h2 className="text-lg font-semibold text-center">Sign in to Overtone</h2>
        <p className="text-xs text-neutral-400 text-center">
          Sign in with your social account to continue.
        </p>
        {error && <p className="text-sm text-red-400 text-center">{error}</p>}

        <button
          onClick={() => void onOAuthLogin('TWITTER')}
          disabled={submitting}
          className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          {submitting ? 'Signing in...' : 'Sign in with X'}
        </button>

        <button
          onClick={() => void onOAuthLogin('TIKTOK')}
          disabled={submitting}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48V13a8.28 8.28 0 005.58 2.17v-3.45a4.85 4.85 0 01-2.41-.65V6.69h2.41z" />
          </svg>
          Sign in with TikTok
        </button>
      </div>
    </div>
  );
}
