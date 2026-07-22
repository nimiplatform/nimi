import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, OverlayShell, Tooltip } from '@nimiplatform/kit/ui';
import { NimiLabAccountMenu } from '../shell/account/account-panel.js';
import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { useTesterRendererHost } from '../renderer/context.js';
import type { TesterEcosystemReferenceProjection } from '../renderer/contract.js';
import { getTesterCapability, testerCapabilities, type TesterCapabilityId } from './tester-capabilities.js';
import { shouldPersistTesterArtifactRecord } from './tester-artifact-persistence.js';
import {
  createTesterRunHistoryResultSnapshot,
  type TesterRunConfigSnapshot,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from './tester-history.js';
import type { TesterAIConfigSummary } from './tester-ai-config.js';
import type { TesterCapabilityRunResult } from './tester-runtime.js';
import type { TesterPreferences } from './tester-preferences.js';
import { testerTestIds } from './tester-test-ids.js';
import { TesterLocalAppPermissionLab } from './local-app-permission-lab.js';
import { WorkbenchSideNav } from './workbench/workbench-side-nav.js';
import { SectionAITesting } from './workbench/section-ai-testing.js';
import type { WorkbenchView } from './workbench/workbench-context.js';

const initialCapabilityId: TesterCapabilityId = 'text.generate';
const SettingsRoute = lazy(async () => ({
  default: (await import('../shell/routes/settings-route.js')).SettingsRoute,
}));
const KitComponentGallery = lazy(async () => ({
  default: (await import('./kit-component-gallery.js')).KitComponentGallery,
}));

type TesterWorkbenchProps = {
  title: string;
};

type TesterHistorySelectionRequest = {
  requestId: number;
  record: TesterRunHistoryRecord;
};

function hasTraceMetadata(result: TesterCapabilityRunResult): boolean {
  if (!result.ok || !result.trace) return false;
  return Boolean(result.trace.traceId || result.trace.modelResolved || result.trace.routeDecision);
}

function getResultTraceId(result: TesterCapabilityRunResult): string | undefined {
  return result.ok ? result.trace?.traceId : undefined;
}

function artifactExtension(mimeType: string | undefined): string {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  return 'bin';
}

async function materializeTesterArtifactResult(
  result: TesterCapabilityRunResult,
  runId: string,
  createdAt: string,
  saveArtifact: (input: { readonly filename: string; readonly mimeType?: string; readonly dataUrl: string }) => Promise<{
    readonly previewUrl: string;
    readonly filename: string;
    readonly mimeType?: string;
  }>,
): Promise<TesterCapabilityRunResult> {
  if (!shouldPersistTesterArtifactRecord(result)) return result;
  const firstArtifact = result.output.firstArtifact;
  const url = firstArtifact?.url?.trim();
  if (!url?.startsWith('data:')) return result;
  const stamp = createdAt.replace(/[:.]/g, '-');
  const filename = `${result.capabilityId}-${stamp}-${runId}.${artifactExtension(firstArtifact?.mimeType)}`;
  const saved = await saveArtifact({
    filename,
    mimeType: firstArtifact?.mimeType,
    dataUrl: url,
  });
  return {
    ...result,
    output: {
      ...result.output,
      firstArtifact: {
        ...firstArtifact,
        url: saved.previewUrl,
        displayName: firstArtifact?.displayName || saved.filename,
        mimeType: firstArtifact?.mimeType || saved.mimeType,
      },
    },
  };
}

function runtimeBadge(summary: TesterAIConfigSummary | null): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (!summary) return { label: 'Checking', tone: 'neutral' };
  if (summary.runtime.status === 'simulated') return { label: 'Simulated', tone: 'neutral' };
  if (summary.runtime.status === 'ready') return { label: 'Ready', tone: 'success' };
  if (summary.runtime.status === 'connected') return { label: 'Connected', tone: 'success' };
  return { label: 'Unavailable', tone: 'warning' };
}

