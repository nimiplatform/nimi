import { Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, LoadingSkeleton, nimiToast, OverlayShell, StatusBadge, Tooltip } from '@nimiplatform/kit/ui';
import { PanelRight, SquarePen } from 'lucide-react';
import { createBrowserDataUrlAttachmentAdapter, useChatComposer, type BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { notifyStudioAIConfigChanged } from './ai-config.js';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRegistration } from './module-registration.js';
import type { StudioParameterValue } from './parameters.js';
import type { StudioCapabilityRunResult, StudioRuntimeInspection } from './runtime-types.js';
import { getStudioRunIntentLabel, restoreStudioCapabilityRunResult, type StudioRunConfigSnapshot, type StudioRunHistory, type StudioRunHistoryRecord } from './history.js';
import { CapabilityRunHistory, DrawerErrorBoundary, downloadTextFile, resultPlainText, statusForCapability, type CapabilityStatus, type SectionAITestingProps } from './section-ai-testing-surface.js';
import { TextStudioComposer, TextStudioStartState } from './section-ai-testing-composer.js';
import { ScenarioJobStatus } from '@nimiplatform/sdk/runtime/generated';
import {
  canCancelStudioCapabilityRun,
  hasStudioCapabilityRunInput,
  textStudioMediaInputAvailable,
  usesVerbatimStudioPrompt,
} from './section-ai-testing-input.js';
import { TextStudioResultState } from './section-ai-testing-result.js';
import { readStudioTextReplayMedia } from './text-media-replay.js';
import { revealStudioAsset } from './section-ai-testing-output.js';
import { canConfigureRunTarget, createRunConfigSnapshot, effectiveTextStudioPromptStyle, textStudioDirectiveForTarget, textStudioRunTargetIntentSummary, textStudioRuntimePrompt, useStudioRunTargetSummary, type TextStudioActiveRun } from './section-ai-testing-run.js';
import { StudioCapabilityParameterContext, StudioHistoryLoadContext, StudioHistoryPanelContext } from './contexts.js';

// Admission pill labels are keyed by the typed status so locale changes do not
// touch the admission state machine in section-ai-testing-admission.ts.
const ADMISSION_STATUS_LABEL_KEY: Partial<Record<CapabilityStatus['label'], string>> = {
  configured: 'StudioShell.statusConfigured',
  blocked: 'StudioShell.statusBlocked',
  'not admitted': 'StudioShell.statusNotAdmitted',
  'SDK gap': 'StudioShell.statusSdkGap',
  checking: 'StudioShell.statusChecking',
};

