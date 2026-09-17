import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, SelectField } from '@nimiplatform/kit/ui';
import {
  AppPackageSourceClass,
  type AppPackageInfo,
  type GetAppPackageInfoRequest,
} from '@nimiplatform/sdk/runtime/wire-types';
import { canRequestCatalogUpdate, hasAvailableCatalogUpdate, type AppCardActionId } from './apps-card-actions.js';
import { AppsDistributionDocuments } from './apps-distribution-info.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import { AppsPropertiesRowItem, type AppsPropertiesRow } from './apps-properties-dialog.js';
import { AppsReadmeMarkdown } from './apps-readme-markdown.js';
import {
  readAppUpdatePreference,
  subscribeAppUpdatePreferences,
  writeAppUpdatePolicy,
  type AppUpdatePolicy,
} from './apps-update-preferences.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r053

type UpdateNotesState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly content: string | null }
  | { readonly status: 'error' };

/**
 * Steam-style 更新 pane for an installed App: the per-app update policy select,
 * the pending-update action, installed/Registry version facts, the installed
 * version's release notes and license, and the pending version's own release
 * notes. The `auto` policy only starts the standard update flow when a newer
 * version appears; confirmation still gates installs.
 */
export function AppsUpdateSection({ entry, readPackageInfo, onAction, actionsDisabled, actionPending }: {
  readonly entry: DesktopAppsEntry;
  readonly readPackageInfo?: (request: GetAppPackageInfoRequest) => Promise<AppPackageInfo>;
  readonly onAction: (action: AppCardActionId) => void;
  readonly actionsDisabled: boolean;
  readonly actionPending: boolean;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const appId = entry.identity.appId;
  const release = entry.committedRelease;
  const catalog = entry.catalogTarget;
  const registryApp = release?.sourceClass === AppPackageSourceClass.VERIFIED;
  const updateAvailable = hasAvailableCatalogUpdate(entry);
  const running = entry.run?.state === 'running';
  const targetVersion = catalog?.version ?? null;
  const selectorKey = useMemo(
    () => (catalog ? catalog.approvedTargetSelector.join('.') : ''),
    [catalog],
  );

  const [preference, setPreference] = useState(() => readAppUpdatePreference(appId));
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    setPreference(readAppUpdatePreference(appId));
    setSaveFailed(false);
    return subscribeAppUpdatePreferences(() => setPreference(readAppUpdatePreference(appId)));
  }, [appId]);

  const changePolicy = (value: string): void => {
    try {
      setPreference(writeAppUpdatePolicy(appId, value as AppUpdatePolicy));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  };

  const notesEnabled = Boolean(updateAvailable && catalog && readPackageInfo);
  const [notes, setNotes] = useState<UpdateNotesState>({ status: 'loading' });
  useEffect(() => {
    if (!notesEnabled || !catalog || !readPackageInfo) return undefined;
    let alive = true;
    setNotes({ status: 'loading' });
    readPackageInfo({
      approvedTargetSelector: catalog.approvedTargetSelector.slice(),
      launchSelector: new Uint8Array(),
      installedReleaseRef: '',
    }).then((info) => {
      if (!alive) return;
      if (info.appId !== appId || info.version !== targetVersion) {
        setNotes({ status: 'error' });
        return;
      }
      setNotes({ status: 'loaded', content: info.releaseNotesMarkdown || null });
    }).catch(() => {
      if (alive) setNotes({ status: 'error' });
    });
    return () => {
      alive = false;
    };
  }, [appId, catalog, notesEnabled, readPackageInfo, selectorKey, targetVersion]);

  const factRows: AppsPropertiesRow[] = [
    {
      label: t('Apps.detail.installedVersionLabel'),
      value: release?.version ?? t('Apps.version.notInstalled'),
      mono: true,
    },
    ...(catalog ? [{
      label: t('Apps.detail.latestRegistryVersionLabel'),
      value: catalog.version,
      mono: true,
    }] : []),
    ...(release ? [{
      label: t('Apps.detail.installedContentUpdatedAtLabel'),
      value: formatUpdateTimestamp(installedContentUpdatedAtUnixMs(entry), i18n.language),
    }] : []),
  ];

  return (
    <div className="space-y-2" data-testid="apps-update-section">
      {registryApp ? (
        <div className="rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-3">
          <div className="text-sm font-medium text-[color:var(--nimi-text-primary)]">{t('Apps.detail.autoUpdateLabel')}</div>
          <p className="mt-0.5 text-xs leading-5 text-[color:var(--nimi-text-muted)]">{t('Apps.detail.autoUpdateDescription')}</p>
          <SelectField
            className="mt-3"
            contentLayer="dialog"
            options={[
              { value: 'manual', label: t('Apps.detail.autoUpdateManual') },
              { value: 'auto', label: t('Apps.detail.autoUpdateAuto') },
            ]}
            value={preference.policy}
            onValueChange={changePolicy}
            aria-label={t('Apps.detail.autoUpdateLabel')}
            data-testid="apps-update-policy"
          />
          {saveFailed ? (
            <InlineAlert tone="danger" className="mt-3" data-testid="apps-update-policy-save-failed">
              {t('Apps.detail.autoUpdateSaveFailed')}
            </InlineAlert>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-3">
        <div className="shrink-0 text-sm text-[color:var(--nimi-text-muted)]">{t('Apps.detail.updateStatusLabel')}</div>
        {updateAvailable && targetVersion ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate text-sm text-[var(--nimi-status-info)]" data-testid="apps-update-available">
              {t('Apps.update.available', { version: targetVersion })}
            </span>
            <Button
              size="sm"
              tone="primary"
              data-testid="apps-update-now"
              loading={actionPending}
              disabled={actionsDisabled || !canRequestCatalogUpdate(entry)}
              title={running ? t('Apps.update.stopRequired') : undefined}
              onClick={() => onAction('update')}
            >
              {t('Apps.update.toVersion', { version: targetVersion })}
            </Button>
          </div>
        ) : (
          <span className="min-w-0 text-right text-sm text-[color:var(--nimi-text-primary)]">
            {release ? t('Apps.detail.updateStatusUpToDate') : t('Apps.version.notInstalled')}
          </span>
        )}
      </div>
      {catalog?.policyBlocked ? (
        <InlineAlert tone="danger" data-testid="apps-update-policy-blocked">
          {t('Apps.catalog.policyBlocked', {
            reason: catalog.policyReason ?? t('Apps.catalog.policyBlockedFallback'),
            revision: catalog.policyRevision,
          })}
        </InlineAlert>
      ) : null}
      {!registryApp && release ? (
        <InlineAlert tone="info" data-testid="apps-update-imported-note">
          {t('Apps.detail.importedUpdateNote')}
        </InlineAlert>
      ) : null}

      <dl className="space-y-2 !mt-4">
        {factRows.map((row) => (
          <AppsPropertiesRowItem key={row.label} row={row} />
        ))}
      </dl>

      <div className="!mt-4" data-testid="apps-update-installed-documents">
        <AppsDistributionDocuments
          info={entry.appInfo ?? null}
          error={entry.appInfoError ?? null}
          kinds={['releaseNotes', 'license']}
        />
      </div>

      {notesEnabled ? (
        <section className="!mt-5" data-testid="apps-update-notes">
          <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">
            {t('Apps.detail.updateNotesTitle', { version: targetVersion })}
          </h3>
          <div className="mt-2 rounded-lg bg-[color-mix(in_srgb,var(--nimi-surface-card)_72%,transparent)] px-4 py-3">
            {notes.status === 'loading' ? (
              <p role="status" className="text-sm text-[color:var(--nimi-text-secondary)]">{t('Apps.info.loading')}</p>
            ) : notes.status === 'error' ? (
              <InlineAlert tone="warning">{t('Apps.detail.updateNotesUnavailable')}</InlineAlert>
            ) : notes.content ? (
              <AppsReadmeMarkdown content={notes.content} />
            ) : (
              <p className="text-sm text-[color:var(--nimi-text-muted)]">{t('Apps.info.notProvided')}</p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function installedContentUpdatedAtUnixMs(entry: DesktopAppsEntry): number {
  const committedAt = entry.committedRelease?.committedAt;
  if (committedAt) {
    const seconds = Number(committedAt.seconds);
    if (Number.isSafeInteger(seconds) && Number.isInteger(committedAt.nanos)) {
      return seconds * 1_000 + committedAt.nanos / 1_000_000;
    }
  }
  return entry.identity.updatedAtUnixMs;
}

function formatUpdateTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
