import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StatusBadge } from '@nimiplatform/kit/ui';
import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import { createBrowserDataUrlAttachmentAdapter, useChatComposer, type BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { type TesterCapability, type TesterCapabilityId } from '../tester-capabilities.js';
import { CAPABILITY_TO_SECTION } from '../tester-capability-sections.js';
import { getTesterRunModelLabel, type TesterRunConfigSnapshot, type TesterRunHistory, type TesterRunHistoryRecord } from '../tester-history.js';
import { runTesterCapability, type TesterCapabilityRunResult, type TesterRuntimeInspection } from '../tester-runtime.js';
import { loadTesterPromptDraft, saveTesterPromptDraft, type TesterPromptDraftStoreStatus } from '../tester-preferences.js';
import { openWorldTourWindow, resolveWorldTourFixture } from '../world-tour/world-tour-shared.js';
import { getCapabilityStudioProfile } from './capability-studio-profiles.js';
import { CapabilityRunHistory, DrawerErrorBoundary, STATUS_PILL_LABEL, TesterAiConfigSettingsPanel, artifactExtension, downloadArtifactUrl, downloadTextFile, presetFor, resultPlainText, statusForCapability, type SectionAITestingProps } from './section-ai-testing-surface.js';
import { TextStudioComposer, TextStudioStartState } from './section-ai-testing-composer.js';
import { TextStudioResultState } from './section-ai-testing-result.js';
import { canConfigureRunTarget, createRunConfigSnapshot, effectiveTextStudioPromptStyle, textStudioDirectiveForTarget, textStudioModelSummary, textStudioRuntimePrompt, useTesterRunTargetSummary, type TextStudioActiveRun } from './section-ai-testing-run.js';

function TextStudioShell({
  capability,
  runtime,
  lastResult,
  onResult,
  verboseConsole,
  draftPersistence,
  onOpenConfig,
  history,
  historySelectionRequest,
  onSelectHistoryRun,
  headerActions,
}: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  lastResult: TesterCapabilityRunResult | null;
  onResult: (result: TesterCapabilityRunResult, prompt: string, runConfig?: TesterRunConfigSnapshot) => TesterRunHistoryRecord | null | Promise<TesterRunHistoryRecord | null>;
  verboseConsole: boolean;
  draftPersistence: boolean;
  onOpenConfig: (section: CanonicalCapabilitySectionId) => void;
  history: TesterRunHistory | null;
  historySelectionRequest: { requestId: number; record: TesterRunHistoryRecord } | null;
  onSelectHistoryRun: (record: TesterRunHistoryRecord) => void;
  headerActions?: ReactNode;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const preset = useMemo(() => presetFor(capability), [capability]);
  const [prompt, setPrompt] = useState(preset.prompt);
  const [context, setContext] = useState('');
  const [draftStatus, setDraftStatus] = useState<TesterPromptDraftStoreStatus>(() => (
    loadTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence).status
  ));
  const [running, setRunning] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<TextStudioActiveRun | null>(null);
  const [sessionRuns, setSessionRuns] = useState<Record<string, TextStudioActiveRun>>({});
  const attachmentAdapter = useMemo(
    () => createBrowserDataUrlAttachmentAdapter({ idPrefix: 'tester-attachment' }),
    [],
  );
  const composerState = useChatComposer<BrowserDataUrlAttachment>({
    adapter: { submit: async () => {} },
    attachmentAdapter,
    text: prompt,
    onTextChange: updatePrompt,
    disabled: running,
  });
  const hasActiveRun = Boolean(activeRun);
  const currentResult = activeRun?.result ?? (lastResult?.capabilityId === capability.id ? lastResult : null);
  const headerResult = hasActiveRun ? currentResult : null;
  const admission = statusForCapability(capability, runtime, headerResult);
  const runTarget = useTesterRunTargetSummary(capability, runtime);
  const isWorldTour = capability.execution === 'standalone-tauri';
  const requiresPrompt = profile.inputKind !== 'none';
  const supportsMedia = profile.supportsAttachments;

  function updatePrompt(nextPrompt: string) {
    setPrompt(nextPrompt);
    const saved = saveTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, nextPrompt, draftPersistence);
    setDraftStatus(saved.status);
  }

  useEffect(() => {
    const draft = loadTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence);
    setDraftStatus(draft.status);
    setPrompt(draft.prompt ?? preset.prompt);
    setContext('');
    setActiveRun(null);
    setSessionRuns({});
  }, [capability.id, draftPersistence, preset]);

  async function run(nextPrompt = prompt, nextContext = context) {
    const displayPrompt = nextPrompt.trim();
    if (requiresPrompt && !displayPrompt) return;
    if (!runTarget.canDispatch) return;
    const pendingRun: TextStudioActiveRun = {
      id: `pending-${Date.now()}`,
      prompt: displayPrompt || preset.prompt,
      context: nextContext.trim(),
      createdAt: new Date().toISOString(),
      result: null,
      record: null,
      error: null,
    };
    setActiveRun(pendingRun);
    setRunning(true);
    try {
      let result: TesterCapabilityRunResult;
      if (isWorldTour) {
        const fixture = await resolveWorldTourFixture({});
        const opened = await openWorldTourWindow({ manifestPath: fixture.manifestPath });
        result = {
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: `Viewer opened for a Tauri-only local fixture (${fixture.manifestPath}); local fixture record only, with no runtime generation or runtime artifact.`,
          output: {
            kind: 'text',
            text: `Local fixture viewer opened (${opened.windowLabel}). This is not a runtime result or runtime artifact.`,
            finishReason: 'viewer-opened',
            streamed: false,
          },
        };
      } else {
        const isStreaming = capability.id === 'chat.stream';
        if (isStreaming) setStreamingText('');
        const directive = textStudioDirectiveForTarget(runTarget, profile);
        result = await runTesterCapability({
          capabilityId: capability.id,
          prompt: textStudioRuntimePrompt(displayPrompt, nextContext, directive),
          scenarioId: preset.id,
          onPartial: isStreaming ? setStreamingText : undefined,
          attachments: supportsMedia ? [...composerState.attachments] : undefined,
        });
      }
      const runConfig = createRunConfigSnapshot({
        target: runTarget,
        promptStyle: profile.controls.includes('tone') || profile.controls.includes('length')
          ? effectiveTextStudioPromptStyle(runTarget)
          : null,
        context: nextContext,
        attachmentCount: supportsMedia ? composerState.attachments.length : 0,
      });
      const record = await onResult(result, displayPrompt, runConfig);
      const finishedRun: TextStudioActiveRun = {
        ...pendingRun,
        id: record?.id ?? pendingRun.id,
        createdAt: record?.createdAt ?? pendingRun.createdAt,
        result,
        record,
      };
      setSessionRuns((current) => ({ ...current, [finishedRun.id]: finishedRun }));
      setActiveRun(finishedRun);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Runtime call failed.');
      setActiveRun({ ...pendingRun, error: message });
    } finally {
      setRunning(false);
      setStreamingText(null);
    }
  }

  function handleCopy() {
    if (!currentResult) return;
    const text = resultPlainText(currentResult);
    if (!text) return;
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard is best-effort; Download remains the durable export path.
    }
  }

  function handleDownload() {
    if (!currentResult) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (currentResult.ok && currentResult.output.kind === 'artifacts') {
      const output = currentResult.output;
      const firstArtifact = output.firstArtifact;
      if (!firstArtifact?.url) return;
      void downloadArtifactUrl(
        `${capability.id}-${stamp}.${artifactExtension(firstArtifact.mimeType)}`,
        firstArtifact.url,
      );
      return;
    }
    const text = resultPlainText(currentResult);
    if (!text) return;
    void downloadTextFile(`${capability.id}-${stamp}.txt`, text);
  }

  function selectHistoryRun(record: TesterRunHistoryRecord) {
    const sessionRun = sessionRuns[record.id];
    const historyContext = record.runConfig?.promptControls.context ?? '';
    if (sessionRun) {
      setActiveRun(sessionRun);
      updatePrompt(sessionRun.prompt);
      setContext(record.runConfig ? historyContext : sessionRun.context);
      return;
    }
    setActiveRun({
      id: record.id,
      prompt: record.prompt,
      context: historyContext,
      createdAt: record.createdAt,
      result: null,
      record,
      error: null,
    });
    updatePrompt(record.prompt);
    setContext(historyContext);
  }

  useEffect(() => {
    const record = historySelectionRequest?.record;
    if (!record || record.capabilityId !== capability.id) return;
    selectHistoryRun(record);
  }, [historySelectionRequest?.requestId, capability.id]);

  const composer = (
    <TextStudioComposer
      capability={capability}
      prompt={prompt}
      context={context}
      modelLabel={textStudioModelSummary(headerResult, runTarget, activeRun?.record ?? null)}
      running={running}
      attachments={composerState.attachments}
      onOpenAttachmentPicker={composerState.openAttachmentPicker}
      onRemoveAttachment={composerState.removeAttachment}
      canDispatch={runTarget.canDispatch}
      canConfigureTarget={canConfigureRunTarget(runTarget)}
      compact={Boolean(activeRun)}
      onPromptChange={updatePrompt}
      onContextChange={setContext}
      onOpenModelConfig={() => onOpenConfig(CAPABILITY_TO_SECTION[capability.id])}
      onSubmit={() => void run()}
    />
  );
  const showAdmissionBadge = admission.label !== 'ready';

  return (
    <div className={hasActiveRun ? 'studio studio--has-run' : 'studio studio--landing'}>
      <div className="studio__workspace studio__workspace--with-history">
        <div className="studio__primary">
          <header className="studio__head">
            <div className="studio__title">
              <h1>{capability.label}</h1>
              {showAdmissionBadge ? (
                <StatusBadge tone={admission.tone} shape="dot">{STATUS_PILL_LABEL[admission.label]}</StatusBadge>
              ) : null}
            </div>
            {headerActions ? <div className="studio__head-actions">{headerActions}</div> : null}
          </header>
          <main className="studio__stage">
            {hasActiveRun && activeRun ? (
              <TextStudioResultState
                capability={capability}
                activeRun={activeRun}
                admission={admission}
                modelLabel={activeRun.record ? getTesterRunModelLabel(activeRun.record) : runTarget.modelLabel}
                running={running}
                streamingText={streamingText}
                verboseConsole={verboseConsole}
                composer={composer}
                onCopy={handleCopy}
                onDownload={handleDownload}
                onRegenerate={() => void run(activeRun.prompt, activeRun.context)}
              />
            ) : (
              <TextStudioStartState
                capability={capability}
                composer={composer}
              />
            )}
          </main>
        </div>
        <CapabilityRunHistory
          history={history}
          activeRunId={activeRun?.id ?? null}
          onSelectRun={onSelectHistoryRun}
        />
      </div>
    </div>
  );
}

