import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  EmptyState,
  Surface,
} from '@nimiplatform/kit/ui';
import {
  AlertTriangle,
  CircleHelp,
  Clock,
  Cloud,
  Copy as CopyIcon,
  Download as DownloadIcon,
  FileText,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  type TesterCapability,
  type TesterCapabilityId,
} from '../tester-capabilities.js';
import { CAPABILITY_TO_SECTION } from '../tester-capability-sections.js';
import type { TesterAIConfigSummary } from '../tester-ai-config.js';
import {
  formatTesterRunTimestamp,
  getTesterRunMetricSummary,
  getTesterRunModelLabel,
  getTesterRunModelSource,
  getTesterRunPromptSummary,
  getTesterRunResultSummary,
  getTesterRunStatusTone,
  type TesterRunConfigSnapshot,
  type TesterRunModelSource,
  type TesterRunHistory,
  type TesterRunHistoryRecord,
} from '../tester-history.js';
import {
  runTesterCapability,
  type TesterCapabilityRunResult,
  type TesterRuntimeInspection,
} from '../tester-runtime.js';
import { unavailableReasonTitle } from '../tester-unavailable.js';
import {
  openWorldTourWindow,
  resolveWorldTourFixture,
} from '../world-tour/world-tour-shared.js';
import {
  loadTesterPromptDraft,
  saveTesterPromptDraft,
  type TesterPromptDraftStoreStatus,
} from '../tester-preferences.js';
import {
  composeStudioDirective,
  countStudioWords,
  DEFAULT_LENGTH_VALUE,
  DEFAULT_TONE_VALUE,
  getCapabilityStudioProfile,
  LENGTH_OPTIONS,
  runtimeMethodFor,
  TONE_OPTIONS,
} from './capability-studio-profiles.js';

// The model-config drawer (and its runtime model-picker provider) is only needed
// when the settings gear opens it, so it loads on demand — the always-on studio
// surface stays decoupled from the heavier config subsystem.
export const TesterAiConfigSettingsPanel = lazy(() =>
  import('./tester-ai-config-settings-panel.js').then((module) => ({ default: module.TesterAiConfigSettingsPanel })),
);

// Isolates the on-demand model-config drawer: if the panel module (or one of its
// runtime model-picker dependencies) fails to load, the drawer degrades to an
// inline error instead of unmounting the whole studio surface.
export class DrawerErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="section-ai-testing__drawer-error" role="alert">
          <strong>Model config unavailable</strong>
          <p>{this.state.error.message || 'The model config surface failed to load.'}</p>
          <Button type="button" tone="secondary" size="sm" onClick={this.props.onClose}>Close</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type SectionAITestingProps = {
  capability: TesterCapability;
  onResult: (result: TesterCapabilityRunResult, prompt: string, runConfig?: TesterRunConfigSnapshot) => TesterRunHistoryRecord | null | Promise<TesterRunHistoryRecord | null>;
  summary: TesterAIConfigSummary | null;
  history: TesterRunHistory | null;
  lastResult: TesterCapabilityRunResult | null;
  verboseConsole: boolean;
  draftPersistence: boolean;
};

type ScenarioPreset = {
  id: string;
  label: string;
  prompt: string;
};

type CapabilityStatus = {
  label: 'ready' | 'blocked' | 'SDK gap' | 'tauri-only' | 'checking';
  tone: 'success' | 'warning' | 'info' | 'neutral';
  detail: string;
};

