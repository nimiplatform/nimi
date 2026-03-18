import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { runForgeBootstrap } from '@renderer/infra/bootstrap/forge-bootstrap.js';
import { getPlatformClient } from '@runtime/platform-client.js';
import { forgeTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import { handleSocialLogin, type SocialOauthProvider } from '@nimiplatform/shell-core/oauth';

function LoginForm() {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const onOAuthLogin = useCallback(async (provider: SocialOauthProvider) => {
    setError('');
    setSubmitting(true);

    await handleSocialLogin({
      provider,
      bridge: forgeTauriOAuthBridge,
      realmRequest: async (method, path, body) => {
        const { realm } = getPlatformClient();
        return realm.raw.request<Record<string, unknown>>({
          method: method as 'POST',
          path,
          body,
        });
      },
      onSuccess: (result) => {
        applyAuthTokens({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        });
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
        <h2 className="text-lg font-semibold text-center">
          {t('auth.loginTitle', 'Sign in to Forge')}
        </h2>
        <p className="text-xs text-neutral-400 text-center">
          {t('auth.oauthHint', 'Sign in with your social account to continue.')}
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
          {submitting ? t('auth.signingIn', 'Signing in...') : t('auth.signInTwitter', 'Sign in with X')}
        </button>

        <button
          onClick={() => void onOAuthLogin('TIKTOK')}
          disabled={submitting}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48V13a8.28 8.28 0 005.58 2.17v-3.45a4.85 4.85 0 01-2.41-.65V6.69h2.41z" />
          </svg>
          {t('auth.signInTikTok', 'Sign in with TikTok')}
        </button>
      </div>
    </div>
  );
}

function applyAuthTokens(tokens: Record<string, unknown>) {
  const accessToken = String(tokens.accessToken || '');
  const refreshToken = String(tokens.refreshToken || '');
  const user = tokens.user as Record<string, unknown> | undefined;
  const store = useAppStore.getState();

  if (!accessToken || !user?.id) {
    store.clearAuthSession();
    try {
      getPlatformClient().realm.clearAuth();
    } catch {
      // Platform client may not be ready yet
    }
    return;
  }

  store.setAuthSession(
    {
      id: String(user.id),
      displayName: String(user.displayName || user.name || ''),
      email: user.email ? String(user.email) : undefined,
      avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
    },
    accessToken,
    refreshToken,
  );

  // Update realm client auth for subsequent requests
  try {
    const { realm } = getPlatformClient();
    realm.updateAuth({
      accessToken: () => String(useAppStore.getState().auth.token || ''),
      refreshToken: () => String(useAppStore.getState().auth.refreshToken || ''),
    });
  } catch {
    // Platform client may not be ready yet
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authStatus = useAppStore((s) => s.auth.status);
  const bootstrapReady = useAppStore((s) => s.bootstrapReady);
  const bootstrapError = useAppStore((s) => s.bootstrapError);

  useEffect(() => {
    void runForgeBootstrap();
  }, []);

  useEffect(() => {
    if (authStatus !== 'unauthenticated') {
      return;
    }
    try {
      getPlatformClient().realm.clearAuth();
    } catch {
      // Platform client may not be ready yet
    }
  }, [authStatus]);

  if (bootstrapError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">{t('bootstrap.error', { message: bootstrapError })}</p>
        </div>
      </div>
    );
  }

  if (!bootstrapReady || authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-neutral-400">{t('bootstrap.loading')}</p>
        </div>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <LoginForm />;
  }

  return <>{children}</>;
}