export function SectionAITesting({
  capability,
  onResult,
  summary,
  history,
  lastResult,
  historySelectionRequest,
  onSelectHistoryRun,
  verboseConsole,
  draftPersistence,
  headerActions,
}: SectionAITestingProps) {
  const runtime = summary?.runtime ?? null;
  const [configSection, setConfigSection] = useState<CanonicalCapabilitySectionId | null>(null);

  return (
    <div
      className="section-ai-testing"
      data-testid="nimi-tester-section-ai-testing"
      data-config-open={configSection ? '' : undefined}
    >
      <div className="section-ai-testing__main">
        <TextStudioShell
          capability={capability}
          runtime={runtime}
          lastResult={lastResult}
          onResult={onResult}
          verboseConsole={verboseConsole}
          draftPersistence={draftPersistence}
          onOpenConfig={setConfigSection}
          history={history}
          historySelectionRequest={historySelectionRequest}
          onSelectHistoryRun={onSelectHistoryRun}
          headerActions={headerActions}
        />
      </div>

      {configSection ? (
        <aside className="section-ai-testing__drawer" aria-label="Configure model">
          <DrawerErrorBoundary onClose={() => setConfigSection(null)}>
            <Suspense fallback={<div className="section-ai-testing__drawer-loading">Loading model config...</div>}>
              <TesterAiConfigSettingsPanel
                runtime={runtime}
                initialSection={configSection}
                onClose={() => setConfigSection(null)}
              />
            </Suspense>
          </DrawerErrorBoundary>
        </aside>
      ) : null}
    </div>
  );
}
