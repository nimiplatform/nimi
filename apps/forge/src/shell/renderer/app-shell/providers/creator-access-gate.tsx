import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { getMyWorldAccess } from '@renderer/data/world-data-client.js';

export function CreatorAccessGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const creatorAccess = useAppStore((s) => s.creatorAccess);
  const setCreatorAccess = useAppStore((s) => s.setCreatorAccess);

  useEffect(() => {
    if (creatorAccess.checked) {
      return;
    }

    async function checkAccess() {
      try {
        const response = await getMyWorldAccess() as Record<string, unknown>;
        setCreatorAccess(Boolean(response.hasCreatorAccess));
      } catch {
        setCreatorAccess(false);
      }
    }

    void checkAccess();
  }, [creatorAccess.checked, setCreatorAccess]);

  const handleRetryCheck = useCallback(() => {
    useAppStore.getState().setCreatorAccess(false);
    useAppStore.setState((s) => ({
      creatorAccess: { ...s.creatorAccess, checked: false },
    }));
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
          <p className="text-sm text-neutral-400">
            {t('auth.applyUnavailable', 'Creator access is managed outside Forge right now. Ask an admin to grant access, then re-check here.')}
          </p>
          <button
            onClick={handleRetryCheck}
            className="px-6 py-2 border border-neutral-600 text-neutral-300 rounded-lg font-medium hover:bg-neutral-800 transition-colors"
          >
            {t('auth.recheckAccess', 'Check Again')}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
