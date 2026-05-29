import { useCallback, useEffect, useMemo, useState } from 'react';
import './tester-workbench.css';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { shouldPersistTesterArtifactRecord } from './tester-artifact-persistence.js';
import { appendTesterRunHistory, loadTesterRunHistory, type TesterRunHistory } from './tester-history.js';
import { appendTesterImageHistoryRecord } from './tester-image-history.js';
import { loadTesterAIConfigSummary, type TesterAIConfigSummary } from './tester-ai-config.js';
import { inspectRuntimeReadiness, type TesterCapabilityRunResult } from './tester-runtime.js';
import {
  loadTesterPreferences,
  resetTesterPreferences,
  saveTesterPreferences,
  type TesterPreferences,
  type TesterPreferenceStoreStatus,
} from './tester-preferences.js';
import { testerTestIds } from './tester-test-ids.js';
import { appId, scaffoldProfile } from '../shell/auth/runtime-platform.js';
import { WorkbenchSideNav } from './workbench/workbench-side-nav.js';
import { WorkbenchCommandBar } from './workbench/workbench-command-bar.js';
import { SectionAppLab } from './workbench/section-app-lab.js';
import { SectionAITesting } from './workbench/section-ai-testing.js';
import { SectionRuns } from './workbench/section-runs.js';
import { SectionArtifacts } from './workbench/section-artifacts.js';
import { SectionDiagnostics } from './workbench/section-diagnostics.js';
import { SectionSettings } from './workbench/section-settings.js';
import type { WorkbenchSectionId } from './workbench/workbench-context.js';
import { KitComponentGallery } from './kit-component-gallery.js';

const APP_VERSION = '0.1.0-dev';
const initialCapabilityId: TesterCapabilityId = 'text.generate';

type TesterWorkbenchProps = {
  title: string;
};

function makeRecordId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function hasTraceMetadata(result: TesterCapabilityRunResult): boolean {
  if (!result.ok || !result.trace) return false;
  return Boolean(result.trace.traceId || result.trace.modelResolved || result.trace.routeDecision);
}

