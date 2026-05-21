/**
 * Support `logs` sub-area (`D-SUP-006`).
 *
 * Provides log viewing affordances over the `tables/log-areas.yaml` log areas
 * and the `<nimi_data>/logs/` directory (`P-MIG-006` `logs` row, owner
 * `runtime_product_support`). The directory path is derived from the typed
 * `runtime_mod_storage_dirs_get` projection; the user can open it natively.
 *
 * Log EXPORT (`D-SUP-006` "用户可定位的导出工件"): there is currently NO typed
 * upstream IPC that produces a log-export artifact. Per the contract, a
 * missing export surface MUST fail closed to a typed state — this sub-area
 * does NOT synthesize an empty export file or a pseudo-success artifact. The
 * export affordance surfaces the typed unavailable reason instead.
 */

import { useTranslation } from 'react-i18next';
import { desktopBridge, type RuntimeModStorageDirs } from '@renderer/bridge';
import { useSupportProjection } from './support-projection.js';
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
 * (`D-SUP-006`) requires a runtime-owned export command producing a
 * user-locatable artifact; no such command exists yet. The flag is `false`
 * until that upstream typed surface lands — and the UI fail-closes honestly
 * rather than fabricating an export.
 */
const LOG_EXPORT_IPC_AVAILABLE = false;

function deriveLogsDirectory(nimiDataDir: string): string {
  const trimmed = nimiDataDir.trim();
  if (!trimmed) return '';
  const separator = trimmed.includes('\\') ? '\\' : '/';
  const normalized = trimmed.endsWith(separator) ? trimmed.slice(0, -1) : trimmed;
  return `${normalized}${separator}logs`;
}

async function loadLogsProjection(): Promise<RuntimeModStorageDirs> {
  return desktopBridge.getRuntimeModStorageDirs();
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

  const logsDirectory = deriveLogsDirectory(projection.data.nimiDataDir);

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
            value={logsDirectory || t('Support.valueUnknown')}
          />
        </div>
        <button
          type="button"
          data-testid="support-logs-open-button"
          disabled={!logsDirectory}
          onClick={() => {
            if (!logsDirectory) return;
            void desktopBridge.openRuntimeModDir(logsDirectory).catch(() => {
              // openRuntimeModDir surfaces its own failure; nothing to
              // synthesize here.
            });
          }}
          className="mt-4 inline-flex items-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)] disabled:opacity-50"
        >
          {t('Support.logsOpenButton')}
        </button>
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

      <SupportCard
        title={t('Support.logsExportTitle')}
        description={t('Support.logsExportDescription')}
        testId="support-logs-export"
      >
        {LOG_EXPORT_IPC_AVAILABLE ? null : (
          // D-SUP-006: no typed log-export IPC exists. Fail closed to a typed
          // unavailable state — never fabricate an empty export artifact.
          <p
            data-testid="support-logs-export-unavailable"
            className="break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-warning)]"
          >
            {t('Support.logsExportUnavailable')}
          </p>
        )}
      </SupportCard>
    </SupportSectionShell>
  );
}
