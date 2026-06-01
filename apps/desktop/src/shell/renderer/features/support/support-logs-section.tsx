/**
 * Support `logs` sub-area (`D-SUP-006`).
 *
 * Provides log viewing affordances over the `tables/log-areas.yaml` log areas
 * and the SDK-projected `<nimi_data>/logs/` directory (`P-MIG-006` `logs` row,
 * owner `runtime_product_support`).
 *
 * Log EXPORT (`D-SUP-006` "用户可定位的导出工件"): the export action invokes the
 * typed `desktop_logs_export` command, which bundles `<nimi_data>/logs/` into a
 * user-locatable `.zip` archive in the OS Downloads directory and reveals it.
 * On a typed backend failure (missing / unreadable / empty logs directory) the
 * action fails closed to a typed error state — it never synthesizes an empty
 * export file or a pseudo-success artifact.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  desktopBridge,
  type DesktopStorageDirs,
  type LogsExportResult,
} from '@renderer/bridge';
import { useTypedProjection as useSupportProjection } from '@nimiplatform/kit/ui';
import {
  SupportCard,
  SupportFailClosed,
  SupportInfoRow,
  SupportLoading,
  SupportSectionShell,
} from './support-section-shell.js';
import { DESKTOP_LOG_AREAS, DESKTOP_LOG_AREA_LABEL_KEY } from './support-log-areas.js';

/**
 * Whether a typed log-export IPC exists. The Support `logs` export artifact
 * (`D-SUP-006`) is produced by the runtime-host `desktop_logs_export` command.
 * That typed surface now exists, so the export action is live; the UI still
 * fails closed honestly when the command returns a typed error.
 */
const LOG_EXPORT_IPC_AVAILABLE = true;

async function loadLogsProjection(): Promise<DesktopStorageDirs> {
  return desktopBridge.getDesktopStorageDirs();
}

/** Typed state of the in-component log-export action (`D-SUP-006`). */
type LogsExportState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: LogsExportResult }
  | { status: 'failed'; reason: string };

function SupportLogsExportCard() {
  const { t } = useTranslation();
  const [exportState, setExportState] = useState<LogsExportState>({ status: 'idle' });

  async function runExport() {
    setExportState({ status: 'running' });
    try {
      const result = await desktopBridge.exportDesktopLogs();
      setExportState({ status: 'done', result });
    } catch (error) {
      // D-SUP-006: a typed backend failure (missing / unreadable / empty logs
      // directory) fails closed to a typed reason — never a fake artifact.
      const reason = error instanceof Error ? error.message : String(error);
      setExportState({ status: 'failed', reason });
    }
  }

  return (
    <SupportCard
      title={t('Support.logsExportTitle')}
      description={t('Support.logsExportDescription')}
      testId="support-logs-export"
    >
      <button
        type="button"
        data-testid="support-logs-export-button"
        disabled={exportState.status === 'running'}
        onClick={() => {
          void runExport();
        }}
        className="inline-flex items-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)] disabled:opacity-50"
      >
        {exportState.status === 'running'
          ? t('Support.logsExportRunning')
          : t('Support.logsExportButton')}
      </button>

      {exportState.status === 'done' ? (
        <div
          data-testid="support-logs-export-done"
          className="mt-4 space-y-2 rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2"
        >
          <p className="text-xs font-medium text-[var(--nimi-status-positive)]">
            {t('Support.logsExportSucceeded', {
              files: exportState.result.fileCount,
            })}
          </p>
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <SupportInfoRow
              label={t('Support.logsExportArtifactLabel')}
              value={exportState.result.artifactPath}
            />
          </div>
        </div>
      ) : null}

      {exportState.status === 'failed' ? (
        // D-SUP-006: typed fail-closed state. The backend reason is surfaced
        // verbatim; no export artifact is fabricated.
        <p
          data-testid="support-logs-export-failed"
          className="mt-4 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-warning)]"
        >
          {t('Support.logsExportFailed', { reason: exportState.reason })}
        </p>
      ) : null}
    </SupportCard>
  );
}

export function SupportLogsSection() {
  const { t } = useTranslation();
  const projection = useSupportProjection(loadLogsProjection, {
    failClosedMessage: t('Support.logsProjectionUnavailable'),
  });

  if (projection.status === 'loading') {
    return (
      <SupportSectionShell
        title={t('Support.logsTitle')}
        description={t('Support.logsDescription')}
        testId="support-section-logs"
      >
        <SupportLoading testId="support-logs-loading" />
      </SupportSectionShell>
    );
  }

  if (projection.status === 'failed' || !projection.data) {
    return (
      <SupportSectionShell
        title={t('Support.logsTitle')}
        description={t('Support.logsDescription')}
        testId="support-section-logs"
      >
        <SupportFailClosed
          testId="support-logs-fail-closed"
          reason={projection.error ?? t('Support.logsProjectionUnavailable')}
          onRetry={projection.reload}
        />
      </SupportSectionShell>
    );
  }

  return (
    <SupportSectionShell
      title={t('Support.logsTitle')}
      description={t('Support.logsDescription')}
      testId="support-section-logs"
    >
      <SupportCard
        title={t('Support.logsLocationTitle')}
        description={t('Support.logsLocationDescription')}
        testId="support-logs-location"
      >
        <div className="divide-y divide-[var(--nimi-border-subtle)]">
          <SupportInfoRow
            label={t('Support.logsDirectoryLabel')}
            value={projection.data.logsDir || t('Support.valueUnknown')}
          />
        </div>
      </SupportCard>

      <SupportCard
        title={t('Support.logsAreasTitle')}
        description={t('Support.logsAreasDescription')}
        testId="support-logs-areas"
      >
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DESKTOP_LOG_AREAS.map((area) => (
            <li
              key={area}
              className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2"
            >
              <p className="text-xs font-medium text-[var(--nimi-text-primary)]">{area}</p>
              <p className="mt-0.5 text-[11px] text-[var(--nimi-text-secondary)]">
                {t(DESKTOP_LOG_AREA_LABEL_KEY[area])}
              </p>
            </li>
          ))}
        </ul>
      </SupportCard>

      {/* D-SUP-006: log export produces a user-locatable archive via the typed
          desktop_logs_export command; the action fails closed on a typed
          backend error. */}
      {LOG_EXPORT_IPC_AVAILABLE ? <SupportLogsExportCard /> : null}
    </SupportSectionShell>
  );
}
