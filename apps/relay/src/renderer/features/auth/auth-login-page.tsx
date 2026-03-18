// RL-BOOT-005 — OAuth-only in-app login page

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { getBridge } from '../../bridge/electron-bridge.js';

export function AuthLoginPage() {
  const { t } = useTranslation();
  const authState = useAppStore((s) => s.authState);
  const authError = useAppStore((s) => s.authError);
  const [loading, setLoading] = useState(false);

  const handleBrowserLogin = useCallback(async () => {
    setLoading(true);
    try {
      const bridge = getBridge();
      await bridge.auth.browserLogin();
    } catch {
      // Error state pushed via IPC event
    } finally {
      setLoading(false);
    }
  }, []);

  const isAuthenticating = authState === 'authenticating' || loading;

  return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
      <div className="text-center max-w-sm px-6 space-y-6">
        {/* Brand */}
        <div>
          <div className="text-2xl font-bold tracking-tight mb-1">
            {t('app.name')}
          </div>
          <div className="text-sm text-gray-500">
            {t('auth.welcome')}
          </div>
        </div>

        {/* Pending — show login button */}
        {authState === 'pending' && !loading && (
          <button
            onClick={handleBrowserLogin}
            className="w-full px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition-colors"
          >
            {t('auth.browserLogin')}
          </button>
        )}

        {/* Authenticating — waiting for browser */}
        {isAuthenticating && (
          <div className="space-y-3">
            <div className="flex justify-center">
              <div className="h-5 w-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-sm text-gray-400">
              {t('auth.authenticating')}
            </div>
          </div>
        )}

        {/* Failed — show error + retry */}
        {authState === 'failed' && !loading && (
          <div className="space-y-4">
            <div className="text-sm text-red-400">
              {authError || t('auth.failed')}
            </div>
            <button
              onClick={handleBrowserLogin}
              className="w-full px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition-colors"
            >
              {t('auth.retry')}
            </button>
          </div>
        )}

        {/* Checking (brief transient state) */}
        {authState === 'authenticated' && (
          <div className="text-sm text-gray-400">
            {t('auth.checking')}
          </div>
        )}
      </div>
    </div>
  );
}
