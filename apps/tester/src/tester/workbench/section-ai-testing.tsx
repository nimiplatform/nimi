import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  SelectField,
  StatusBadge,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  AlertTriangle,
  ArrowUp,
  Clock,
  FileText,
  Maximize2,
  MessageSquare,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import { ImageAttachmentStrip, useMediaAttachments } from '../tester-multimodal-input.js';
import { type TesterCapability } from '../tester-capabilities.js';
import {
  formatTesterRunTimestamp,
  getTesterRunResultTags,
  getTesterRunStatusLabel,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
  type TesterRunHistoryResultSnapshot,
} from '../tester-history.js';
import {
  runTesterCapability,
  type TesterCapabilityRunResult,
  type TesterRuntimeInspection,
} from '../tester-runtime.js';
import {
  loadTesterPromptDraft,
  saveTesterPromptDraft,
  type TesterPromptDraftStoreStatus,
} from '../tester-preferences.js';
import {
  openWorldTourWindow,
  resolveWorldTourFixture,
} from '../world-tour/world-tour-shared.js';
import {
  composeStudioDirective,
  DEFAULT_LENGTH_VALUE,
  DEFAULT_TONE_VALUE,
  getCapabilityStudioProfile,
  LENGTH_OPTIONS,
  TONE_OPTIONS,
} from './capability-studio-profiles.js';
import {
  CAPABILITY_TO_SECTION,
  CapabilityRunHistory,
  DrawerErrorBoundary,
  STATUS_PILL_LABEL,
  StudioResult,
  TesterAiConfigSettingsPanel,
  artifactExtension,
  downloadArtifactUrl,
  downloadTextFile,
  presetFor,
  resultPlainText,
  statusForCapability,
  type SectionAITestingProps,
} from './section-ai-testing-surface.js';

type TextStudioActiveRun = {
  id: string;
  prompt: string;
  context: string;
  createdAt: string;
  result: TesterCapabilityRunResult | null;
  record: TesterRunHistoryRecord | null;
  error: string | null;
};

function textStudioDisplayPrompt(prompt: string, context: string): string {
  const trimmedPrompt = prompt.trim();
  const trimmedContext = context.trim();
  if (!trimmedContext) return trimmedPrompt;
  return `${trimmedPrompt}\n\nContext:\n${trimmedContext}`;
}

function textStudioRuntimePrompt(prompt: string, context: string): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return prompt;
  return `Context:\n${trimmedContext}\n\nRequest:\n${prompt}`;
}

function textStudioModelSummary(result: TesterCapabilityRunResult | null): string {
  const resolved = result?.ok ? result.trace?.modelResolved?.trim() : '';
  return `Model: ${resolved || 'Not configured'}`;
}

function studioControlHeadingLabel(title: string): ReactNode {
  return <span className="studio-field__menu-heading">{title}</span>;
}

function studioControlValueLabel(value: string): ReactNode {
  return <span className="studio-field__menu-value">{value}</span>;
}