function TextStudioShell({
  registration,
  registrations,
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
  registration: StudioCapabilityRegistration;
  registrations: readonly StudioCapabilityRegistration[];
  runtime: StudioRuntimeInspection | null;
  lastResult: StudioCapabilityRunResult | null;
  onResult: (result: StudioCapabilityRunResult, prompt: string, runConfig?: StudioRunConfigSnapshot) => StudioRunHistoryRecord | null | Promise<StudioRunHistoryRecord | null>;
  verboseConsole: boolean;
  draftPersistence: boolean;
  onOpenConfig?: () => void;
  history: StudioRunHistory | null;
  historySelectionRequest: { requestId: number; record: StudioRunHistoryRecord } | null;
  onSelectHistoryRun: (record: StudioRunHistoryRecord) => void;
  headerActions?: ReactNode;
}) {
  const rendererHost = useAIStudioHost();
  const t = rendererHost.translate;
  const capability = registration.descriptor;
  const historyLoad = useContext(StudioHistoryLoadContext);
  const parameterStore = useContext(StudioCapabilityParameterContext);
  const ParameterPanel = registration.parameterPanel;
  const profile = registration.profile;
  const preset = registration.preset;
  const [prompt, setPrompt] = useState(() => (
    rendererHost.app.projection.promptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence).prompt ?? preset.prompt
  ));
  const [context, setContext] = useState('');
  const [executingRun, setExecutingRun] = useState<TextStudioActiveRun | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [mediaInputState, setMediaInputState] = useState<'checking' | 'supported' | 'unsupported' | 'unavailable'>('checking');
  const [activeRun, setActiveRun] = useState<TextStudioActiveRun | null>(null);
  const [sessionRuns, setSessionRuns] = useState<Record<string, TextStudioActiveRun>>({});
  const historyPanel = useContext(StudioHistoryPanelContext);
  const historyCollapsed = historyPanel?.collapsed ?? true;
  const runSeqRef = useRef(0);
  const abortControllerRef = useRef<{ runId: string; controller: AbortController } | null>(null);
  const running = executingRun !== null;
  const displayingExecution = executingRun !== null && activeRun?.id === executingRun.id;
  const displayedRun = displayingExecution ? executingRun : activeRun;
  const expandedHistoryErrorRef = useRef<string | null>(null);
  const attachmentAdapter = useMemo(
    () => createBrowserDataUrlAttachmentAdapter({ idPrefix: 'studio-attachment', ...((capability.id === 'vision.locate') ? { maxAttachments: 1, accept: ['image/png','image/jpeg','image/webp','image/gif'] } : capability.id === 'text.generate' ? { maxAttachments: 1, accept: ['image/jpeg', 'audio/wav', 'audio/mpeg', 'video/mp4'] } : {}) }),
    [capability.id],
  );
  const composerState = useChatComposer<BrowserDataUrlAttachment>({
    adapter: { submit: async () => {} },
    attachmentAdapter,
    text: prompt,
    onTextChange: updatePrompt,
    disabled: running,
  });
  useEffect(() => {
    if (capability.id !== 'text.generate') return;
    let disposed = false;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      setMediaInputState('checking');
      void rendererHost.sdk.aiConfig.getSnapshot().then((snapshot) => {
        if (!disposed && generation === current) {
          setMediaInputState(textStudioMediaInputAvailable(snapshot, composerState.attachments[0]?.mimeType) ? 'supported' : 'unsupported');
        }
      }, () => {
        if (!disposed && generation === current) setMediaInputState('unavailable');
      });
    };
    refresh();
    const unsubscribe = rendererHost.app.events.subscribeAIConfigRefresh(refresh);
    return () => { disposed = true; generation += 1; unsubscribe(); };
  }, [capability.id, rendererHost, composerState.attachments[0]?.mimeType]);
  const hasRequiredImage = capability.id !== 'vision.locate'
    || (composerState.attachments.length === 1 && composerState.attachments[0]?.kind === 'image');
  const hasActiveRun = Boolean(displayedRun);
  const currentResult = displayedRun
    ? displayedRun.result ?? (displayedRun.record
      ? restoreStudioCapabilityRunResult(displayedRun.record, (id) => (
        registrations.find((item) => item.descriptor.id === id)?.descriptor.label ?? null
      ))
      : null)
    : lastResult?.capabilityId === capability.id ? lastResult : null;
  const headerResult = hasActiveRun ? currentResult : null;
  const savedTextMedia = (currentResult?.ok && currentResult.output.kind === 'text' ? currentResult.output.sourceImage : undefined)
    ?? displayedRun?.replayMedia;
  const displayedAttachmentCount = displayedRun?.record?.runConfig?.promptControls.attachmentCount
    ?? displayedRun?.attachmentCount ?? (savedTextMedia ? 1 : 0);
  const textMediaReplayable = capability.id !== 'text.generate' ||
    (displayedAttachmentCount === 0 && !savedTextMedia) ||
    (displayedAttachmentCount <= 1 && Boolean(savedTextMedia) && displayedRun?.record?.status !== 'unavailable');
  const runTarget = useStudioRunTargetSummary(registration, runtime);
  const admission = statusForCapability(registration, runTarget, headerResult, t);
  const requiresPrompt = profile.inputKind !== 'none';
  const supportsMedia = profile.supportsAttachments;
  const attachmentBlocked = capability.id === 'text.generate' && composerState.attachments.length > 0 && mediaInputState !== 'supported';
  const capabilityParameters = parameterStore?.state[capability.id] ?? registration.parameters.initial();
  const effectiveCapabilityParameters = useMemo(() => registration.parameters.project(
    runTarget.source,
    capabilityParameters,
  ), [capabilityParameters, registration.parameters, runTarget.source]);
  const parameterSummary = registration.parameters.summarize(effectiveCapabilityParameters);
  const hasAlternativeInput = registration.parameters.hasAlternativeInput(capabilityParameters);
  const recordedInput = registration.parameters.recordedInput;
  const displayedRunPrompt = displayedRun?.prompt;
  // A parameter-owned input reruns the displayed run's recorded request, which
  // stays valid however the current parameters have changed since.
  const displayedRunParameters = useMemo(() => {
    if (!displayedRun || displayedRun.record?.status === 'unavailable' || displayedRun.record?.inputTruncated) return null;
    if (registration.parameters.restoreRecordedParameters) {
      return registration.parameters.restoreRecordedParameters(
        displayedRun.record?.runConfig?.target.params,
        displayedRun.record?.result,
        displayedRunPrompt,
      );
    }
    if (recordedInput) {
      const restored = displayedRunPrompt === undefined ? null : recordedInput.decode(displayedRunPrompt);
      return restored ? { ...capabilityParameters, ...restored } : null;
    }
    // A parameter-owned media request needs an explicit restoration rule.
    // The current draft is not a source for a historical request.
    return profile.requiresParameterInput ? null : capabilityParameters;
  }, [displayedRun, displayedRunPrompt, recordedInput, registration.parameters, profile.requiresParameterInput, capabilityParameters]);
  const displayedRunReplayable = displayedRunParameters !== null
    && (!profile.requiresParameterInput || registration.parameters.hasAlternativeInput(displayedRunParameters));
  const replayAssetPaths = ['sourceRelativePath', 'targetRelativePath']
    .map(key => displayedRunParameters?.[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const replayAssetKey = JSON.stringify([displayedRun?.id, ...replayAssetPaths]);
  const [replayAssets, setReplayAssets] = useState<{ key: string; available: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (!displayedRunReplayable || replayAssetPaths.length === 0) return;
    void Promise.all(replayAssetPaths.map(relativePath => rendererHost.sdk.assets.stat(relativePath))).then(
      () => { if (active) setReplayAssets({ key: replayAssetKey, available: true }); },
      () => { if (active) setReplayAssets({ key: replayAssetKey, available: false }); },
    );
    return () => { active = false; };
  }, [displayedRunReplayable, replayAssetKey, rendererHost.sdk.assets]);
  const replayAssetsChecking = replayAssetPaths.length > 0 && replayAssets?.key !== replayAssetKey;
  const replayAssetsAvailable = replayAssetPaths.length === 0
    || (replayAssets?.key === replayAssetKey && replayAssets.available);

  useEffect(() => {
    const error = historyLoad?.error ?? null;
    if (!error) {
      expandedHistoryErrorRef.current = null;
      return;
    }
    if (expandedHistoryErrorRef.current === error) return;
    expandedHistoryErrorRef.current = error;
    historyPanel?.setCollapsed(false);
  }, [historyLoad?.error, historyPanel]);

  function updatePrompt(nextPrompt: string) {
    setPrompt(nextPrompt);
    void rendererHost.app.commands.savePromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, nextPrompt, draftPersistence);
  }

  useEffect(() => {
    abortControllerRef.current?.controller.abort('studio-capability-changed');
    abortControllerRef.current = null;
    const draft = rendererHost.app.projection.promptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence);
    runSeqRef.current += 1;
    setPrompt(draft.prompt ?? preset.prompt);
    setContext('');
    setActiveRun(null);
    setSessionRuns({});
    setExecutingRun(null);
    setCancelRequested(false);
    setStreamingText(null);
  }, [capability.id, draftPersistence, preset, rendererHost]);

  // Replaying a run whose input lives in its parameters rebuilds them from the
  // recorded request instead of reading the current parameters.
  function runParametersFor(replayedInput: string | null): StudioParameterValue | null {
    return replayedInput === null ? capabilityParameters : displayedRunParameters;
  }

  async function run(nextPrompt = prompt, nextContext = context, replay = false) {
    if (abortControllerRef.current) return;
    if (replay && !textMediaReplayable) return;
    if (replay && (!displayedRunReplayable || !replayAssetsAvailable)) return;
    const replayTextMedia = replay && capability.id === 'text.generate';
    let runAttachments = replayTextMedia ? [] : [...composerState.attachments];
    const attachmentCount = supportsMedia ? (replayTextMedia ? (savedTextMedia ? 1 : displayedAttachmentCount) : runAttachments.length) : 0;
    const runParameters = runParametersFor(replay ? nextPrompt : null);
    if (!runParameters) return;
    const runEffectiveParameters = replay && registration.parameters.restoreRecordedParameters
      ? runParameters
      : registration.parameters.project(runTarget.source, runParameters);
    const runHasAlternativeInput = registration.parameters.hasAlternativeInput(runParameters);
    // Raw document inputs retain their original whitespace so annotation
    // offsets refer to the exact text the user entered. A parameter-owned input
    // records its complete encoded request.
    const displayPrompt = recordedInput
      ? (runHasAlternativeInput ? recordedInput.encode(runEffectiveParameters) : '')
      : profile.rawPrompt ? nextPrompt : nextPrompt.trim();
    if (!hasStudioCapabilityRunInput({ requiresPrompt, prompt: displayPrompt, hasAlternativeInput: runHasAlternativeInput })) return;
    if ((capability.id === 'music.transcribe' || capability.id === 'audio.voice.convert' || capability.id === 'audio.separate') && !runHasAlternativeInput) return;
    if (profile.requiresParameterInput && !runHasAlternativeInput) return;
    if (!hasRequiredImage) return;
    if (!runTarget.canDispatch) return;
    const runSeq = runSeqRef.current + 1;
    runSeqRef.current = runSeq;
    const abortController = new AbortController();
    const startedAt = rendererHost.clock.now();
    const pendingRun: TextStudioActiveRun = {
      attachmentCount,
      ...(replayTextMedia && savedTextMedia ? { replayMedia: savedTextMedia } : {}),
      id: `pending-${startedAt}`,
      prompt: displayPrompt || (runHasAlternativeInput ? '' : preset.prompt),
      context: nextContext.trim(),
      createdAt: new Date(startedAt).toISOString(),
      result: null,
      record: null,
      error: null,
    };
    abortControllerRef.current = { runId: pendingRun.id, controller: abortController };
    setActiveRun(pendingRun);
    setExecutingRun(pendingRun);
    setCancelRequested(false);
    const runConfig = createRunConfigSnapshot({
      target: runTarget,
      promptStyle: profile.controls.includes('tone') || profile.controls.includes('length')
        ? effectiveTextStudioPromptStyle(runTarget) : null,
      context: nextContext, attachmentCount,
      requestParameters: registration.parameters.summarize(runEffectiveParameters),
    });
    try {
      let result: StudioCapabilityRunResult;
      try {
        if (replayTextMedia && savedTextMedia) {
          try {
            runAttachments = [await readStudioTextReplayMedia(rendererHost.sdk.assets, savedTextMedia, abortController.signal)];
          } catch (error) {
            if (abortController.signal.aborted) throw error;
            throw new Error(t('Studio.profiles.textGenerate.savedMediaUnavailable'));
          }
        }
        abortController.signal.throwIfAborted();
        const isStreaming = capability.id === 'chat.stream';
        if (isStreaming) setStreamingText('');
        const directive = textStudioDirectiveForTarget(runTarget, profile);
        if (capability.id === 'text.generate' && runAttachments.length > 0 &&
            !textStudioMediaInputAvailable(await rendererHost.sdk.aiConfig.getSnapshot(), runAttachments[0]?.mimeType)) {
          result = {
            ok: false, capabilityId: capability.id, reason: 'input-invalid',
            message: t('Studio.profiles.textGenerate.imageTargetUnsupported'),
            actionHint: t('Studio.profiles.textGenerate.imageTargetUnsupported'),
            missingSurface: capability.missingSurface,
          };
        } else result = await rendererHost.sdk.runCapability({
          capabilityId: capability.id,
          recordedRunConfig: runConfig,
          recordedCreatedAt: pendingRun.createdAt,
          recordedPrompt: displayPrompt,
          prompt: (capability.id === 'world.generate' && runHasAlternativeInput && !displayPrompt && !nextContext.trim()) || usesVerbatimStudioPrompt(capability.id) || profile.rawPrompt || recordedInput
            ? displayPrompt
            : textStudioRuntimePrompt(displayPrompt, nextContext, directive),
          scenarioId: preset.id,
          onPartial: isStreaming ? (text) => {
            if (runSeqRef.current === runSeq) setStreamingText(text);
          } : undefined,
          attachments: supportsMedia ? runAttachments : undefined,
          parameters: runEffectiveParameters,
          signal: abortController.signal,
          onJobUpdate: job => {
            if (runSeqRef.current !== runSeq) return;
            const jobStatus = job.status === ScenarioJobStatus.QUEUED || job.status === ScenarioJobStatus.SUBMITTED ? 'queued' : job.status === ScenarioJobStatus.RUNNING ? 'running' : undefined;
            if (jobStatus) setExecutingRun(current => current?.id === pendingRun.id ? { ...current, jobStatus } : current);
          },
        });
      } catch (error) {
        const message = abortController.signal.aborted ? t('Studio.profiles.textGenerate.imageStopped')
          : error instanceof Error ? error.message : String(error || t('NonSuccess.title.runtimeCallFailed'));
        result = {
          ok: false,
          capabilityId: capability.id,
          reason: abortController.signal.aborted ? 'operation-aborted' : 'runtime-call-failed',
          message,
          actionHint: t('NonSuccess.hint.runtimeCallFailed'),
          missingSurface: capability.missingSurface,
        };
      }
      const record = await onResult(result, displayPrompt, runConfig);
      // A result reaches the visible completed stage only after onResult has
      // finished its required custody/history work. Persistence failure throws
      // and is projected by the outer failure path instead of showing success.
      if (runSeq !== runSeqRef.current) return;
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
      if (runSeq !== runSeqRef.current) return;
      const message = error instanceof Error ? error.message : String(error || 'Runtime call failed.');
      setActiveRun({ ...pendingRun, error: message });
    } finally {
      if (runSeq === runSeqRef.current) {
        if (abortControllerRef.current?.controller === abortController) abortControllerRef.current = null;
        setExecutingRun(null);
        setCancelRequested(false);
        setStreamingText(null);
      }
    }
  }

  function handleCopy() {
    if (!currentResult) return;
    const text = resultPlainText(currentResult, t);
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

  async function handleDownload() {
    if (!currentResult) return;
    if (currentResult.ok && currentResult.output.kind === 'artifacts') {
      const artifact = currentResult.output.firstArtifact;
      if (artifact?.relativePath) {
        await revealStudioAsset(rendererHost, artifact.relativePath);
      }
      return;
    }
    if (currentResult.ok && currentResult.output.kind === 'text-annotation') {
      await revealStudioAsset(rendererHost, currentResult.output.document.relativePath);
      return;
    }
    const stamp = new Date(rendererHost.clock.now()).toISOString().replace(/[:.]/g, '-');
    const text = resultPlainText(currentResult, t);
    if (!text) return;
    await downloadTextFile(rendererHost, `${capability.id}-${stamp}.txt`, text);
  }

  // Selecting a history record is a read-only preview: it never writes the
  // composer draft. Reusing a record's prompt is an explicit action instead.
  function selectHistoryRun(record: StudioRunHistoryRecord) {
    const sessionRun = sessionRuns[record.id];
    if (sessionRun) {
      setActiveRun(sessionRun);
      return;
    }
    setActiveRun({
      id: record.id,
      prompt: record.prompt,
      context: record.runConfig?.promptControls.context ?? '',
      createdAt: record.createdAt,
      result: null,
      record,
      error: null,
    });
  }

  function useHistoryRunAsDraft(record: StudioRunHistoryRecord) {
    if (record.inputTruncated || record.status === 'unavailable') return;
    if (registration.parameters.restoreRecordedParameters) {
      const snapshot = record.runConfig?.target.params;
      const restored = registration.parameters.restoreRecordedParameters(snapshot, record.result, record.prompt);
      if (!restored || !parameterStore) return;
      parameterStore.setParameters(capability.id, restored);
    }
    if (recordedInput) {
      const restored = recordedInput.decode(record.prompt);
      if (!restored || !parameterStore) return;
      parameterStore.setParameters(capability.id, { ...capabilityParameters, ...restored });
      setActiveRun(null);
      return;
    }
    updatePrompt(record.prompt);
    setContext(record.runConfig?.promptControls.context ?? '');
    setActiveRun(null);
  }

  useEffect(() => {
    const record = historySelectionRequest?.record;
    if (!record || record.capabilityId !== capability.id) return;
    selectHistoryRun(record);
  }, [historySelectionRequest?.requestId, capability.id]);

  const composer = (
    <TextStudioComposer
      registration={registration}
      prompt={prompt}
      context={context}
      intentLabel={textStudioRunTargetIntentSummary(runTarget, t)}
      running={running}
      attachments={composerState.attachments}
      attachmentPickerEnabled={capability.id !== 'text.generate' || mediaInputState === 'supported'}
      attachmentWarning={attachmentBlocked ? t(mediaInputState === 'checking'
        ? 'Studio.profiles.textGenerate.imageTargetChecking'
        : mediaInputState === 'unavailable'
          ? 'Studio.profiles.textGenerate.imageTargetUnknown'
          : 'Studio.profiles.textGenerate.imageTargetUnsupported') : undefined}
      onOpenAttachmentPicker={composerState.openAttachmentPicker}
      onRemoveAttachment={composerState.removeAttachment}
      canDispatch={runTarget.canDispatch}
      canConfigureIntent={canConfigureRunTarget(runTarget)}
      intentConfigurable={capability.execution === 'runtime-sdk'}
      compact={Boolean(activeRun)}
      parameterPanel={parameterStore && capability.execution === 'runtime-sdk' && ParameterPanel ? (
        <ParameterPanel
          capabilityId={capability.id}
          contract={registration.parameters}
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
    historyPanel?.setCollapsed(!historyCollapsed);
  }

  function handleNewRun() {
    setActiveRun(null);
  }

  function handleCancel() {
    const execution = abortControllerRef.current;
    if (!execution || cancelRequested || !displayingExecution || execution.runId !== displayedRun?.id) return;
    setCancelRequested(true);
    execution.controller.abort('studio-user-canceled');
  }

  return (
    <div className={hasActiveRun ? 'studio studio--has-run' : 'studio studio--landing'}>
      <div className="studio__workspace studio__workspace--with-history">
        <div className="studio__primary">
          <header className="studio__head">
            <div className="studio__title">
              {showAdmissionBadge ? (
                <StatusBadge tone={admission.tone} shape="dot">
                  {t(registration.profile.statusLabelKey ?? ADMISSION_STATUS_LABEL_KEY[admission.label] ?? admission.label)}
                </StatusBadge>
              ) : null}
            </div>
            <div className="studio__head-actions">
              {headerActions}
              {executingRun && !displayingExecution ? (
                <Button size="sm" tone="secondary" onClick={() => setActiveRun(executingRun)}>
                  {t('StudioShell.returnToRunning')}
                </Button>
              ) : null}
              {hasActiveRun ? (
                <Tooltip content={t('StudioShell.newRun')} placement="bottom">
                  <IconButton
                    type="button"
                    className="studio-history-toggle"
                    aria-label={t('StudioShell.newRun')}
                    onClick={handleNewRun}
                    disabled={running}
                    icon={<SquarePen size={17} strokeWidth={1.8} aria-hidden="true" />}
                  />
                </Tooltip>
              ) : null}
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
            {hasActiveRun && displayedRun ? (
              <TextStudioResultState
                registration={registration}
                activeRun={displayedRun}
                admission={admission}
                intentLabel={displayedRun.record ? getStudioRunIntentLabel(displayedRun.record) : runTarget.intentLabel}
                running={displayingExecution}
                canRegenerate={!running && hasRequiredImage && textMediaReplayable && displayedRunReplayable && replayAssetsAvailable}
                regenerateHint={!running && !textMediaReplayable ? t('Studio.profiles.textGenerate.savedMediaUnavailable')
                  : !running && replayAssetsChecking ? t('StudioShell.historyInputsChecking')
                    : !running && (!displayedRunReplayable || !replayAssetsAvailable) ? t('StudioShell.historyInputsUnavailable') : undefined}
                cancelRequested={displayingExecution && cancelRequested}
                streamingText={displayingExecution ? streamingText : null}
                verboseConsole={verboseConsole}
                composer={composer}
                onCopy={handleCopy}
                onDownload={handleDownload}
                onRegenerate={() => void run(displayedRun.prompt, displayedRun.context, true)}
                onCancel={displayingExecution && canCancelStudioCapabilityRun({
                  capabilityId: capability.id,
                  resultKind: profile.resultKind,
                  hasMediaInput: (executingRun?.attachmentCount ?? 0) > 0,
                })
                  ? handleCancel
                  : undefined}
                onUseAsDraft={useHistoryRunAsDraft}
                onOpenIntentConfig={capability.execution === 'runtime-sdk' ? onOpenConfig : undefined}
              />
            ) : (
              <TextStudioStartState
                registration={registration}
                composer={composer}
              />
            )}
          </main>
        </div>
        <CapabilityRunHistory
          history={history}
          activeRunId={displayedRun?.id ?? null}
          onSelectRun={onSelectHistoryRun}
          collapsed={historyCollapsed}
          currentCapabilityId={capability.id}
          registrations={registrations}
        />
      </div>
    </div>
  );
}

export function SectionAITesting({
  registration,
  registrations,
  runtime,
  onResult,
  history,
  lastResult,
  historySelectionRequest,
  onSelectHistoryRun,
  verboseConsole,
  draftPersistence,
  headerActions,
  renderAIConfigPanel,
  rootTestId,
}: SectionAITestingProps) {
  const { translate: t, appTitle } = useAIStudioHost();
  const capability = registration.descriptor;
  const [configOpen, setConfigOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Mounted consumers (run target, parameter fields, recovery panels) cache
  // AIConfig readiness; a drawer write happens in this window, so no focus or
  // visibility change reports it.
  function closeConfig() {
    setConfigOpen(false);
    if (rootRef.current) notifyStudioAIConfigChanged(rootRef.current);
  }
  // The close refresh can run before a pending write commits; the panel then
  // reports the commit here. The window hears it even after this section left.
  function reportCommitted() {
    notifyStudioAIConfigChanged(rootRef.current ?? window);
  }

  return (
    <div
      ref={rootRef}
      className="section-ai-testing"
      data-testid={rootTestId}
      data-config-open={configOpen ? '' : undefined}
    >
      <div className="section-ai-testing__main">
        <TextStudioShell
          registration={registration}
          registrations={registrations}
          runtime={runtime}
          lastResult={lastResult}
          onResult={onResult}
          verboseConsole={verboseConsole}
          draftPersistence={draftPersistence}
          onOpenConfig={renderAIConfigPanel ? () => setConfigOpen(true) : undefined}
          history={history}
          historySelectionRequest={historySelectionRequest}
          onSelectHistoryRun={onSelectHistoryRun}
          headerActions={headerActions}
        />
      </div>

      {renderAIConfigPanel ? <OverlayShell
        open={configOpen}
        kind="drawer"
        size="M"
        title={t('StudioModelConfig.drawerTitle')}
        description={t('StudioModelConfig.drawerDescription', { appTitle })}
        panelClassName="flex flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto p-0"
        onClose={closeConfig}
      >
        <DrawerErrorBoundary onClose={closeConfig} translate={t}>
          <Suspense fallback={<div className="p-5"><LoadingSkeleton lines={4} label={t('Common.loading')} /></div>}>
            {renderAIConfigPanel({ runtime, capabilityId: capability.capabilityContract ?? capability.id, onCommitted: reportCommitted })}
          </Suspense>
        </DrawerErrorBoundary>
      </OverlayShell> : null}
    </div>
  );
}