function runtimeUserMessage(summary: TesterAIConfigSummary | null): string {
  if (!summary) return 'Checking the Runtime connection.';
  if (summary.runtime.status === 'simulated') return summary.runtime.detail;
  if (summary.runtime.status === 'ready') return 'Runtime is connected. You can generate text and stream responses.';
  if (summary.runtime.status === 'connected') return summary.runtime.detail;
  return 'Runtime is unavailable. Open App Lab in the desktop runtime, or start and repair Runtime before generating.';
}

function TopbarStatusTooltip({
  title,
  rows,
}: {
  title: string;
  rows: readonly { label: string; value: string }[];
}) {
  return (
    <div className="workbench-topbar-tooltip">
      <strong>{title}</strong>
      {rows.map((row) => (
        <span key={row.label}>
          <b>{row.label}</b>
          <em>{row.value}</em>
        </span>
      ))}
    </div>
  );
}

export function TesterWorkbench(_props: TesterWorkbenchProps) {
  const rendererHost = useTesterRendererHost();
  const [view, setView] = useState<WorkbenchView>({ kind: 'capability', capabilityId: initialCapabilityId });
  const activeCapabilityId: TesterCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [historySelectionRequest, setHistorySelectionRequest] = useState<TesterHistorySelectionRequest | null>(null);
  const [preferences] = useState<TesterPreferences>(() => rendererHost.app.projection.preferences());
  const [localAppProjection, setLocalAppProjection] = useState<RuntimePlatformProjection | null>(null);
  const [ecosystemReference, setEcosystemReference] = useState<TesterEcosystemReferenceProjection | null>(
    () => rendererHost.app.projection.ecosystemReference(),
  );
  const [permissionLabOpen, setPermissionLabOpen] = useState(false);

  const capability = useMemo(() => getTesterCapability(activeCapabilityId), [activeCapabilityId]);
  const runtimeState = useMemo(() => runtimeBadge(summary), [summary]);
  const runtimeTooltipRows = useMemo(
    () => [
      { label: 'Status', value: runtimeState.label },
      { label: 'What it means', value: runtimeUserMessage(summary) },
    ],
    [runtimeState.label, summary],
  );

  const refreshHistory = useCallback(async () => {
    try {
      const next = await rendererHost.app.projection.runHistory();
      setHistory(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History load failed.');
      rendererHost.app.commands.runtimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-load-failed',
        details: { error: message },
      });
    }
  }, [rendererHost]);

  const refreshSummary = useCallback(async () => {
    try {
      const next = await rendererHost.app.projection.aiConfigSummary();
      setSummary(next);
    } catch (error) {
      setSummary({
        runtime: {
          status: 'unavailable',
          mode: 'unknown',
          detail: error instanceof Error ? error.message : String(error || 'Runtime inspection failed.'),
        },
        schedulingOwner: 'runtime',
        providerCatalogSurface: 'sdk.runtime.listNimiRuntimeRouteOptions',
        appLocalProviderDefaults: false,
      });
    }
  }, [rendererHost]);

  useEffect(() => {
    void refreshSummary();
    void refreshHistory();
    void rendererHost.app.projection.runtimePlatform().then((projection) => {
      setLocalAppProjection(projection);
    });
  }, [refreshSummary, refreshHistory, rendererHost]);

  useEffect(() => rendererHost.app.events.subscribe(
    'tester.ecosystem.reference-updated',
    (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const reference = payload as Partial<TesterEcosystemReferenceProjection>;
      if (!Number.isSafeInteger(reference.ecosystemRevision)
        || typeof reference.checkpointId !== 'string'
        || typeof reference.label !== 'string') return;
      setEcosystemReference(reference as TesterEcosystemReferenceProjection);
    },
  ), [rendererHost]);

  const localAppTooltipRows = useMemo(() => {
    const ready = localAppProjection?.status === 'ready' ? localAppProjection : null;
    const session = ready?.localAppSession;
    return [
      { label: 'Session', value: session?.state || (localAppProjection ? 'Unavailable' : 'Checking') },
      { label: 'Identity', value: session?.sessionBound ? 'Bound' : (localAppProjection ? 'Unavailable' : 'Pending') },
      { label: 'Base entitlement', value: session?.sessionBound ? 'App-private storage' : 'Unavailable' },
      ...(localAppProjection && localAppProjection.status !== 'ready'
        ? [{ label: 'Reason', value: localAppProjection.message }]
        : []),
    ];
  }, [localAppProjection]);
  const localAppState = localAppProjection?.status === 'ready'
    ? { label: 'Ready', tone: 'success' as const }
    : localAppProjection
      ? { label: 'Unavailable', tone: 'warning' as const }
      : { label: 'Checking', tone: 'neutral' as const };

  const handleSelectHistoryRun = useCallback((record: TesterRunHistoryRecord) => {
    const capabilityId = record.capabilityId as TesterCapabilityId;
    const selectedCapability = testerCapabilities.find((item) => item.id === capabilityId && item.execution === 'runtime-sdk');
    if (!selectedCapability) return;
    setView({ kind: 'capability', capabilityId: selectedCapability.id });
    setHistorySelectionRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      record,
    }));
  }, []);

  const handleCapabilityResult = useCallback(
    async (
      result: TesterCapabilityRunResult,
      prompt: string,
      runConfig?: TesterRunConfigSnapshot,
    ): Promise<TesterRunHistoryRecord> => {
      setLastResult(result);
      const identity = await rendererHost.app.commands.nextRunIdentity();
      const runId = identity.runId;
      const flowId = rendererHost.scope.globalName(`tester-capability-run-${runId}`);
      const traceId = getResultTraceId(result);
      const createdAt = identity.createdAt;
      let historyResult = result;
      try {
        historyResult = await materializeTesterArtifactResult(
          result,
          runId,
          createdAt,
          rendererHost.app.commands.saveArtifact,
        );
      } catch (error) {
        rendererHost.app.commands.runtimeLog({
          level: 'warn',
          area: 'tester-artifact-history',
          message: 'artifact-materialize-failed',
          details: {
            runId,
            capabilityId: result.capabilityId,
            error: error instanceof Error ? error.message : String(error || 'artifact materialization failed'),
          },
        });
      }
      const record: TesterRunHistoryRecord = {
        id: runId,
        capabilityId: historyResult.capabilityId,
        prompt,
        status: historyResult.capabilityId === 'world.generate' && historyResult.ok
          ? 'local-fixture'
          : historyResult.ok && historyResult.trace?.routeDecision === 'simulated-scenario'
            ? 'simulated'
            : historyResult.ok ? 'ready' : 'unavailable',
        message: historyResult.message,
        createdAt,
        result: createTesterRunHistoryResultSnapshot(historyResult),
        runConfig: runConfig ? { ...runConfig, traceId } : undefined,
      };
      try {
        const next = await rendererHost.app.commands.appendRunHistory(record);
        setHistory(next);
        if (shouldPersistTesterArtifactRecord(historyResult)) {
          const firstArtifact = historyResult.output.firstArtifact;
          await rendererHost.app.commands.appendImageHistory({
            id: runId,
            runId,
            kind: 'runtime-media',
            capabilityId: historyResult.capabilityId,
            capabilityLabel: historyResult.capabilityLabel,
            title: firstArtifact?.displayName || firstArtifact?.artifactId || historyResult.output.jobId || historyResult.capabilityLabel,
            status: 'ready',
            createdAt,
            artifactCount: historyResult.output.artifactCount,
            artifactLabel: firstArtifact?.displayName || firstArtifact?.artifactId,
            mimeType: firstArtifact?.mimeType,
            url: firstArtifact?.url && !firstArtifact.url.startsWith('data:') ? firstArtifact.url : undefined,
            jobId: historyResult.output.jobId,
            jobState: historyResult.output.jobState,
            message: historyResult.message,
            traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
            traceId,
          });
        }
        rendererHost.app.commands.rendererLog({
          level: result.ok ? 'info' : 'warn',
          area: 'tester.capability-run',
          message: result.ok ? 'action:tester-capability-run:recorded' : 'action:tester-capability-run:unavailable',
          flowId,
          traceId,
          details: {
            runId,
            capabilityId: result.capabilityId,
            status: result.ok ? 'ready' : 'unavailable',
            artifactPersisted: shouldPersistTesterArtifactRecord(result),
            traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
          },
        });
      } catch (error) {
        rendererHost.app.commands.rendererLog({
          level: 'error',
          area: 'tester.capability-run',
          message: 'action:tester-capability-run:persistence-failed',
          flowId,
          traceId,
          details: {
            runId,
            capabilityId: result.capabilityId,
            error: error instanceof Error ? error.message : String(error || 'History persistence failed.'),
          },
        });
      }
      return record;
    },
    [rendererHost],
  );

  return (
    <main className="workbench" data-testid={testerTestIds.root}>
      <div className="workbench__body">
        <WorkbenchSideNav
          view={view}
          onSelectCapability={(id) => setView({ kind: 'capability', capabilityId: id })}
          onSelectRecipes={() => setView({ kind: 'ui-recipes' })}
          accountSlot={(
            <NimiLabAccountMenu onOpenSettings={() => setView({ kind: 'settings' })} />
          )}
        />
        <div className="workbench__main">
          <div className="workbench__content">
            {view.kind === 'settings' ? (
              <Suspense fallback={null}>
                <SettingsRoute />
              </Suspense>
            ) : view.kind === 'ui-recipes' ? (
              <Suspense fallback={null}>
                <KitComponentGallery
                  onOpenSection={(target) => {
                    const capabilityId = testerCapabilities.find((item) => item.id === target)?.id ?? initialCapabilityId;
                    setView({ kind: 'capability', capabilityId });
                  }}
                />
              </Suspense>
            ) : (
              <SectionAITesting
                capability={capability}
                onResult={handleCapabilityResult}
                summary={summary}
                history={history}
                lastResult={lastResult}
                historySelectionRequest={historySelectionRequest}
                onSelectHistoryRun={handleSelectHistoryRun}
                verboseConsole={preferences.verboseConsole}
                draftPersistence={preferences.draftPersistence}
                headerActions={(
                  <>
                    {ecosystemReference ? (
                      <output
                        role="status"
                        data-nimi-semantic-id="tester-ecosystem-reference"
                        data-ecosystem-revision={ecosystemReference.ecosystemRevision}
                        className="workbench-topbar__attachment workbench-topbar__attachment--success"
                      >
                        Ecosystem revision {ecosystemReference.ecosystemRevision}
                      </output>
                    ) : null}
                    <Tooltip
                      content={<TopbarStatusTooltip title="Local app" rows={localAppTooltipRows} />}
                      placement="bottom"
                    >
                      <Button
                        type="button"
                        tone="ghost"
                        size="sm"
                        className={`workbench-topbar__attachment workbench-topbar__attachment--interactive workbench-topbar__attachment--${localAppState.tone}`}
                        data-testid="tester-local-app-status"
                        aria-label="打开 Local App 权限测试"
                        onClick={() => setPermissionLabOpen(true)}
                      >
                        <span className="workbench-topbar__dot" aria-hidden="true" />
                        <span>Local app · {localAppState.label}</span>
                      </Button>
                    </Tooltip>
                    <Tooltip
                      content={<TopbarStatusTooltip title="Runtime" rows={runtimeTooltipRows} />}
                      placement="bottom"
                    >
                      <span className={`workbench-topbar__attachment workbench-topbar__attachment--${runtimeState.tone}`}>
                        <span className="workbench-topbar__dot" aria-hidden="true" />
                        <span>Runtime · {runtimeState.label}</span>
                      </span>
                    </Tooltip>
                  </>
                )}
              />
            )}
          </div>
        </div>
      </div>
      <OverlayShell
        open={permissionLabOpen}
        kind="drawer"
        size="S"
        onClose={() => setPermissionLabOpen(false)}
        title="Local App 权限边界"
        description="验证会话、保留权限 fail-close，以及无需 Nimi 批准的 app 私有存储。"
        panelClassName="flex flex-col overflow-hidden"
        contentClassName="min-h-0 min-w-0 flex-1 overflow-y-auto"
        footer={(
          <Button type="button" tone="secondary" onClick={() => setPermissionLabOpen(false)}>
            关闭
          </Button>
        )}
        dataTestId="tester-local-app-permission-drawer"
      >
        <TesterLocalAppPermissionLab />
      </OverlayShell>
    </main>
  );
}