// Scenario presets stay app-local; runtime/model selection remains owned by the
// shared AI model config surface and the runtime trace.
const scenarioPresets: Partial<Record<TesterCapabilityId, ScenarioPreset[]>> = {
  'text.generate': [
    {
      id: 'acceptance-note',
      label: 'Acceptance note',
      prompt: 'Write a concise acceptance note for a Runtime-backed Nimi App that can generate helpful content.',
    },
  ],
  'chat.stream': [
    {
      id: 'stream-probe',
      label: 'Stream probe',
      prompt: 'Continue this conversation as a Runtime app stream readiness check.',
    },
  ],
  'text.embed': [
    {
      id: 'embedding-sample',
      label: 'Embedding sample',
      prompt: 'Nimi App tester embedding readiness sample.',
    },
  ],
  'image.generate': [
    {
      id: 'ui-preview',
      label: 'UI preview',
      prompt: 'Generate a product-grade UI inspection image for a Nimi App workbench.',
    },
  ],
  'video.generate': [
    {
      id: 'clip-probe',
      label: 'Clip probe',
      prompt: 'Create a short inspection clip for a Nimi App glass UI workflow.',
    },
  ],
  'audio.synthesize': [
    {
      id: 'speech-line',
      label: 'Speech line',
      prompt: 'Synthesize a short Runtime acceptance sentence.',
    },
  ],
  'audio.transcribe': [
    {
      id: 'audio-url',
      label: 'Audio URL',
      prompt: 'https://example.test/sample.wav',
    },
  ],
  'speech.bundle': [
    {
      id: 'voice-catalog',
      label: 'Voice catalog',
      prompt: 'List voices through runtime.ai.listPresetVoices.',
    },
  ],
  'world.generate': [
    {
      id: 'fixture-viewer',
      label: 'Viewer fixture',
      prompt: 'Resolve the world-tour fixture and open the standalone viewer.',
    },
  ],
};

export function presetFor(capability: TesterCapability): ScenarioPreset {
  const presets = scenarioPresets[capability.id];
  return presets?.[0] ?? { id: 'default', label: 'Default', prompt: capability.summary };
}

export function statusForCapability(
  capability: TesterCapability,
  runtime: TesterRuntimeInspection | null,
  lastResult: TesterCapabilityRunResult | null,
): CapabilityStatus {
  if (capability.execution === 'standalone-tauri') {
    return {
      label: 'tauri-only',
      tone: 'info',
      detail: 'Standalone viewer fixture. It can write a local run record, but it is not a runtime artifact.',
    };
  }
  if (capability.execution === 'typed-unavailable') {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: capability.missingSurface || 'No admitted typed SDK method is available for this capability.',
    };
  }
  if (lastResult?.capabilityId === capability.id && !lastResult.ok && lastResult.reason === 'sdk-method-unavailable') {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: lastResult.message,
    };
  }
  if (!runtime) {
    return {
      label: 'checking',
      tone: 'neutral',
      detail: 'Runtime inspection has not completed yet.',
    };
  }
  if (runtime.status !== 'ready') {
    return {
      label: 'blocked',
      tone: 'warning',
      detail: runtime.detail,
    };
  }
  return {
    label: 'ready',
    tone: 'success',
    detail: 'Runtime session active and SDK admission surface is available.',
  };
}

export const STATUS_PILL_LABEL: Record<CapabilityStatus['label'], string> = {
  ready: 'Ready',
  blocked: 'Blocked',
  'SDK gap': 'SDK gap',
  'tauri-only': 'Tauri only',
  checking: 'Checking',
};

function formatTypedOutput(result: TesterCapabilityRunResult & { ok: true }): string {
  const output = result.output;
  if (result.capabilityId === 'world.generate') {
    return JSON.stringify({
      viewerStatus: 'viewer opened',
      fixture: 'tauri-only viewer fixture',
      runtimeResult: false,
      runtimeArtifact: false,
      windowLabel: output.kind === 'artifacts' ? output.jobId : undefined,
    }, null, 2);
  }
  if (output.kind === 'text') {
    return output.text || '(empty body)';
  }
  if (output.kind === 'embedding') {
    return JSON.stringify({
      vectors: output.vectorCount,
      dimensions: output.dimensions,
      sample: output.sample,
      totalTokens: output.totalTokens,
    }, null, 2);
  }
  if (output.kind === 'artifacts') {
    return JSON.stringify({
      jobId: output.jobId,
      jobState: output.jobState,
      artifactCount: output.artifactCount,
      firstArtifact: output.firstArtifact,
    }, null, 2);
  }
  if (output.kind === 'transcript') {
    return output.text || '(empty transcript)';
  }
  return JSON.stringify({
    modelResolved: output.modelResolved,
    voiceCount: output.voiceCount,
    sample: output.sample,
  }, null, 2);
}