export function TesterWorkbench(_props: TesterWorkbenchProps) {
  const [section, setSection] = useState<WorkbenchSectionId>('app-lab');
  const [activeCapabilityId, setActiveCapabilityId] = useState<TesterCapabilityId>(initialCapabilityId);
  const [summary, setSummary] = useState<TesterAIConfigSummary | null>(null);
  const [history, setHistory] = useState<TesterRunHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TesterCapabilityRunResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [preferenceState, setPreferenceState] = useState<{
    preferences: TesterPreferences;
    status: TesterPreferenceStoreStatus;
  }>(() => loadTesterPreferences());

  const capability = useMemo(() => getTesterCapability(activeCapabilityId), [activeCapabilityId]);

  const refreshHistory = useCallback(async () => {
    try {
      const next = await loadTesterRunHistory();
      setHistory(next);
      setHistoryError(null);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error || 'History load failed.'));
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
        providerCatalogSurface: 'runtimeAdmin.listConnectors/listConnectorModels',
        appLocalProviderDefaults: false,
      });
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
    void refreshHistory();
  }, [refreshSummary, refreshHistory]);

  const handleCaptureEvidence = useCallback(() => {
    if (typeof window === 'undefined') return;
    void window.print();
  }, []);

  const handlePreferenceChange = useCallback((patch: Partial<Omit<TesterPreferences, 'schemaVersion'>>) => {
    setPreferenceState((current) => saveTesterPreferences({
      ...current.preferences,
      ...patch,
    }));
  }, []);

  const handleResetPreferences = useCallback(() => {
    setPreferenceState(resetTesterPreferences());
  }, []);

  const handleCapabilityResult = useCallback(
    async (result: TesterCapabilityRunResult, prompt: string) => {
      setLastResult(result);
      const runId = makeRecordId();
      const createdAt = new Date().toISOString();
      try {
        const next = await appendTesterRunHistory({
          id: runId,
          capabilityId: result.capabilityId,
          prompt,
          status: result.capabilityId === 'world.generate' && result.ok ? 'local-fixture' : result.ok ? 'ready' : 'unavailable',
          message: result.message,
          createdAt,
        });
        setHistory(next);
        setHistoryError(null);
        if (shouldPersistTesterArtifactRecord(result)) {
          const firstArtifact = result.output.firstArtifact;
          await appendTesterImageHistoryRecord({
            id: runId,
            runId,
            kind: 'runtime-media',
            capabilityId: result.capabilityId,
            capabilityLabel: result.capabilityLabel,
            title: firstArtifact?.displayName || firstArtifact?.artifactId || result.output.jobId || result.capabilityLabel,
            status: 'ready',
            createdAt,
            artifactCount: result.output.artifactCount,
            artifactLabel: firstArtifact?.displayName || firstArtifact?.artifactId,
            mimeType: firstArtifact?.mimeType,
            url: firstArtifact?.url,
            jobId: result.output.jobId,
            jobState: result.output.jobState,
            message: result.message,
            traceState: hasTraceMetadata(result) ? 'captured' : 'not-captured',
            traceId: result.trace?.traceId,
          });
        }
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : String(error || 'History persistence failed.'));
      }
      if (preferenceState.preferences.evidenceCaptureMode === 'after-run') {
        handleCaptureEvidence();
      }
    },
    [handleCaptureEvidence, preferenceState.preferences.evidenceCaptureMode],
  );

  const handleRunCheck = useCallback(async () => {
    setChecking(true);
    try {
      const inspection = await inspectRuntimeReadiness();
      setSummary({
        runtime: inspection,
        schedulingOwner: 'runtime',
        providerCatalogSurface: 'runtimeAdmin.listConnectors/listConnectorModels',
        appLocalProviderDefaults: false,
      });
      await refreshHistory();
    } finally {
      setChecking(false);
    }
  }, [refreshHistory]);

  const handleSelectCapability = useCallback((id: TesterCapabilityId) => {
    setActiveCapabilityId(id);
    if (section !== 'app-lab' && section !== 'ai-capabilities') {
      setSection('app-lab');
    }
  }, [section]);

  return (
    <main className="workbench" data-testid={testerTestIds.root}>
      <WorkbenchSideNav
        activeId={section}
        onSelect={setSection}
        appId={appId}
        appVersion={APP_VERSION}
      />
      <div className="workbench__main">
        <WorkbenchCommandBar
          appId={appId}
          scaffoldProfile={scaffoldProfile}
          runtime={summary?.runtime ?? null}
          busy={checking}
          onRunCheck={handleRunCheck}
          onCaptureEvidence={handleCaptureEvidence}
          evidenceCaptureMode={preferenceState.preferences.evidenceCaptureMode}
        />
        <div className="workbench__content">
          {section === 'app-lab' ? (
            <SectionAppLab
              activeId={activeCapabilityId}
              onSelect={handleSelectCapability}
              capability={capability}
              onResult={handleCapabilityResult}
              summary={summary}
              history={history}
              lastResult={lastResult}
              historyError={historyError}
              onOpenKitComponents={() => setSection('ui-recipes')}
              verboseConsole={preferenceState.preferences.verboseConsole}
              draftPersistence={preferenceState.preferences.draftPersistence}
            />
          ) : null}
          {section === 'ai-capabilities' ? (
            <SectionAITesting
              activeId={activeCapabilityId}
              onSelect={handleSelectCapability}
              capability={capability}
              onResult={handleCapabilityResult}
              summary={summary}
              history={history}
              lastResult={lastResult}
              historyError={historyError}
              onOpenKitComponents={() => setSection('ui-recipes')}
              verboseConsole={preferenceState.preferences.verboseConsole}
              draftPersistence={preferenceState.preferences.draftPersistence}
            />
          ) : null}
          {section === 'ui-recipes' ? <KitComponentGallery onOpenSection={setSection} /> : null}
          {section === 'runs' ? <SectionRuns history={history} onOpenSection={setSection} /> : null}
          {section === 'artifacts' ? <SectionArtifacts onOpenSection={setSection} /> : null}
          {section === 'runtime-trace' || section === 'boundary-checks' ? (
            <SectionDiagnostics
              summary={summary}
              section={section}
              history={history}
              historyError={historyError}
              lastResult={lastResult}
            />
          ) : null}
          {section === 'settings' ? (
            <SectionSettings
              appId={appId}
              scaffoldProfile={scaffoldProfile}
              summary={summary}
              history={history}
              historyError={historyError}
              preferences={preferenceState.preferences}
              storeStatus={preferenceState.status}
              onPreferenceChange={handlePreferenceChange}
              onResetPreferences={handleResetPreferences}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
