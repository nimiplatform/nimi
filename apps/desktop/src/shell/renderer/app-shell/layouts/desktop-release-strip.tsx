import { useTranslation } from 'react-i18next';
import { useAppStore } from '../providers/app-store';
import { persistStoredSupportSection } from '../../features/support/support-storage';
import { E2E_IDS } from '../../testability/e2e-ids';

export function resolveDesktopReleaseStripMessage(input: {
  desktopReleaseError?: string | null;
}): string {
  return String(input.desktopReleaseError || '').trim();
}

export function DesktopReleaseStrip() {
  const { t } = useTranslation();
  const desktopReleaseError = useAppStore((state) => state.desktopReleaseError);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const message = resolveDesktopReleaseStripMessage({
    desktopReleaseError,
  });
  if (!message) {
    return null;
  }

  return (
    <div
      data-testid={E2E_IDS.desktopReleaseStrip}
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {t('DesktopRelease.releaseUnavailableTitle')}
          </p>
          <p className="text-xs opacity-80">
            {t('DesktopRelease.releaseUnavailableBody')}
          </p>
          <p className="mt-1 break-words text-xs opacity-80">{message}</p>
        </div>
        <button
          type="button"
          data-testid={E2E_IDS.desktopReleaseOpenUpdates}
          className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
          onClick={() => {
            persistStoredSupportSection('updates');
            setActiveTab('support');
          }}
        >
          {t('DesktopRelease.openUpdates')}
        </button>
      </div>
    </div>
  );
}