function formatUnavailableOutput(result: TesterCapabilityRunResult & { ok: false }): string {
  return [
    unavailableReasonTitle(result.reason),
    '',
    `Capability: ${result.capabilityId}`,
    `Reason: ${result.reason}`,
    result.missingSurface ? `Missing surface: ${result.missingSurface}` : '',
    '',
    'Message:',
    result.message,
    '',
    'Action:',
    result.actionHint,
  ].filter(Boolean).join('\n');
}

// Plain-text projection used for Copy / Download. Text and transcript export the
// raw body; structured successes export their typed JSON summary; unavailable
// results export the fail-closed Runtime diagnostic without converting it into a
// success state.
export function resultPlainText(result: TesterCapabilityRunResult): string {
  if (!result.ok) return formatUnavailableOutput(result);
  if (result.output.kind === 'text') return result.output.text;
  if (result.output.kind === 'transcript') return result.output.text;
  return formatTypedOutput(result);
}

// Rich media preview for runtime artifact results (image / audio / video),
// recovered from the desktop tester result rendering. Falls back to the typed
// JSON summary below when the artifact has no previewable URL/MIME.
function ArtifactPreview({ result }: { result: TesterCapabilityRunResult & { ok: true } }) {
  if (result.output.kind !== 'artifacts') return null;
  const artifact = result.output.firstArtifact;
  const url = artifact?.url;
  const mimeType = artifact?.mimeType ?? '';
  if (!url) return null;
  const label = artifact?.displayName || artifact?.artifactId || result.output.jobId;
  let media: ReactNode = null;
  if (mimeType.startsWith('image/')) {
    media = <img src={url} alt={label} loading="lazy" />;
  } else if (mimeType.startsWith('audio/')) {
    media = <audio controls src={url} />;
  } else if (mimeType.startsWith('video/')) {
    media = <video controls src={url} />;
  }
  if (!media) return null;
  return (
    <figure className="ai-result__media" data-mime={mimeType}>
      {media}
      <figcaption>
        <span>{label}</span>
        <span>{mimeType} · {result.output.artifactCount} artifact{result.output.artifactCount === 1 ? '' : 's'}</span>
      </figcaption>
    </figure>
  );
}