function ModelSummaryChip({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button type="button" className="studio-model-chip" onClick={onOpen} aria-label="Open AI model configuration">
      <SlidersHorizontal size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function TextStudioComposer({
  capability,
  prompt,
  context,
  tone,
  length,
  toneSelected,
  lengthSelected,
  running,
  media,
  compact = false,
  onPromptChange,
  onContextChange,
  onToneChange,
  onLengthChange,
  onSubmit,
}: {
  capability: TesterCapability;
  prompt: string;
  context: string;
  tone: string;
  length: string;
  toneSelected: boolean;
  lengthSelected: boolean;
  running: boolean;
  media: ReturnType<typeof useMediaAttachments>;
  compact?: boolean;
  onPromptChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onToneChange: (value: string) => void;
  onLengthChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const requiresPrompt = profile.inputKind !== 'none';
  const contextAttached = Boolean(context.trim());
  const [contextOpen, setContextOpen] = useState(false);
  const composerBar = (
    <div className="studio-composer__bar">
      <div className="studio-composer__controls">
        {profile.controls.includes('tone') ? (
          <div className={toneSelected ? 'studio-field studio-field--tone studio-field--selected' : 'studio-field studio-field--tone'}>
            <SelectField
              options={[
                { value: '__tone_heading', label: studioControlHeadingLabel('Tone'), disabled: true },
                ...TONE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: studioControlValueLabel(option.label),
                })),
              ]}
              value={tone}
              onValueChange={onToneChange}
              aria-label="Tone"
              tone="quiet"
              selectClassName="studio-field__select"
              contentClassName="studio-field__menu"
            />
          </div>
        ) : null}
        {profile.controls.includes('length') ? (
          <div className={lengthSelected ? 'studio-field studio-field--length studio-field--selected' : 'studio-field studio-field--length'}>
            <SelectField
              options={[
                { value: '__length_heading', label: studioControlHeadingLabel('Length'), disabled: true },
                ...LENGTH_OPTIONS.map((option) => ({
                  value: option.value,
                  label: studioControlValueLabel(option.label),
                })),
              ]}
              value={length}
              onValueChange={onLengthChange}
              aria-label="Length"
              tone="quiet"
              selectClassName="studio-field__select"
              contentClassName="studio-field__menu"
            />
          </div>
        ) : null}
        <button
          type="button"
          className={contextAttached ? 'studio-context-chip studio-context-chip--attached' : 'studio-context-chip'}
          onClick={() => setContextOpen((current) => !current)}
          aria-expanded={contextOpen}
        >
          <FileText size={14} aria-hidden="true" />
          {contextAttached ? 'Context attached' : 'Context'}
        </button>
      </div>
      <div className="studio-composer__actions">
        {profile.supportsAttachments ? (
          <ImageAttachmentStrip
            attachments={media.attachments}
            fileInputRef={media.fileInputRef}
            onAddFiles={media.addFiles}
            onRemove={media.removeAttachment}
            onOpenPicker={media.openFilePicker}
            disabled={running}
            variant="icon"
          />
        ) : null}
        <button
          type="button"
          className="studio-generate-action"
          aria-label={running ? profile.primaryRunningLabel : profile.primaryLabel}
          title={running ? profile.primaryRunningLabel : profile.primaryLabel}
          disabled={running || (requiresPrompt && !prompt.trim())}
          onClick={onSubmit}
        >
          {running ? <RefreshCw size={17} aria-hidden="true" className="studio-spin" /> : <ArrowUp size={19} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
  return (
    <div className={compact ? 'studio-composer studio-composer--compact' : 'studio-composer'}>
      {requiresPrompt ? (
        <div className="studio-input">
          <TextareaField
            rows={compact ? 3 : 5}
            wrap="soft"
            maxLength={2000}
            aria-label={`${capability.label} request`}
            placeholder={capability.id === 'text.generate' ? 'Ask Nimi to draft, rewrite, summarize, or structure something...' : profile.inputPlaceholder}
            value={prompt}
            onChange={(event) => onPromptChange(event.currentTarget.value)}
          />
          <span className="studio-input__count">{prompt.length} / 2000</span>
          <Maximize2 size={13} aria-hidden="true" className="studio-input__expand" />
          <div className={contextOpen ? 'studio-context studio-context--open' : 'studio-context'}>
            <TextareaField
              rows={compact ? 2 : 3}
              wrap="soft"
              maxLength={1600}
              aria-label="Context"
              placeholder="Optional context, audience, source notes, or constraints"
              value={context}
              onChange={(event) => onContextChange(event.currentTarget.value)}
            />
          </div>
          {composerBar}
        </div>
      ) : (
        <p className="studio-note">{profile.inputNote}</p>
      )}
      {requiresPrompt ? null : composerBar}
    </div>
  );
}

function TextStudioStartState({
  capability,
  composer,
}: {
  capability: TesterCapability;
  composer: ReactNode;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  return (
    <section className="studio-start" aria-label={`${capability.label} start`}>
      <div className="studio-start__center">
        <h2>{profile.inputTitle}</h2>
        <div className="studio-start__composer">{composer}</div>
      </div>
    </section>
  );
}

function TextStudioHistoryRecordResult({ record }: { record: TesterRunHistoryRecord }) {
  const snapshot = record.result;
  const tags = getTesterRunResultTags(record);
  let body: ReactNode;
  if (!snapshot) {
    body = (
      <>
        <p>{record.message}</p>
        <p className="studio-result__hint">
          This older persisted run record contains only status metadata. Run it again to persist the typed result snapshot.
        </p>
      </>
    );
  } else if (!snapshot.ok) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{snapshot.reason}</span>
        </div>
        <p>{snapshot.message}</p>
        <p className="studio-result__hint">{snapshot.actionHint}</p>
        {snapshot.missingSurface ? <p className="studio-result__hint">Missing surface: {snapshot.missingSurface}</p> : null}
      </div>
    );
  } else {
    body = <TextStudioHistorySnapshotBody snapshot={snapshot} />;
  }
  return (
    <div className="studio-history-result" role="status">
      <div className="studio-history-result__line">
        <Clock size={15} aria-hidden="true" />
        <strong>{getTesterRunStatusLabel(record.status)}</strong>
        <time dateTime={record.createdAt}>{formatTesterRunTimestamp(record.createdAt)}</time>
      </div>
      <div className="studio-history-result__tags">
        {tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      {body}
    </div>
  );
}

function TextStudioHistorySnapshotBody({ snapshot }: { snapshot: Extract<TesterRunHistoryResultSnapshot, { ok: true }> }) {
  if (snapshot.kind === 'text' || snapshot.kind === 'transcript') {
    return (
      <>
        <div className="studio-result__text">{snapshot.body || '(empty body)'}</div>
        <dl className="studio-history-result__facts">
          <div>
            <dt>Characters</dt>
            <dd>{snapshot.charCount}</dd>
          </div>
          {'finishReason' in snapshot ? (
            <div>
              <dt>Finish</dt>
              <dd>{snapshot.finishReason}</dd>
            </div>
          ) : (
            <div>
              <dt>Job</dt>
              <dd>{snapshot.jobState}</dd>
            </div>
          )}
          {snapshot.modelResolved ? (
            <div>
              <dt>Model</dt>
              <dd>{snapshot.modelResolved}</dd>
            </div>
          ) : null}
          {snapshot.traceId ? (
            <div>
              <dt>Trace</dt>
              <dd><code>{snapshot.traceId}</code></dd>
            </div>
          ) : null}
        </dl>
      </>
    );
  }
  if (snapshot.kind === 'embedding') {
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">
          {snapshot.vectorCount} vector{snapshot.vectorCount === 1 ? '' : 's'} / {snapshot.dimensions} dimensions
          {typeof snapshot.totalTokens === 'number' ? ` / ${snapshot.totalTokens} tokens` : ''}
        </p>
        <div className="studio-chips">
          {snapshot.sample.map((value, index) => (
            <span key={index} className="studio-chip">{value.toFixed(4)}</span>
          ))}
        </div>
      </div>
    );
  }
  if (snapshot.kind === 'artifacts') {
    const artifact = snapshot.firstArtifact;
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">
          Job {snapshot.jobId || '(pending id)'} / {snapshot.jobState} / {snapshot.artifactCount} artifact
          {snapshot.artifactCount === 1 ? '' : 's'}
          {artifact?.mimeType ? ` / ${artifact.mimeType}` : ''}
        </p>
        {artifact?.url ? (
          <p className="studio-result__hint">Hosted artifact: {artifact.displayName || artifact.artifactId || artifact.url}</p>
        ) : (
          <p className="studio-result__hint">Inline local media is not duplicated in run history; use the current-session preview or media artifact history.</p>
        )}
      </div>
    );
  }
  return (
    <ul className="studio-voice-list">
      {snapshot.sample.map((voice) => (
        <li key={voice.voiceId || voice.name}>
          <strong>{voice.name || voice.voiceId}</strong>
          <span>{voice.voiceId} / {voice.lang}</span>
        </li>
      ))}
      {snapshot.sample.length === 0 ? <li><span>No voices returned.</span></li> : null}
    </ul>
  );
}

