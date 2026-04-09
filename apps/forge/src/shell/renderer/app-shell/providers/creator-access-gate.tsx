import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from './app-store.js';
import { getMyWorldAccess } from '@renderer/data/world-data-client.js';
import { ForgeLoadingSpinner } from '@renderer/components/page-layout.js';

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
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]">
        <div className="text-center space-y-4">
          <ForgeLoadingSpinner />
          <p className="text-[var(--nimi-text-muted)]">{t('auth.loading')}</p>
        </div>
      </div>
    );
  }

  if (!creatorAccess.hasAccess) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]">
        <div className="text-center space-y-6 max-w-sm">
          <p className="text-[var(--nimi-text-secondary)] text-lg">{t('auth.creatorAccessRequired')}</p>
          <p className="text-sm text-[var(--nimi-text-muted)]">
            {t('auth.applyUnavailable', 'Creator access is managed outside Forge right now. Ask an admin to grant access, then re-check here.')}
          </p>
          <Button tone="secondary" onClick={handleRetryCheck}>
            {t('auth.recheckAccess', 'Check Again')}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
