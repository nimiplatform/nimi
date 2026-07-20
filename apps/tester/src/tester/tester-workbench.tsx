import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import './tester-workbench.css';
import { Button, OverlayShell, Tooltip } from '@nimiplatform/kit/ui';
import { createRendererFlowId, emitRuntimeLog, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createNimiClientId } from '@nimiplatform/sdk';
import { requestWithRetry } from '@nimiplatform/sdk/types';
import { NimiLabAccountMenu } from '../shell/account/account-panel.js';
import {
  getRuntimePlatformProjection,
  type RuntimePlatformReadyProjection,
} from '../shell/auth/runtime-platform.js';
import { getTesterCapability, testerCapabilities, type TesterCapabilityId } from './tester-capabilities.js';
import { saveTesterArtifact } from './tester-artifact-storage.js';
import { shouldPersistTesterArtifactRecord } from './tester-artifact-persistence.js';
import {
  appendTesterRunHistory,
  createTesterRunHistoryResultSnapshot,
  loadTesterRunHistory,
  type TesterRunConfigSnapshot,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from './tester-history.js';
import { appendTesterImageHistoryRecord } from './tester-image-history.js';
import { loadTesterAIConfigSummary, type TesterAIConfigSummary } from './tester-ai-config.js';
import type { TesterCapabilityRunResult } from './tester-runtime.js';
import {
  loadTesterPreferences,
  type TesterPreferences,
} from './tester-preferences.js';
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

function makeRecordId() {
  return createNimiClientId('run');
}

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
): Promise<TesterCapabilityRunResult> {
  if (!shouldPersistTesterArtifactRecord(result)) return result;
  const firstArtifact = result.output.firstArtifact;
  const url = firstArtifact?.url?.trim();
  if (!url?.startsWith('data:')) return result;
  const stamp = createdAt.replace(/[:.]/g, '-');
  const filename = `${result.capabilityId}-${stamp}-${runId}.${artifactExtension(firstArtifact?.mimeType)}`;
  const saved = await saveTesterArtifact({
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
  if (summary.runtime.status === 'ready') return { label: 'Ready', tone: 'success' };
  if (summary.runtime.status === 'connected') return { label: 'Connected', tone: 'success' };
  return { label: 'Unavailable', tone: 'warning' };
}

function runtimeUserMessage(summary: TesterAIConfigSummary | null): string {
  if (!summary) return 'Checking the Runtime connection.';
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
  const [view, setView] = useState<WorkbenchView>({ kind: 'capability', capabilityId: initialCapabilityId });
  const activeCapabilityId: TesterCapabilityId = view.kind === 'capability' ? view.capabilityId : initialCapabilityId;
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [historySelectionRequest, setHistorySelectionRequest] = useState<TesterHistorySelectionRequest | null>(null);
  const [preferences] = useState<TesterPreferences>(() => loadTesterPreferences().preferences);
  const [localAppProjection, setLocalAppProjection] = useState<RuntimePlatformReadyProjection | null>(null);
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
      const next = await requestWithRetry({
        executor: loadTesterRunHistory,
        options: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 50 },
      });
      setHistory(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'History load failed.');
      emitRuntimeLog({
        level: 'warn',
        area: 'tester-history',
        message: 'history-load-failed',
        details: { error: message },
      });
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      const next = await loadTesterAIConfigSummary();
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
  }, []);

  useEffect(() => {
    void refreshSummary();
    void refreshHistory();
    void getRuntimePlatformProjection().then((projection) => {
      if (projection.status === 'ready') setLocalAppProjection(projection);
    });
  }, [refreshSummary, refreshHistory]);

  const localAppTooltipRows = useMemo(() => {
    const session = localAppProjection?.localAppSession;
    return [
      { label: 'Session', value: session?.state || 'Checking' },
      { label: 'Identity', value: session?.sessionBound ? 'Bound' : 'Pending' },
      { label: 'Base entitlement', value: session?.sessionBound ? 'App-private storage' : 'Unavailable' },
    ];
  }, [localAppProjection]);

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
      const runId = makeRecordId();
      const flowId = createRendererFlowId('tester-capability-run');
      const traceId = getResultTraceId(result);
      const createdAt = new Date().toISOString();
      let historyResult = result;
      try {
        historyResult = await materializeTesterArtifactResult(result, runId, createdAt);
      } catch (error) {
        emitRuntimeLog({
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
        status: historyResult.capabilityId === 'world.generate' && historyResult.ok ? 'local-fixture' : historyResult.ok ? 'ready' : 'unavailable',
        message: historyResult.message,
        createdAt,
        result: createTesterRunHistoryResultSnapshot(historyResult),
        runConfig: runConfig ? { ...runConfig, traceId } : undefined,
      };
      try {
        const next = await appendTesterRunHistory(record);
        setHistory(next);
        if (shouldPersistTesterArtifactRecord(historyResult)) {
          const firstArtifact = historyResult.output.firstArtifact;
          await appendTesterImageHistoryRecord({
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
        logRendererEvent({
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
        logRendererEvent({
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
    [],
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
                    <Tooltip
                      content={<TopbarStatusTooltip title="Protected local app" rows={localAppTooltipRows} />}
                      placement="bottom"
                    >
                      <Button
                        type="button"
                        tone="ghost"
                        size="sm"
                        className={`workbench-topbar__attachment workbench-topbar__attachment--interactive workbench-topbar__attachment--${localAppProjection ? 'success' : 'neutral'}`}
                        data-testid="tester-local-app-status"
                        aria-label="打开 Local App 权限测试"
                        onClick={() => setPermissionLabOpen(true)}
                      >
                        <span className="workbench-topbar__dot" aria-hidden="true" />
                        <span>Local app</span>
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
