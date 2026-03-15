import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

export function OfflineShellStrip() {
  const { t } = useTranslation();
  const offlineTier = useAppStore((state) => state.offlineTier);
  if (offlineTier === 'L0') {
    return null;
  }
  const isRuntimeReadOnly = offlineTier === 'L2';
  return (
    <div
      data-testid={E2E_IDS.offlineStrip}
      className={`border-b px-4 py-2 text-sm ${
        isRuntimeReadOnly
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-sky-200 bg-sky-50 text-sky-900'
      }`}
    >
      <p className="font-medium">
        {isRuntimeReadOnly
          ? t('OfflineShell.runtimeUnavailableTitle')
          : t('OfflineShell.cloudOfflineTitle')}
      </p>
      <p className="text-xs opacity-80">
        {isRuntimeReadOnly
          ? t('OfflineShell.runtimeUnavailableBody')
          : t('OfflineShell.cloudOfflineBody')}
      </p>
    </div>
  );
}
