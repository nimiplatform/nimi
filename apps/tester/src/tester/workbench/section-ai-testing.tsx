import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  Button,
  IconButton,
  SegmentedControl,
  SelectField,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  FileText,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import { ImageAttachmentStrip, useMediaAttachments } from '../tester-multimodal-input.js';
import {
  testerCapabilities,
  type TesterCapability,
  type TesterCapabilityId,
} from '../tester-capabilities.js';
import type { TesterAIConfigSummary } from '../tester-ai-config.js';
import type { TesterRunHistory } from '../tester-history.js';
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
  CapHeroTile,
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

function CapabilityStudio({
  capability,
  runtime,
  lastResult,
  onResult,
  onSelectCapability,
  verboseConsole,
  draftPersistence,
  onOpenConfig,
  history,
}: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  lastResult: TesterCapabilityRunResult | null;
  onResult: (result: TesterCapabilityRunResult, prompt: string) => void | Promise<void>;
  onSelectCapability: (id: TesterCapabilityId) => void;
  verboseConsole: boolean;
  draftPersistence: boolean;
  onOpenConfig: (section: CanonicalCapabilitySectionId) => void;
  history: TesterRunHistory | null;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const preset = useMemo(() => presetFor(capability), [capability]);
  const [prompt, setPrompt] = useState(preset.prompt);
  const [tone, setTone] = useState(DEFAULT_TONE_VALUE);
  const [length, setLength] = useState(DEFAULT_LENGTH_VALUE);
  const [draftStatus, setDraftStatus] = useState<TesterPromptDraftStoreStatus>(() => (
    loadTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: preset.id,
    }, draftPersistence).status
  ));
  const [running, setRunning] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const media = useMediaAttachments();
  const supportsMedia = profile.supportsAttachments;
  const currentResult = lastResult?.capabilityId === capability.id ? lastResult : null;
  const admission = statusForCapability(capability, runtime, currentResult);
  const isWorldTour = capability.execution === 'standalone-tauri';
  const requiresPrompt = profile.inputKind !== 'none';

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
    setTone(DEFAULT_TONE_VALUE);
    setLength(DEFAULT_LENGTH_VALUE);
  }, [capability.id, draftPersistence, preset]);

  async function run() {
    setRunning(true);
    try {
      if (isWorldTour) {
        const fixture = await resolveWorldTourFixture({});
        const opened = await openWorldTourWindow({ manifestPath: fixture.manifestPath });
        await onResult({
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
        }, prompt);
      } else {
        const isStreaming = capability.id === 'chat.stream';
        if (isStreaming) setStreamingText('');
        const directive = profile.controls.includes('tone') || profile.controls.includes('length')
          ? composeStudioDirective(tone, length)
          : undefined;
        const result = await runTesterCapability({
          capabilityId: capability.id,
          prompt,
          scenarioId: preset.id,
          directive,
          onPartial: isStreaming ? setStreamingText : undefined,
          attachments: supportsMedia ? media.attachments : undefined,
        });
        await onResult(result, prompt);
      }
    } finally {
      setRunning(false);
      setStreamingText(null);
    }
  }

  function reset() {
    updatePrompt(preset.prompt);
    setTone(DEFAULT_TONE_VALUE);
    setLength(DEFAULT_LENGTH_VALUE);
    media.clearAttachments();
  }

  function handleCopy() {
    if (!currentResult?.ok) return;
    const text = resultPlainText(currentResult);
    if (!text) return;
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard is best-effort; Download remains the durable export path.
    }
  }

  function handleDownload() {
    if (!currentResult?.ok) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const output = currentResult.output;
    if (output.kind === 'artifacts' && output.firstArtifact?.url) {
      void downloadArtifactUrl(
        `${capability.id}-${stamp}.${artifactExtension(output.firstArtifact.mimeType)}`,
        output.firstArtifact.url,
      );
      return;
    }
    const text = resultPlainText(currentResult);
    if (!text) return;
    downloadTextFile(`${capability.id}-${stamp}.txt`, text);
  }

  const capabilityOptions = useMemo(
    () => testerCapabilities.map((item) => ({ value: item.id, label: getCapabilityStudioProfile(item.id).studioTag })),
    [],
  );

  return (
    <div className="studio">
      <header className="studio__head">
        <div className="studio__head-lead">
          <CapHeroTile capability={capability} />
          <div className="studio__head-titles">
            <h2>{capability.label}</h2>
            <StatusBadge tone={admission.tone} shape="dot">{STATUS_PILL_LABEL[admission.label]}</StatusBadge>
          </div>
        </div>
        <div className="studio__head-actions">
          <span className="studio__capability">
            <span className="studio__capability-eyebrow">Capability</span>
            <SelectField
              options={capabilityOptions}
              value={capability.id}
              onValueChange={(id) => onSelectCapability(id as TesterCapabilityId)}
              aria-label="Switch capability"
              tone="quiet"
              selectClassName="studio__capability-trigger"
            />
          </span>
          <IconButton
            aria-label={`Configure ${capability.label} model`}
            title="Configure model"
            tone="ghost"
            size="sm"
            icon={<Settings size={15} />}
            onClick={() => onOpenConfig(CAPABILITY_TO_SECTION[capability.id])}
          />
        </div>
      </header>

      <div className="studio__panels">
        <Surface className="studio-card studio-card--input" material="glass-thin" tone="panel" elevation="base" padding="none">
          <div className="studio-card__head">
            <Sparkles size={16} aria-hidden="true" />
            <strong>{profile.inputTitle}</strong>
          </div>

          {requiresPrompt ? (
            <div className="studio-input">
              <TextareaField
                rows={6}
                wrap="soft"
                maxLength={2000}
                aria-label={`${capability.label} request`}
                placeholder={profile.inputPlaceholder}
                value={prompt}
                onChange={(event) => updatePrompt(event.currentTarget.value)}
              />
              <span className="studio-input__count">{prompt.length} / 2000</span>
            </div>
          ) : (
            <p className="studio-note">{profile.inputNote}</p>
          )}

          {supportsMedia ? (
            <ImageAttachmentStrip
              attachments={media.attachments}
              fileInputRef={media.fileInputRef}
              onAddFiles={media.addFiles}
              onRemove={media.removeAttachment}
              onOpenPicker={media.openFilePicker}
              disabled={running}
            />
          ) : null}

          {profile.controls.includes('tone') ? (
            <div className="studio-field">
              <span className="studio-field__label">Tone</span>
              <div className="studio-seg">
                <SegmentedControl
                  items={TONE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  value={tone}
                  onValueChange={setTone}
                  ariaLabel="Tone"
                  size="sm"
                />
              </div>
            </div>
          ) : null}

          {profile.controls.includes('length') ? (
            <div className="studio-field">
              <span className="studio-field__label">Length</span>
              <div className="studio-seg">
                <SegmentedControl
                  items={LENGTH_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  value={length}
                  onValueChange={setLength}
                  ariaLabel="Length"
                  size="sm"
                />
              </div>
            </div>
          ) : null}

          <div className="studio-actions">
            <Button
              type="button"
              tone="primary"
              leadingIcon={<Play size={14} />}
              loading={running}
              disabled={running || (requiresPrompt && !prompt.trim())}
              onClick={run}
            >
              {running ? profile.primaryRunningLabel : profile.primaryLabel}
            </Button>
            <Button
              type="button"
              tone="secondary"
              leadingIcon={<RefreshCw size={14} />}
              onClick={reset}
            >
              Reset
            </Button>
          </div>

          <p className="studio-foot">
            <ShieldCheck size={14} aria-hidden="true" />
            {profile.footnote}
            {draftPersistence ? <span className="studio-foot__draft"> · drafts: {draftStatus.state}</span> : null}
          </p>
        </Surface>

        <Surface className="studio-card studio-card--result" material="glass-thin" tone="panel" elevation="base" padding="none">
          <div className="studio-card__head">
            <FileText size={16} aria-hidden="true" />
            <strong>{profile.resultTitle}</strong>
          </div>
          <StudioResult
            result={currentResult}
            running={running}
            capability={capability}
            admission={admission}
            streamingText={streamingText}
            verboseConsole={verboseConsole}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        </Surface>
      </div>

      <CapabilityRunHistory capability={capability} history={history} />
    </div>
  );
}

export function SectionAITesting({
  capability,
  onResult,
  onSelectCapability,
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
        <CapabilityStudio
          capability={capability}
          runtime={runtime}
          lastResult={lastResult}
          onResult={onResult}
          onSelectCapability={onSelectCapability}
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