function TextStudioRunError({ message }: { message: string }) {
  return (
    <div className="studio-result__blocked" role="alert">
      <div className="studio-result__blocked-line">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>Runtime call failed</span>
      </div>
      <p>{message}</p>
      <p className="studio-result__hint">No local fallback result was produced.</p>
    </div>
  );
}

function TextStudioResultState({
  capability,
  activeRun,
  admission,
  running,
  streamingText,
  verboseConsole,
  composer,
  onCopy,
  onDownload,
  onRegenerate,
}: {
  capability: TesterCapability;
  activeRun: TextStudioActiveRun;
  admission: ReturnType<typeof statusForCapability>;
  running: boolean;
  streamingText: string | null;
  verboseConsole: boolean;
  composer: ReactNode;
  onCopy: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
}) {
  return (
    <section className="studio-thread" aria-label={`${capability.label} result`}>
      <div className="studio-thread__scroll">
        <article className="studio-turn studio-turn--user">
          <div className="studio-turn__label">
            <MessageSquare size={14} aria-hidden="true" />
            <span>Prompt</span>
          </div>
          <p>{textStudioDisplayPrompt(activeRun.prompt, activeRun.context)}</p>
        </article>
        <article className="studio-turn studio-turn--assistant">
          <div className="studio-turn__label">
            <FileText size={14} aria-hidden="true" />
            <span>Generation</span>
          </div>
          {activeRun.error ? (
            <TextStudioRunError message={activeRun.error} />
          ) : activeRun.result || running ? (
            <StudioResult
              result={activeRun.result}
              running={running}
              capability={capability}
              admission={admission}
              streamingText={streamingText}
              verboseConsole={verboseConsole}
              onCopy={onCopy}
              onDownload={onDownload}
              onRegenerate={onRegenerate}
            />
          ) : activeRun.record ? (
            <TextStudioHistoryRecordResult record={activeRun.record} />
          ) : null}
        </article>
      </div>
      <div className="studio-thread__composer">{composer}</div>
    </section>
  );
}

