/**
 * Support `diagnostics` sub-area (`rule.nimi.desktop.product-surfaces.r026`).
 *
 * Aggregates the previously scattered feature-local diagnostics into one
 * technical diagnostics view. It consumes typed Runtime / SDK projections —
 * runtime daemon lifecycle status and host system-resource snapshot — and
 * never reads runtime internal state directly or bypasses the typed
 * projections. The ordinary-user product path does not depend on this view.
 */

import { useTranslation } from 'react-i18next';
import type { RuntimeBridgeDaemonStatus } from '@nimiplatform/kit/shell/renderer/bridge';
import type { DesktopSystemResourceSnapshot as SystemResourceSnapshot } from '../../renderer/system-resources-port.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useTypedProjection as useSupportProjection } from '@nimiplatform/kit/ui';
import {
  SupportCard,
  SupportFailClosed,
  SupportInfoRow,
  SupportLoading,
  SupportSectionShell,
} from './support-section-shell.js';

interface DiagnosticsProjection {
  readonly daemon: RuntimeBridgeDaemonStatus;
  /** System resource snapshot — secondary; absence does not fail the section. */
  readonly resources: SystemResourceSnapshot | null;
  readonly resourcesError: string | null;
}

async function loadDiagnosticsProjection(
  bindings: ReturnType<typeof useDesktopRendererBindings>,
): Promise<DiagnosticsProjection> {
  // The runtime daemon status is the load-bearing typed projection. The
  // resource snapshot can be legitimately unavailable (no Tauri host probe), so
  // its failure is captured inline instead of fail-closing the section.
  const daemon = await bindings.app.commands.runtimeDaemon.status();
  let resources: SystemResourceSnapshot | null = null;
  let resourcesError: string | null = null;
  try {
    resources = await bindings.app.commands.systemResources.load();
  } catch (error) {
    resourcesError = error instanceof Error ? error.message : String(error ?? 'resource snapshot unavailable');
  }
  return { daemon, resources, resourcesError };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function SupportDiagnosticsSection() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const projection = useSupportProjection(
    () => loadDiagnosticsProjection(bindings),
    {
      failClosedMessage: t('Support.diagnosticsProjectionUnavailable'),
    },
  );

  if (projection.status === 'loading') {
    return (
      <SupportSectionShell
        title={t('Support.diagnosticsTitle')}
        description={t('Support.diagnosticsDescription')}
        testId="support-section-diagnostics"
      >
        <SupportLoading testId="support-diagnostics-loading" />
      </SupportSectionShell>
    );
  }

  if (projection.status === 'failed' || !projection.data) {
    return (
      <SupportSectionShell
        title={t('Support.diagnosticsTitle')}
        description={t('Support.diagnosticsDescription')}
        testId="support-section-diagnostics"
      >
        <SupportFailClosed
          testId="support-diagnostics-fail-closed"
          reason={projection.error ?? t('Support.diagnosticsProjectionUnavailable')}
          onRetry={projection.reload}
        />
      </SupportSectionShell>
    );
  }

  const { daemon, resources, resourcesError } = projection.data;

  return (
    <SupportSectionShell
      title={t('Support.diagnosticsTitle')}
      description={t('Support.diagnosticsDescription')}
      testId="support-section-diagnostics"
    >
      <SupportCard title={t('Support.diagnosticsRuntimeTitle')} testId="support-diagnostics-runtime">
        <div className="divide-y divide-[var(--nimi-border-subtle)]">
          <SupportInfoRow
            label={t('Support.diagnosticsRuntimeRunning')}
            value={daemon.running ? t('Support.valueYes') : t('Support.valueNo')}
          />
          <SupportInfoRow
            label={t('Support.diagnosticsRuntimeLaunchMode')}
            value={daemon.launchMode}
          />
          <SupportInfoRow
            label={t('Support.diagnosticsRuntimeGrpcAddr')}
            value={daemon.grpcAddr || t('Support.valueUnknown')}
          />
          <SupportInfoRow
            label={t('Support.diagnosticsRuntimeVersion')}
            value={daemon.version || t('Support.valueUnknown')}
          />
        </div>
        {daemon.lastError ? (
          <p
            data-testid="support-diagnostics-runtime-error"
            className="mt-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]"
          >
            {daemon.lastError}
          </p>
        ) : null}
      </SupportCard>

      <SupportCard title={t('Support.diagnosticsResourcesTitle')} testId="support-diagnostics-resources">
        {resources ? (
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            <SupportInfoRow
              label={t('Support.diagnosticsResourcesCpu')}
              value={`${resources.cpuPercent.toFixed(1)}%`}
            />
            <SupportInfoRow
              label={t('Support.diagnosticsResourcesMemory')}
              value={`${formatBytes(resources.memoryUsedBytes)} / ${formatBytes(resources.memoryTotalBytes)}`}
            />
            <SupportInfoRow
              label={t('Support.diagnosticsResourcesDisk')}
              value={`${formatBytes(resources.diskUsedBytes)} / ${formatBytes(resources.diskTotalBytes)}`}
            />
            <SupportInfoRow
              label={t('Support.diagnosticsResourcesSource')}
              value={resources.source || t('Support.valueUnknown')}
            />
          </div>
        ) : (
          <p
            data-testid="support-diagnostics-resources-unavailable"
            className="break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-text-secondary)]"
          >
            {resourcesError || t('Support.diagnosticsResourcesUnavailable')}
          </p>
        )}
      </SupportCard>
    </SupportSectionShell>
  );
}
