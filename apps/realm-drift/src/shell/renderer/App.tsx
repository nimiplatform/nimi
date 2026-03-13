import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { AppProviders } from '@renderer/app-shell/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/app-routes.js';
import { runDriftBootstrap } from '@renderer/infra/bootstrap/drift-bootstrap.js';
import { getPlatformClient } from '@runtime/platform-client.js';
import { useCallback, useState } from 'react';

function LoginForm() {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = useCallback(async () => {
    if (!identifier.trim() || !password.trim()) return;
    setError('');
    setSubmitting(true);

    try {
      const { realm } = getPlatformClient();
      const data = await realm.raw.request<Record<string, unknown>>({
        method: 'POST',
        path: '/api/auth/password/login',
        body: { identifier: identifier.trim(), password },
      });

      const state = String(data.loginState || '');

      if (state === 'blocked') {
        setError(String(data.blockedReason || t('auth.accountBlocked', 'Account is blocked')));
        setSubmitting(false);
        return;
      }

      if (state === 'needs_2fa') {
        setTempToken(String(data.tempToken || ''));
        setNeeds2fa(true);
        setSubmitting(false);
        return;
      }

      const tokens = data.tokens as Record<string, unknown> | undefined;
      if (!tokens?.accessToken) {
        setError(t('auth.loginFailed', 'Login failed'));
        setSubmitting(false);
        return;
      }

      applyAuthTokens(tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed', 'Login failed'));
      setSubmitting(false);
    }
  }, [identifier, password, t]);

  const handle2fa = useCallback(async () => {
    if (!twoFaCode.trim() || !tempToken) return;
    setError('');
    setSubmitting(true);

    try {
      const { realm } = getPlatformClient();
      const data = await realm.raw.request<Record<string, unknown>>({
        method: 'POST',
        path: '/api/auth/2fa/verify',
        body: { tempToken, code: twoFaCode.trim() },
      });

      const tokens = data.tokens as Record<string, unknown> | undefined;
      if (!tokens?.accessToken) {
        setError(t('auth.2faFailed', 'Verification failed'));
        setSubmitting(false);
        return;
      }

      applyAuthTokens(tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.2faFailed', 'Verification failed'));
      setSubmitting(false);
    }
  }, [twoFaCode, tempToken, t]);

  if (needs2fa) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="w-80 space-y-4">
          <h2 className="text-lg font-semibold text-center">
            {t('auth.twoFactorTitle', 'Two-Factor Authentication')}
          </h2>
          <p className="text-xs text-neutral-400 text-center">
            {t('auth.twoFactorHint', 'Enter the 6-digit code from your authenticator app.')}
          </p>
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={twoFaCode}
            onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') void handle2fa(); }}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-center text-lg tracking-widest text-white placeholder:text-neutral-600 focus:border-white focus:outline-none"
            autoFocus
          />
          <button
            onClick={() => void handle2fa()}
            disabled={submitting || twoFaCode.length < 6}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
          >
            {t('auth.verify', 'Verify')}
          </button>
          <button
            onClick={() => { setNeeds2fa(false); setTempToken(''); setTwoFaCode(''); setError(''); }}
            className="w-full text-sm text-neutral-500 hover:text-white transition-colors"
          >
            {t('auth.backToLogin', 'Back to login')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
      <div className="w-80 space-y-4">
        <h2 className="text-lg font-semibold text-center">{t('auth.loginTitle', 'Sign in to Realm Drift')}</h2>
        {error && <p className="text-sm text-red-400 text-center">{error}</p>}
        <input
          type="text"
          placeholder={t('auth.identifierPlaceholder', 'Email or handle')}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-white focus:outline-none"
          autoFocus
        />
        <input
          type="password"
          placeholder={t('auth.passwordPlaceholder', 'Password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-white focus:outline-none"
        />
        <button
          onClick={() => void handleLogin()}
          disabled={submitting || !identifier.trim() || !password.trim()}
          className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
        >
          {submitting
            ? t('auth.signingIn', 'Signing in...')
            : t('auth.login', 'Sign In')}
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

  try {
    const { realm } = getPlatformClient();
    const realmAny = realm as unknown as Record<string, unknown>;
    if (realmAny.config) {
      (realmAny.config as Record<string, unknown>).auth = { accessToken };
    }
  } catch {
    // Platform client may not be ready yet
  }
}

function DriftAuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authStatus = useAppStore((s) => s.auth.status);
  const bootstrapReady = useAppStore((s) => s.bootstrapReady);
  const bootstrapError = useAppStore((s) => s.bootstrapError);

  useEffect(() => {
    void runDriftBootstrap();
  }, []);

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

export function App() {
  return (
    <AppProviders>
      <DriftAuthGate>
        <AppRoutes />
      </DriftAuthGate>
    </AppProviders>
  );
}
