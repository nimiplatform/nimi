import { Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconButton, LoadingSkeleton, nimiToast, OverlayShell, StatusBadge, Tooltip } from '@nimiplatform/kit/ui';
import { PanelRight } from 'lucide-react';
import { createBrowserDataUrlAttachmentAdapter, useChatComposer, type BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { useTranslation } from '../../shell/i18n/index.js';
import { useTesterRendererHost } from '../../renderer/context.js';
import { type TesterCapability } from '../tester-capabilities.js';
import { nonEmptyEmbeddingInputs, summarizeTesterCapabilityParameters, type TesterEmbeddingParameters, type TesterSpeechTranscribeParameters } from '../tester-capability-parameters.js';
import { getTesterRunIntentLabel, restoreTesterCapabilityRunResult, type TesterRunConfigSnapshot, type TesterRunHistory, type TesterRunHistoryRecord } from '../tester-history.js';
import type { TesterCapabilityRunResult, TesterRuntimeInspection } from '../tester-runtime.js';
import { capabilityUnavailable } from '../tester-unavailable.js';
import { getCapabilityStudioProfile } from './capability-studio-profiles.js';
import { CapabilityRunHistory, DrawerErrorBoundary, TesterAiConfigSettingsPanel, artifactExtension, downloadArtifactUrl, downloadTextFile, presetFor, resultPlainText, statusForCapability, type CapabilityStatus, type SectionAITestingProps } from './section-ai-testing-surface.js';
import { TextStudioComposer, TextStudioStartState } from './section-ai-testing-composer.js';
import { CapabilityParameterPanel } from './section-ai-testing-parameters.js';
import { TextStudioResultState } from './section-ai-testing-result.js';
import { canConfigureRunTarget, createRunConfigSnapshot, effectiveTextStudioPromptStyle, textStudioDirectiveForTarget, textStudioRunTargetIntentSummary, textStudioRuntimePrompt, useTesterRunTargetSummary, type TextStudioActiveRun } from './section-ai-testing-run.js';
import { TesterCapabilityParameterContext, TesterHistoryLoadContext } from './workbench-context.js';

// Admission pill labels are keyed by the typed status so locale changes do not
// touch the admission state machine in section-ai-testing-admission.ts.
const ADMISSION_STATUS_LABEL_KEY: Record<CapabilityStatus['label'], string> = {
  configured: 'StudioShell.statusConfigured',
  blocked: 'StudioShell.statusBlocked',
  'not admitted': 'StudioShell.statusNotAdmitted',
  'SDK gap': 'StudioShell.statusSdkGap',
  'tauri-only': 'StudioShell.statusTauriOnly',
  checking: 'StudioShell.statusChecking',
};

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
  aiConfigRefreshKey,
}: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  lastResult: TesterCapabilityRunResult | null;
  onResult: (result: TesterCapabilityRunResult, prompt: string, runConfig?: TesterRunConfigSnapshot) => TesterRunHistoryRecord | null | Promise<TesterRunHistoryRecord | null>;
  verboseConsole: boolean;
  draftPersistence: boolean;
  onOpenConfig: () => void;
  history: TesterRunHistory | null;
  historySelectionRequest: { requestId: number; record: TesterRunHistoryRecord } | null;
  onSelectHistoryRun: (record: TesterRunHistoryRecord) => void;
  headerActions?: ReactNode;
  aiConfigRefreshKey: number;
}) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const historyLoad = useContext(TesterHistoryLoadContext);
  const parameterStore = useContext(TesterCapabilityParameterContext);
  const profile = getCapabilityStudioProfile(capability.id);
  const preset = useMemo(() => presetFor(capability), [capability]);
  const [prompt, setPrompt] = useState(() => (
    rendererHost.app.projection.promptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence).prompt ?? preset.prompt
  ));
  const [context, setContext] = useState('');
  const [running, setRunning] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<TextStudioActiveRun | null>(null);
  const [sessionRuns, setSessionRuns] = useState<Record<string, TextStudioActiveRun>>({});
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [historyFilterResetNonce, setHistoryFilterResetNonce] = useState(0);
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
  const currentResult = activeRun
    ? activeRun.result ?? (activeRun.record ? restoreTesterCapabilityRunResult(activeRun.record) : null)
    : lastResult?.capabilityId === capability.id ? lastResult : null;
  const headerResult = hasActiveRun ? currentResult : null;
  const runTarget = useTesterRunTargetSummary(capability, runtime, aiConfigRefreshKey);
  const admission = statusForCapability(capability, runTarget, headerResult);
  const isWorldTour = capability.execution === 'standalone-tauri';
  const requiresPrompt = profile.inputKind !== 'none';
  const supportsMedia = profile.supportsAttachments;
  const capabilityParameters = parameterStore?.state[capability.id] ?? {};
  const parameterSummary = summarizeTesterCapabilityParameters(capability.id, capabilityParameters);
  const hasAlternativeInput = capability.id === 'text.embed'
    ? nonEmptyEmbeddingInputs(capabilityParameters as TesterEmbeddingParameters).length > 0
    : capability.id === 'audio.transcribe'
      ? Boolean((capabilityParameters as TesterSpeechTranscribeParameters).audioFile)
      : false;

  useEffect(() => {
    if (historyLoad?.error) setHistoryCollapsed(false);
  }, [historyLoad?.error]);

  function updatePrompt(nextPrompt: string) {
    setPrompt(nextPrompt);
    void rendererHost.app.commands.savePromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, nextPrompt, draftPersistence);
  }

  useEffect(() => {
    const draft = rendererHost.app.projection.promptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence);
    setPrompt(draft.prompt ?? preset.prompt);
    setContext('');
    setActiveRun(null);
    setSessionRuns({});
  }, [capability.id, draftPersistence, preset, rendererHost]);

  async function run(nextPrompt = prompt, nextContext = context) {
    const displayPrompt = nextPrompt.trim();
    if (requiresPrompt && !displayPrompt) return;
    if (!runTarget.canDispatch) return;
    const startedAt = rendererHost.clock.now();
    const pendingRun: TextStudioActiveRun = {
      id: `pending-${startedAt}`,
      prompt: displayPrompt || preset.prompt,
      context: nextContext.trim(),
      createdAt: new Date(startedAt).toISOString(),
      result: null,
      record: null,
      error: null,
    };
    setActiveRun(pendingRun);
    setRunning(true);
    try {
      let result: TesterCapabilityRunResult;
      try {
        if (isWorldTour) {
          const fixture = await rendererHost.app.commands.resolveWorldTourFixture({});
          const opened = await rendererHost.app.commands.openWorldTourWindow({ manifestPath: fixture.manifestPath });
          result = {
            ok: true,
            capabilityId: capability.id,
            capabilityLabel: t(capability.labelKey),
            message: t('StudioShell.worldTourViewerMessage', { manifestPath: fixture.manifestPath }),
            output: {
              kind: 'text',
              text: t('StudioShell.worldTourViewerOutput', { windowLabel: opened.windowLabel }),
              finishReason: 'viewer-opened',
              streamed: false,
            },
          };
        } else {
          const isStreaming = capability.id === 'chat.stream';
          if (isStreaming) setStreamingText('');
          const directive = textStudioDirectiveForTarget(runTarget, profile);
          result = await rendererHost.sdk.runCapability({
            capabilityId: capability.id,
            prompt: capability.id === 'audio.transcribe'
              ? displayPrompt
              : textStudioRuntimePrompt(displayPrompt, nextContext, directive),
            scenarioId: preset.id,
            onPartial: isStreaming ? setStreamingText : undefined,
            attachments: supportsMedia ? [...composerState.attachments] : undefined,
            parameters: capabilityParameters,
          });
        }
      } catch (error) {
        result = capabilityUnavailable(
          capability,
          'runtime-call-failed',
          error instanceof Error ? error.message : String(error || t('Unavailable.title.runtimeCallFailed')),
        );
      }
      const runConfig = createRunConfigSnapshot({
        target: runTarget,
        promptStyle: profile.controls.includes('tone') || profile.controls.includes('length')
          ? effectiveTextStudioPromptStyle(runTarget)
          : null,
        context: nextContext,
        attachmentCount: supportsMedia ? composerState.attachments.length : 0,
        requestParameters: parameterSummary,
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
    void rendererHost.app.commands.copyText(text)
      .then((result) => {
        if (result.ok) {
          nimiToast.success(t('Common.copied'));
        } else {
          nimiToast.danger(t('Common.copyFailed'));
        }
      })
      .catch(() => {
        nimiToast.danger(t('Common.copyFailed'));
      });
  }

  function handleDownload() {
    if (!currentResult) return;
    const stamp = new Date(rendererHost.clock.now()).toISOString().replace(/[:.]/g, '-');
    if (currentResult.ok && currentResult.output.kind === 'artifacts') {
      const output = currentResult.output;
      const firstArtifact = output.firstArtifact;
      if (!firstArtifact?.url) return;
      void downloadArtifactUrl(
        rendererHost.app.commands,
        `${capability.id}-${stamp}.${artifactExtension(firstArtifact.mimeType)}`,
        firstArtifact.url,
      );
      return;
    }
    const text = resultPlainText(currentResult);
    if (!text) return;
    void downloadTextFile(rendererHost.app.commands, `${capability.id}-${stamp}.txt`, text);
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
      intentLabel={textStudioRunTargetIntentSummary(runTarget)}
      running={running}
      attachments={composerState.attachments}
      onOpenAttachmentPicker={composerState.openAttachmentPicker}
      onRemoveAttachment={composerState.removeAttachment}
      canDispatch={runTarget.canDispatch}
      canConfigureIntent={canConfigureRunTarget(runTarget)}
      intentConfigurable={capability.execution === 'runtime-sdk'}
      compact={Boolean(activeRun)}
      parameterPanel={parameterStore && capability.execution === 'runtime-sdk' && capability.id !== 'speech.bundle' ? (
        <CapabilityParameterPanel
          capabilityId={capability.id}
          source={runTarget.source}
          parameters={capabilityParameters}
          disabled={running}
          onChange={(next) => parameterStore.setParameters(capability.id, next)}
        />
      ) : undefined}
      parametersActive={Object.keys(parameterSummary).length > 0}
      hasAlternativeInput={hasAlternativeInput}
      onPromptChange={updatePrompt}
      onContextChange={setContext}
      onOpenIntentConfig={onOpenConfig}
      onSubmit={() => void run()}
    />
  );
  const showAdmissionBadge = true;

  function handleHistoryCollapseToggle() {
    if (!historyCollapsed) {
      setHistoryFilterResetNonce((value) => value + 1);
    }
    setHistoryCollapsed((value) => !value);
  }

  return (
    <div className={hasActiveRun ? 'studio studio--has-run' : 'studio studio--landing'}>
      <div className="studio__workspace studio__workspace--with-history">
        <div className="studio__primary">
          <header className="studio__head">
            <div className="studio__title">
              {showAdmissionBadge ? (
                <StatusBadge tone={admission.tone} shape="dot">{t(ADMISSION_STATUS_LABEL_KEY[admission.label])}</StatusBadge>
              ) : null}
            </div>
            <div className="studio__head-actions">
              {headerActions}
              <Tooltip
                content={historyCollapsed ? t('StudioShell.showHistory') : t('StudioShell.hideHistory')}
                placement="bottom"
              >
                <IconButton
                  type="button"
                  className={historyCollapsed ? 'studio-history-toggle' : 'studio-history-toggle studio-history-toggle--expanded'}
                  aria-label={historyCollapsed ? t('StudioShell.showHistory') : t('StudioShell.hideHistory')}
                  aria-expanded={!historyCollapsed}
                  onClick={handleHistoryCollapseToggle}
                  icon={<PanelRight size={17} strokeWidth={1.8} aria-hidden="true" />}
                />
              </Tooltip>
            </div>
          </header>
          <main className="studio__stage">
            {hasActiveRun && activeRun ? (
              <TextStudioResultState
                capability={capability}
                activeRun={activeRun}
                admission={admission}
                intentLabel={activeRun.record ? getTesterRunIntentLabel(activeRun.record) : runTarget.intentLabel}
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
          collapsed={historyCollapsed}
          filterResetNonce={historyFilterResetNonce}
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
  const { t } = useTranslation();
  const [configOpen, setConfigOpen] = useState(false);
  const [aiConfigRefreshKey, setAIConfigRefreshKey] = useState(0);

  return (
    <div
      className="section-ai-testing"
      data-testid="nimi-tester-section-ai-testing"
      data-config-open={configOpen ? '' : undefined}
    >
      <div className="section-ai-testing__main">
        <TextStudioShell
          capability={capability}
          runtime={runtime}
          lastResult={lastResult}
          onResult={onResult}
          verboseConsole={verboseConsole}
          draftPersistence={draftPersistence}
          onOpenConfig={() => setConfigOpen(true)}
          history={history}
          historySelectionRequest={historySelectionRequest}
          onSelectHistoryRun={onSelectHistoryRun}
          headerActions={headerActions}
          aiConfigRefreshKey={aiConfigRefreshKey}
        />
      </div>

      <OverlayShell
        open={configOpen}
        kind="drawer"
        size="M"
        title={t('ModelConfig.drawerTitle')}
        description={t('ModelConfig.drawerDescription')}
        panelClassName="flex flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto p-0"
        onClose={() => setConfigOpen(false)}
      >
        <DrawerErrorBoundary onClose={() => setConfigOpen(false)}>
          <Suspense fallback={<div className="p-5"><LoadingSkeleton lines={4} /></div>}>
            <TesterAiConfigSettingsPanel
              runtime={runtime}
              capabilityId={capability.capabilityContract ?? capability.id}
              onConfigChanged={() => setAIConfigRefreshKey((value) => value + 1)}
              onClose={() => setConfigOpen(false)}
            />
          </Suspense>
        </DrawerErrorBoundary>
      </OverlayShell>
    </div>
  );
}
