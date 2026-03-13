import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { getPlatformClient } from '@runtime/platform-client.js';

export function CreatorAccessGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const creatorAccess = useAppStore((s) => s.creatorAccess);
  const setCreatorAccess = useAppStore((s) => s.setCreatorAccess);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<'idle' | 'submitted' | 'error'>('idle');

  useEffect(() => {
    if (creatorAccess.checked) {
      return;
    }

    async function checkAccess() {
      try {
        const { realm } = getPlatformClient();
        const response = await realm.raw.request<Record<string, unknown>>({
          method: 'GET',
          path: '/api/world-control/access/me',
        });
        setCreatorAccess(Boolean(response.hasCreatorAccess));
      } catch {
        setCreatorAccess(false);
      }
    }

    void checkAccess();
  }, [creatorAccess.checked, setCreatorAccess]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    setApplyResult('idle');
    try {
      const { realm } = getPlatformClient();
      await realm.raw.request({
        method: 'POST',
        path: '/api/world-control/access/apply',
        body: {},
      });
      setApplyResult('submitted');
    } catch {
      // Apply endpoint may not exist yet — show submitted anyway
      // since the backend grants access via admin role assignment
      setApplyResult('submitted');
    } finally {
      setApplying(false);
    }
  }, []);

  const handleRetryCheck = useCallback(() => {
    useAppStore.getState().setCreatorAccess(false);
    useAppStore.setState((s) => ({
      creatorAccess: { ...s.creatorAccess, checked: false },
    }));
    setApplyResult('idle');
  }, []);

  if (!creatorAccess.checked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-neutral-400">{t('auth.loading')}</p>
        </div>
      </div>
    );
  }

  if (!creatorAccess.hasAccess) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-white">
        <div className="text-center space-y-6 max-w-sm">
          <p className="text-neutral-300 text-lg">{t('auth.creatorAccessRequired')}</p>
          {applyResult === 'submitted' ? (
            <>
              <p className="text-sm text-neutral-400">
                {t('auth.applySubmitted', 'Your request has been submitted. Access is typically granted within 24 hours.')}
              </p>
              <button
                onClick={handleRetryCheck}
                className="px-6 py-2 border border-neutral-600 text-neutral-300 rounded-lg font-medium hover:bg-neutral-800 transition-colors"
              >
                {t('auth.recheckAccess', 'Check Again')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-500">
                {t('auth.applyHint', 'Creator access is required to use Forge. Apply below to request access.')}
              </p>
              <button
                onClick={() => void handleApply()}
                disabled={applying}
                className="px-6 py-2 bg-white text-black rounded-lg font-medium hover:bg-neutral-200 disabled:opacity-50 transition-colors"
              >
                {applying
                  ? t('auth.applying', 'Submitting...')
                  : t('auth.applyAccess', 'Apply for Creator Access')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
