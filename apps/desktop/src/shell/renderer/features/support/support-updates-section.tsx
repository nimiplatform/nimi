/**
 * Support `updates` sub-area (`D-SUP-004`).
 *
 * The Application Update host the `self-update-contract.md` "更新器可用性投影"
 * assumes. It consumes the `DesktopReleaseInfo` projection from the app store
 * and triggers the managed `desktop_update_*` commands through the shared
 * `desktop-updates` action layer. It does NOT own update mechanics and never
 * synthesizes default version info — a missing release projection fail-closes.
 *
 * `D-SUP-004` `updaterAvailable=false`: the manual update actions surface the
 * typed `updaterUnavailableReason` and are disabled; they never invoke an
 * updater command known to fail.
 */

import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  runDesktopUpdateCheck,
  runDesktopUpdateInstall,
  runDesktopUpdateRestart,
} from '@renderer/infra/bootstrap/desktop-updates';
import {
  SupportCard,
  SupportFailClosed,
  SupportInfoRow,
  SupportSectionShell,
} from './support-section-shell.js';

export function SupportUpdatesSection() {
  const { t } = useTranslation();
  const desktopReleaseInfo = useAppStore((state) => state.desktopReleaseInfo);
  const desktopReleaseError = useAppStore((state) => state.desktopReleaseError);
  const desktopUpdateState = useAppStore((state) => state.desktopUpdateState);

  // Fail closed: the release projection is the load-bearing typed input. If it
  // is absent, the sub-area shows the captured typed failure or an explicit
  // missing-projection reason rather than fabricated "version unknown" data.
  if (!desktopReleaseInfo) {
    return (
      <SupportSectionShell
        title={t('Support.updatesTitle')}
        description={t('Support.updatesDescription')}
        testId="support-section-updates"
      >
        <SupportFailClosed
          testId="support-updates-fail-closed"
          reason={desktopReleaseError || t('Support.updatesProjectionMissing')}
        />
      </SupportSectionShell>
    );
  }

  const updaterAvailable = desktopReleaseInfo?.updaterAvailable === true;
  const updaterUnavailableReason = desktopReleaseInfo?.updaterUnavailableReason?.trim() || '';
  const updateStatus = desktopUpdateState?.status ?? 'idle';
  const isUpdateBusy = updateStatus === 'checking'
    || updateStatus === 'downloading'
    || updateStatus === 'installing';
  const canRestartForUpdate = desktopUpdateState?.readyToRestart === true;

  return (
    <SupportSectionShell
      title={t('Support.updatesTitle')}
      description={t('Support.updatesDescription')}
      testId="support-section-updates"
    >
      <SupportCard
        title={t('Support.updatesVersionTitle')}
        testId="support-updates-versions"
      >
        <div className="divide-y divide-[var(--nimi-border-subtle)]">
          <SupportInfoRow
            label={t('Support.updatesDesktopVersion')}
            value={desktopReleaseInfo?.desktopVersion || t('Support.valueUnknown')}
          />
          <SupportInfoRow
            label={t('Support.updatesDesktopRelease')}
            value={desktopReleaseInfo?.desktopReleaseId || t('Support.valueUnknown')}
          />
          <SupportInfoRow
            label={t('Support.updatesChannel')}
            value={desktopReleaseInfo?.channel || t('Support.valueUnknown')}
          />
          <SupportInfoRow
            label={t('Support.updatesTargetVersion')}
            value={desktopUpdateState?.targetVersion || t('Support.valueNone')}
          />
          <SupportInfoRow
            label={t('Support.updatesStatus')}
            value={t(`Support.updateStatus_${updateStatus}`, { defaultValue: updateStatus })}
          />
        </div>
      </SupportCard>

      <SupportCard
        title={t('Support.updatesActionsTitle')}
        description={t('Support.updatesActionsDescription')}
        testId="support-updates-actions"
      >
        {updaterAvailable ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="support-updates-check-button"
              disabled={isUpdateBusy}
              onClick={() => { void runDesktopUpdateCheck({ autoDownload: false, silent: false }); }}
              className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)] disabled:opacity-50"
            >
              {t('Support.updatesCheckButton')}
            </button>
            <button
              type="button"
              data-testid="support-updates-install-button"
              disabled={isUpdateBusy || canRestartForUpdate}
              onClick={() => { void runDesktopUpdateInstall({ silent: false }); }}
              className="rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-medium text-[var(--nimi-action-primary-fg)] transition hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
            >
              {t('Support.updatesInstallButton')}
            </button>
            <button
              type="button"
              data-testid="support-updates-restart-button"
              disabled={!canRestartForUpdate}
              onClick={() => { void runDesktopUpdateRestart(); }}
              className="rounded-lg bg-[var(--nimi-text-primary)] px-3 py-2 text-xs font-medium text-[var(--nimi-surface-card)] transition disabled:opacity-50"
            >
              {t('Support.updatesRestartButton')}
            </button>
          </div>
        ) : (
          // D-SUP-004: updater unavailable — surface the typed reason directly
          // and offer no action that would call a failing updater command.
          <p
            data-testid="support-updates-unavailable"
            className="break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-warning)]"
          >
            {updaterUnavailableReason || t('Support.updatesUnavailableFallback')}
          </p>
        )}

        {desktopUpdateState?.lastError ? (
          <p
            data-testid="support-updates-error"
            className="mt-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]"
          >
            {desktopUpdateState.lastError}
          </p>
        ) : null}
      </SupportCard>
    </SupportSectionShell>
  );
}