// Readable body for a successful typed result (light surface), with structured
// summaries for embedding / voice-catalog rather than raw JSON (which moves to
// the Runtime details disclosure).
function ReadyBody({ result }: { result: TesterCapabilityRunResult & { ok: true } }) {
  const output = result.output;
  if (output.kind === 'text' || output.kind === 'transcript') {
    return <div className="studio-result__text">{output.text || '(empty body)'}</div>;
  }
  if (output.kind === 'artifacts') {
    const preview = <ArtifactPreview result={result} />;
    return (
      <div className="studio-result__rich">
        {preview}
        {!preview ? (
          <p className="studio-result__plain">
            Job {output.jobId || '(pending id)'} · {output.jobState} · {output.artifactCount} artifact
            {output.artifactCount === 1 ? '' : 's'} (no inline preview available).
          </p>
        ) : null}
      </div>
    );
  }
  if (output.kind === 'embedding') {
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">
          {output.vectorCount} vector{output.vectorCount === 1 ? '' : 's'} · {output.dimensions} dimensions
          {typeof output.totalTokens === 'number' ? ` · ${output.totalTokens} tokens` : ''}
        </p>
        <div className="studio-chips">
          {output.sample.map((value, index) => (
            <span key={index} className="studio-chip">{value.toFixed(4)}</span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <ul className="studio-voice-list">
      {output.sample.map((voice) => (
        <li key={voice.voiceId}>
          <strong>{voice.name}</strong>
          <span>{voice.voiceId} · {voice.lang}</span>
        </li>
      ))}
      {output.sample.length === 0 ? <li><span>No voices returned.</span></li> : null}
    </ul>
  );
}

// Runtime details disclosure — preserves the developer-tester diagnostic surface
// (runtime method id, admission detail, typed JSON, trace) beneath the product
// result view. Blockers are returned as typed unavailable results, surfaced here.
function RuntimeDetails({
  capability,
  result,
  admission,
  verboseConsole,
}: {
  capability: TesterCapability;
  result: TesterCapabilityRunResult | null;
  admission: CapabilityStatus;
  verboseConsole: boolean;
}) {
  return (
    <details className="studio-diag">
      <summary>Runtime details</summary>
      <dl className="studio-diag__grid">
        <div>
          <dt>Method</dt>
          <dd><code>{runtimeMethodFor(capability.id)}</code></dd>
        </div>
        <div>
          <dt>Admission</dt>
          <dd>{admission.detail}</dd>
        </div>
        {result && !result.ok ? (
          <div>
            <dt>Reason</dt>
            <dd>{result.reason}</dd>
          </div>
        ) : null}
        {result?.ok && result.trace?.traceId ? (
          <div>
            <dt>Trace</dt>
            <dd><code>{result.trace.traceId}</code>{result.trace.modelResolved ? ` · ${result.trace.modelResolved}` : ''}</dd>
          </div>
        ) : null}
      </dl>
      {result?.ok ? <pre className="studio-diag__json">{formatTypedOutput(result)}</pre> : null}
      {verboseConsole ? (
        <p className="studio-diag__note">
          Verbose console: capability {capability.id}; {result ? (result.ok ? 'typed success' : `fail-closed ${result.reason}`) : 'no current-session result'}.
        </p>
      ) : null}
    </details>
  );
}

type StudioResultStat = {
  label: string;
  value: string;
};

function cleanStudioModelName(value: string): string {
  const normalized = value.trim();
  return normalized.replace(/^(local-import|local|cloud)\//i, '').trim() || normalized;
}

function studioResultModelLabel(result: TesterCapabilityRunResult | null, capability: TesterCapability): string {
  if (result?.ok) {
    const traceModel = result.trace?.modelResolved?.trim();
    if (traceModel) return cleanStudioModelName(traceModel);
    if (result.output.kind === 'voice-catalog' && result.output.modelResolved.trim()) return cleanStudioModelName(result.output.modelResolved);
  }
  if (result && !result.ok) return 'sdk unavailable';
  return capability.label;
}

function formatStudioTokenCount(inputTokens?: number, outputTokens?: number, totalTokens?: number): string {
  if (typeof totalTokens === 'number') return String(totalTokens);
  if (typeof inputTokens === 'number' && typeof outputTokens === 'number') return String(inputTokens + outputTokens);
  return 'not captured';
}

function studioResultStats(result: TesterCapabilityRunResult | null, running: boolean, fallbackMetric: string): StudioResultStat[] {
  if (running) return [{ label: 'Status', value: 'Running' }];
  if (!result) return [{ label: 'Status', value: 'Waiting' }];
  if (!result.ok) return [{ label: 'Status', value: 'Blocked' }];
  const output = result.output;
  if (output.kind === 'text') {
    return [
      { label: 'Tokens', value: formatStudioTokenCount(output.inputTokens, output.outputTokens, output.totalTokens) },
      { label: 'Characters', value: String(output.text.length) },
    ];
  }
  if (output.kind === 'transcript') {
    return [
      { label: 'Characters', value: String(output.text.length) },
      { label: 'Artifacts', value: String(output.artifactCount) },
    ];
  }
  if (output.kind === 'embedding') {
    return [
      { label: 'Tokens', value: formatStudioTokenCount(undefined, undefined, output.totalTokens) },
      { label: 'Vectors', value: String(output.vectorCount) },
      { label: 'Dimensions', value: String(output.dimensions) },
    ];
  }
  if (output.kind === 'artifacts') {
    return [
      { label: 'Artifacts', value: String(output.artifactCount) },
      { label: 'State', value: output.jobState || 'unknown' },
    ];
  }
  return [
    { label: 'Voices', value: String(output.voiceCount) },
    { label: 'Result', value: fallbackMetric },
  ];
}

function studioResultTraceLabel(result: TesterCapabilityRunResult | null, running: boolean): string {
  if (running) return 'pending';
  if (result?.ok) return result.trace?.traceId?.trim() || 'not captured';
  return result ? 'not captured' : 'pending';
}

export function StudioResult({
  result,
  running,
  capability,
  admission,
  createdAt,
  streamingText,
  verboseConsole,
  onCopy,
  onDownload,
  onRegenerate,
}: {
  result: TesterCapabilityRunResult | null;
  running: boolean;
  capability: TesterCapability;
  admission: CapabilityStatus;
  createdAt?: string;
  streamingText?: string | null;
  verboseConsole: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const ready = result?.ok ? result : null;
  const blocked = result && !result.ok ? result : null;
  const plainText = result ? resultPlainText(result) : '';
  const canExport = Boolean(result && plainText);
  const modelLabel = studioResultModelLabel(result, capability);
  const traceLabel = studioResultTraceLabel(result, running);
  const runTimeLabel = createdAt ? formatTesterRunTimestamp(createdAt) : running ? 'Running' : 'Not recorded';

  let metric = '—';
  if (ready) {
    const output = ready.output;
    if (output.kind === 'text' || output.kind === 'transcript') metric = `${countStudioWords(output.text)} words`;
    else if (output.kind === 'artifacts') metric = `${output.artifactCount} artifact${output.artifactCount === 1 ? '' : 's'}`;
    else if (output.kind === 'embedding') metric = `${output.dimensions} dims`;
    else metric = `${output.voiceCount} voices`;
  }

  let body: ReactNode;
  if (running) {
    const hasStream = typeof streamingText === 'string';
    body = (
      <div className="studio-result__pending">
        <div className="studio-result__pending-line">
          <Loader2 size={15} aria-hidden="true" className="studio-spin" />
          <span>{capability.execution === 'standalone-tauri' ? 'Opening viewer fixture…' : hasStream ? 'Streaming from runtime…' : 'Calling runtime SDK…'}</span>
        </div>
        {hasStream ? <div className="studio-result__text studio-result__text--stream" aria-live="polite">{streamingText || '…'}</div> : null}
      </div>
    );
  } else if (blocked) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{unavailableReasonTitle(blocked.reason)}</span>
        </div>
        <p>{blocked.message}</p>
        <p className="studio-result__hint">{blocked.actionHint}</p>
      </div>
    );
  } else if (ready) {
    body = <ReadyBody result={ready} />;
  } else {
    body = (
      <EmptyState
        className="studio-empty"
        icon={<FileText size={18} aria-hidden="true" />}
        title={profile.emptyTitle}
        description={profile.emptyHint}
      />
    );
  }

  return (
    <Surface className="studio-result" material="glass-regular" tone="panel" elevation="floating" padding="none">
      <div className="studio-result__top">
        <div className="studio-result__identity">
          <span className="studio-result__avatar" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <strong className="studio-result__model" title={modelLabel}>{modelLabel}</strong>
          <span className="studio-result__copy-dot" aria-hidden="true" />
          <span className="studio-result__time">
            <Clock size={14} aria-hidden="true" />
            <time dateTime={createdAt}>{runTimeLabel}</time>
          </span>
        </div>
        <div className="studio-result__actions">
          <button type="button" className="studio-result__action" onClick={onCopy} disabled={!canExport} aria-label="Copy generation" title="Copy">
            <CopyIcon size={18} aria-hidden="true" />
            <span className="studio-result__action-label">Copy</span>
          </button>
          <button type="button" className="studio-result__action" onClick={onDownload} disabled={!canExport} aria-label="Download generation" title="Download">
            <DownloadIcon size={18} aria-hidden="true" />
            <span className="studio-result__action-label">Download</span>
          </button>
          <button type="button" className="studio-result__action" onClick={onRegenerate} disabled={running} aria-label="Regenerate" title="Regenerate">
            <RefreshCw size={18} aria-hidden="true" />
            <span className="studio-result__action-label">Regenerate</span>
          </button>
        </div>
      </div>
      <div className="studio-result__body">{body}</div>
      <div className="studio-result__foot">
        <div className="studio-result__stats">
          {studioResultStats(result, running, metric).map((stat) => (
            <span key={stat.label} className="studio-result__metric">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </span>
          ))}
        </div>
        <span className="studio-result__trace">
          <span>Trace</span>
          <code>{traceLabel}</code>
        </span>
      </div>
      <RuntimeDetails capability={capability} result={result} admission={admission} verboseConsole={verboseConsole} />
    </Surface>
  );
}

// Per-capability local run history, recovered from the desktop tester history
// panel. Reads only the app-owned localStorage history store (no runtime claim).
function historyToneForRun(record: TesterRunHistoryRecord): 'success' | 'warning' | 'info' | 'neutral' {
  const tone = getTesterRunStatusTone(record.status);
  if (tone === 'success') return 'success';
  if (tone === 'info') return 'info';
  if (tone === 'danger' || tone === 'warning') return 'warning';
  return 'neutral';
}

function historyTitleForRun(record: TesterRunHistoryRecord): string {
  const prompt = getTesterRunPromptSummary(record).trim();
  return prompt || getTesterRunResultSummary(record);
}

function historyLabelForRun(record: TesterRunHistoryRecord): string {
  const prompt = historyTitleForRun(record);
  const model = getTesterRunModelLabel(record);
  const source = getTesterRunModelSource(record);
  const metrics = getTesterRunMetricSummary(record);
  return [source === 'unknown' ? model : `${source} model: ${model}`, formatTesterRunTimestamp(record.createdAt), metrics, prompt ? `Prompt: ${prompt}` : ''].filter(Boolean).join(' / ');
}

function historyModelSourceLabel(source: TesterRunModelSource): string {
  if (source === 'local') return 'Local model';
  if (source === 'cloud') return 'Cloud model';
  return 'Model source not captured';
}

function HistoryModelSourceIcon({ source }: { source: TesterRunModelSource }) {
  const label = historyModelSourceLabel(source);
  return (
    <span className={`studio-recent__source studio-recent__source--${source}`} title={label} aria-label={label}>
      {source === 'cloud' ? <Cloud size={13} aria-hidden="true" /> : source === 'local' ? <HardDrive size={13} aria-hidden="true" /> : <CircleHelp size={13} aria-hidden="true" />}
    </span>
  );
}

export function CapabilityRunHistory({
  capability,
  history,
  activeRunId,
  onSelectRun,
}: {
  capability: TesterCapability;
  history: TesterRunHistory | null;
  activeRunId: string | null;
  onSelectRun: (record: TesterRunHistoryRecord) => void;
}) {
  const records = (history?.[capability.id] ?? []).slice(0, 12);

  return (
    <aside className="studio-history" aria-label="Recent runs History">
      <div className="studio-recent__head">
        <div className="studio-history__title">
          <strong>History</strong>
        </div>
      </div>
      {records.length === 0 ? (
        <p className="studio-recent__empty">No local run records for {capability.label} yet. Run with Runtime to start the app-owned history.</p>
      ) : (
        <>
          <ul className="studio-recent__rows">
            {records.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className={record.id === activeRunId ? 'studio-recent__row studio-recent__row--active' : 'studio-recent__row'}
                  onClick={() => onSelectRun(record)}
                  aria-current={record.id === activeRunId ? 'true' : undefined}
                  aria-label={historyLabelForRun(record)}
                >
                  <span className={`studio-recent__dot studio-recent__dot--${historyToneForRun(record)}`} aria-hidden="true" />
                  <span className="studio-recent__model-line">
                    <HistoryModelSourceIcon source={getTesterRunModelSource(record)} />
                    <span className="studio-recent__model" title={getTesterRunModelLabel(record)}>
                      {getTesterRunModelLabel(record)}
                    </span>
                  </span>
                  <time dateTime={record.createdAt}>{formatTesterRunTimestamp(record.createdAt)}</time>
                  <span className="studio-recent__metrics" title={historyTitleForRun(record)}>
                    {getTesterRunMetricSummary(record)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

export function downloadTextFile(filename: string, body: string) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// File extension for a saved media artifact, derived from its MIME subtype.
export function artifactExtension(mimeType?: string): string {
  const subtype = (mimeType || '').split('/')[1]?.split(';')[0]?.trim();
  if (!subtype) return 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'quicktime') return 'mov';
  return subtype;
}

// Save a runtime media artifact (image / audio / video) to disk. Works for both
// inline data URLs and hosted URLs by streaming the resource through a Blob.
export async function downloadArtifactUrl(filename: string, url: string) {
  if (typeof document === 'undefined') return;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Saving is best-effort; the inline preview remains the durable surface.
  }
}
