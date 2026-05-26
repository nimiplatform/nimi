import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './app-store.js';
import { getMyWorldAccess } from '@renderer/data/world-data-client.js';
import { ForgeFullscreenState } from '@renderer/components/page-layout.js';

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
        const result = await getMyWorldAccess();
        setCreatorAccess({
          hasAccess: result.hasAccess,
          canCreateWorld: result.canCreateWorld,
          canMaintainWorld: result.canMaintainWorld,
          records: result.records,
        });
      } catch {
        setCreatorAccess({
          hasAccess: false,
          canCreateWorld: false,
          canMaintainWorld: false,
          records: [],
        });
      }
    }

    void checkAccess();
  }, [creatorAccess.checked, setCreatorAccess]);

  const handleRetryCheck = useCallback(() => {
    useAppStore.setState((s) => ({
      creatorAccess: { ...s.creatorAccess, checked: false },
    }));
  }, []);

  if (!creatorAccess.checked) {
    return (
      <ForgeFullscreenState
        title="Checking creator access"
        message={t('auth.loading')}
        loading
      />
    );
  }

  if (!creatorAccess.hasAccess) {
    return (
      <ForgeFullscreenState
        title={t('auth.creatorAccessRequired')}
        message={t('auth.applyUnavailable', 'Creator access is managed outside Forge right now. Ask an admin to grant access, then re-check here.')}
        action={t('auth.recheckAccess', 'Check Again')}
        onAction={handleRetryCheck}
      />
    );
  }

  return <>{children}</>;
}