function TextStudioShell({
  capability,
  runtime,
  lastResult,
  onResult,
  verboseConsole,
  draftPersistence,
  onOpenConfig,
  history,
}: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  lastResult: TesterCapabilityRunResult | null;
  onResult: (result: TesterCapabilityRunResult, prompt: string) => TesterRunHistoryRecord | null | Promise<TesterRunHistoryRecord | null>;
  verboseConsole: boolean;
  draftPersistence: boolean;
  onOpenConfig: (section: CanonicalCapabilitySectionId) => void;
  history: TesterRunHistory | null;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const preset = useMemo(() => presetFor(capability), [capability]);
  const [prompt, setPrompt] = useState(preset.prompt);
  const [context, setContext] = useState('');
  const [tone, setTone] = useState(DEFAULT_TONE_VALUE);
  const [length, setLength] = useState(DEFAULT_LENGTH_VALUE);
  const [toneSelected, setToneSelected] = useState(false);
  const [lengthSelected, setLengthSelected] = useState(false);
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
  const media = useMediaAttachments();
  const currentResult = activeRun?.result ?? (lastResult?.capabilityId === capability.id ? lastResult : null);
  const admission = statusForCapability(capability, runtime, currentResult);
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
    setTone(DEFAULT_TONE_VALUE);
    setLength(DEFAULT_LENGTH_VALUE);
    setToneSelected(false);
    setLengthSelected(false);
    setActiveRun(null);
    setSessionRuns({});
  }, [capability.id, draftPersistence, preset]);

  async function run(nextPrompt = prompt, nextContext = context) {
    const displayPrompt = nextPrompt.trim();
    if (requiresPrompt && !displayPrompt) return;
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
        const directive = profile.controls.includes('tone') || profile.controls.includes('length')
          ? composeStudioDirective(tone, length)
          : undefined;
        result = await runTesterCapability({
          capabilityId: capability.id,
          prompt: textStudioRuntimePrompt(displayPrompt, nextContext),
          scenarioId: preset.id,
          directive,
          onPartial: isStreaming ? setStreamingText : undefined,
          attachments: supportsMedia ? media.attachments : undefined,
        });
      }
      const record = await onResult(result, displayPrompt);
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
    downloadTextFile(`${capability.id}-${stamp}.txt`, text);
  }

  function selectHistoryRun(record: TesterRunHistoryRecord) {
    const sessionRun = sessionRuns[record.id];
    if (sessionRun) {
      setActiveRun(sessionRun);
      updatePrompt(sessionRun.prompt);
      setContext(sessionRun.context);
      return;
    }
    setActiveRun({
      id: record.id,
      prompt: record.prompt,
      context: '',
      createdAt: record.createdAt,
      result: null,
      record,
      error: null,
    });
    updatePrompt(record.prompt);
    setContext('');
  }

  const composer = (
    <TextStudioComposer
      capability={capability}
      prompt={prompt}
      context={context}
      tone={tone}
      length={length}
      toneSelected={toneSelected}
      lengthSelected={lengthSelected}
      running={running}
      media={media}
      compact={Boolean(activeRun)}
      onPromptChange={updatePrompt}
      onContextChange={setContext}
      onToneChange={(nextTone) => {
        setTone(nextTone);
        setToneSelected(true);
      }}
      onLengthChange={(nextLength) => {
        setLength(nextLength);
        setLengthSelected(true);
      }}
      onSubmit={() => void run()}
    />
  );

  const hasActiveRun = Boolean(activeRun);

  return (
    <div className={hasActiveRun ? 'studio studio--has-run' : 'studio studio--landing'}>
      {hasActiveRun ? (
        <header className="studio__head">
          <div className="studio__title">
            <h1>{capability.label}</h1>
            <StatusBadge tone={admission.tone} shape="dot">{STATUS_PILL_LABEL[admission.label]}</StatusBadge>
          </div>
          <div className="studio__head-actions">
            <ModelSummaryChip
              label={textStudioModelSummary(currentResult)}
              onOpen={() => onOpenConfig(CAPABILITY_TO_SECTION[capability.id])}
            />
          </div>
        </header>
      ) : null}

      <div className="studio__workspace">
        <main className="studio__stage">
          {hasActiveRun && activeRun ? (
            <TextStudioResultState
              capability={capability}
              activeRun={activeRun}
              admission={admission}
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
        {hasActiveRun ? (
          <CapabilityRunHistory
            capability={capability}
            history={history}
            activeRunId={activeRun?.id ?? null}
            onSelectRun={selectHistoryRun}
          />
        ) : null}
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
  verboseConsole,
  draftPersistence,
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
        />
      </div>

      {configSection ? (
        <aside className="section-ai-testing__drawer" aria-label="Configure model">
          <DrawerErrorBoundary onClose={() => setConfigSection(null)}>
            <Suspense fallback={<div className="section-ai-testing__drawer-loading">Loading model config…</div>}>
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
