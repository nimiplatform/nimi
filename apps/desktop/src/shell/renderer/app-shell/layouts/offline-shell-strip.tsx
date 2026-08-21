import { useTranslation } from 'react-i18next';
import { useAppStore } from '../providers/app-store';
import { E2E_IDS } from '../../testability/e2e-ids';

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
          ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]'
          : 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]'
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
