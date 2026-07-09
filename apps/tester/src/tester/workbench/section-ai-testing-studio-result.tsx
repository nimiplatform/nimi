import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState, IconButton, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { AlertTriangle, ChevronRight, Clock, Copy as CopyIcon, Download as DownloadIcon, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { TesterCapability } from '../tester-capabilities.js';
import { formatTesterRunTimestamp } from '../tester-history.js';
import type { TesterCapabilityRunResult } from '../tester-runtime.js';
import { unavailableReasonUserAction, unavailableReasonUserMessage } from '../tester-unavailable.js';
import { countStudioWords, getCapabilityStudioProfile, runtimeMethodFor } from './capability-studio-profiles.js';
import type { CapabilityStatus } from './section-ai-testing-admission.js';
import { ArtifactMediaPreview, RuntimeDiagnosticsActions, formatTypedOutput, formatUnavailableOutput, hasPreviewableArtifact, resultPlainText, TextStudioOutputBody } from './section-ai-testing-output.js';

function ArtifactPreview({ result }: { result: TesterCapabilityRunResult & { ok: true } }) {
  if (result.output.kind !== 'artifacts') return null;
  return <ArtifactMediaPreview artifact={result.output.firstArtifact} fallbackLabel={result.output.jobId} />;
}

// Readable body for a successful typed result (light surface), with structured
// summaries for embedding / voice-catalog rather than raw JSON (which moves to
// the Runtime details disclosure).
function ReadyBody({ result }: { result: TesterCapabilityRunResult & { ok: true } }) {
  const output = result.output;
  if (output.kind === 'text' || output.kind === 'transcript') {
    return <TextStudioOutputBody text={output.text} />;
  }
  if (output.kind === 'artifacts') {
    const preview = hasPreviewableArtifact(output.firstArtifact) ? <ArtifactPreview result={result} /> : null;
    return (
      <div className="studio-result__rich">
        {preview}
        {!preview ? <p className="studio-result__plain">Media generated successfully.</p> : null}
      </div>
    );
  }
  if (output.kind === 'embedding') {
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">Embedding generated successfully.</p>
      </div>
    );
  }
  return (
    <ul className="studio-voice-list">
      {output.sample.map((voice) => (
        <li key={voice.voiceId}>
          <strong>{voice.name}</strong>
          <span>{voice.voiceId} / {voice.lang}</span>
        </li>
      ))}
      {output.sample.length === 0 ? <li><span>No voices returned.</span></li> : null}
    </ul>
  );
}

// Runtime details disclosure - preserves the developer-tester diagnostic surface
// (runtime method id, admission detail, typed JSON, trace) beneath the product
// result view. Blockers are returned as typed unavailable results, surfaced here.
function formatRuntimeDetailsExport({
  capability,
  result,
  admission,
  verboseConsole,
}: {
  capability: TesterCapability;
  result: TesterCapabilityRunResult | null;
  admission: CapabilityStatus;
  verboseConsole: boolean;
}): string {
  const lines = [
    'Runtime details',
    '',
    `Capability: ${capability.id}`,
    `Method: ${runtimeMethodFor(capability.id)}`,
    `Admission: ${admission.detail}`,
  ];
  if (result && !result.ok) {
    lines.push(`Reason: ${result.reason}`);
  }
  if (result?.ok && result.trace?.traceId) {
    lines.push(`Trace: ${result.trace.traceId}${result.trace.modelResolved ? ` / ${result.trace.modelResolved}` : ''}`);
  }
  if (result) {
    lines.push('', result.ok ? 'Output:' : 'Diagnostics:', result.ok ? formatTypedOutput(result) : formatUnavailableOutput(result));
  }
  if (verboseConsole) {
    lines.push('', `Verbose console: capability ${capability.id}; ${result ? (result.ok ? 'typed success' : `fail-closed ${result.reason}`) : 'no current-session result'}.`);
  }
  return lines.join('\n');
}

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
  const diagnosticsText = result && !result.ok ? formatUnavailableOutput(result) : '';
  const runtimeDetailsText = formatRuntimeDetailsExport({ capability, result, admission, verboseConsole });
  return (
    <details className="studio-diag">
      <summary>Runtime details</summary>
      <RuntimeDiagnosticsActions text={runtimeDetailsText} filenameBase={capability.id} />
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
            <dd><code>{result.trace.traceId}</code>{result.trace.modelResolved ? ` / ${result.trace.modelResolved}` : ''}</dd>
          </div>
        ) : null}
      </dl>
      {result ? <pre className="studio-diag__json">{result.ok ? formatTypedOutput(result) : diagnosticsText}</pre> : null}
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

function studioResultModelLabel(result: TesterCapabilityRunResult | null, capability: TesterCapability, preferredLabel?: string): string {
  const preferred = preferredLabel?.trim();
  if (preferred) return cleanStudioModelName(preferred);
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
    return [{ label: 'Result', value: 'Created' }];
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

export function StudioResult({
  result,
  running,
  capability,
  admission,
  createdAt,
  modelLabel,
  modelSettings,
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
  modelLabel?: string;
  modelSettings?: ReactNode;
  streamingText?: string | null;
  verboseConsole: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
}) {
  const profile = getCapabilityStudioProfile(capability.id);
  const ready = result?.ok ? result : null;
  const blocked = result && !result.ok ? result : null;
  const plainText = ready ? resultPlainText(ready) : '';
  const canExport = Boolean(ready && plainText);
  const displayModelLabel = studioResultModelLabel(result, capability, modelLabel);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const hasModelSettings = Boolean(modelSettings);
  const runTimeLabel = createdAt ? formatTesterRunTimestamp(createdAt) : running ? 'Running' : 'Not recorded';
  const statusTitle = running ? 'Runtime running' : blocked ? 'Runtime blocked' : ready ? 'Runtime ready' : 'Runtime waiting';
  const statusTone = blocked ? 'warning' : ready ? 'success' : running ? 'info' : 'neutral';
  useEffect(() => {
    if (!hasModelSettings) setModelSettingsOpen(false);
  }, [hasModelSettings]);

  let metric = '-';
  if (ready) {
    const output = ready.output;
    if (output.kind === 'text' || output.kind === 'transcript') metric = `${countStudioWords(output.text)} words`;
    else if (output.kind === 'artifacts') metric = `${output.artifactCount} artifact${output.artifactCount === 1 ? '' : 's'}`;
    else if (output.kind === 'embedding') metric = 'created';
    else metric = `${output.voiceCount} voices`;
  }
  const stats = studioResultStats(result, running, metric);

  let body: ReactNode;
  if (running) {
    const hasStream = typeof streamingText === 'string';
    body = (
      <div className="studio-result__pending">
        <div className="studio-result__pending-line">
          <Loader2 size={15} aria-hidden="true" className="studio-spin" />
          <span>{capability.execution === 'standalone-tauri' ? 'Opening viewer fixture...' : hasStream ? 'Streaming from runtime...' : 'Calling runtime SDK...'}</span>
        </div>
        {hasStream ? <div className="studio-result__text studio-result__text--stream" aria-live="polite">{streamingText || '...'}</div> : null}
      </div>
    );
  } else if (blocked) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>Generation could not be completed</span>
        </div>
        <p>{unavailableReasonUserMessage(blocked.reason)}</p>
        <p className="studio-result__hint">{unavailableReasonUserAction(blocked.reason)}</p>
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
          <span className={`studio-result__avatar studio-result__avatar--${statusTone}`} aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span className="studio-result__title-stack">
            <strong>{statusTitle}</strong>
            <span className="studio-result__time">
              <Clock size={14} aria-hidden="true" />
              <time dateTime={createdAt}>Run / {runTimeLabel}</time>
            </span>
          </span>
        </div>
        <div className="studio-result__actions">
          {!blocked ? (
            <>
              <Tooltip content="Copy" placement="top">
                <IconButton type="button" className="studio-result__action" onClick={onCopy} disabled={!canExport} aria-label="Copy generation" icon={<CopyIcon size={15} aria-hidden="true" />} />
              </Tooltip>
              <Tooltip content="Download" placement="top">
                <IconButton type="button" className="studio-result__action" onClick={onDownload} disabled={!canExport} aria-label="Download generation" icon={<DownloadIcon size={15} aria-hidden="true" />} />
              </Tooltip>
            </>
          ) : null}
          <Tooltip content="Regenerate" placement="top">
            <IconButton type="button" className="studio-result__action" onClick={onRegenerate} disabled={running} aria-label="Regenerate" icon={<RefreshCw size={15} aria-hidden="true" />} />
          </Tooltip>
        </div>
      </div>
      <div className="studio-result__meta">
        <div className={`studio-result__runtime-chip studio-result__runtime-chip--${statusTone}`}>
          <Sparkles size={14} aria-hidden="true" />
          <span>Runtime SDK</span>
        </div>
        <div className="studio-result__stats studio-result__stats--top" aria-label="Generation metrics">
          {stats.map((stat) => (
            <span key={stat.label} className="studio-result__metric">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </span>
          ))}
        </div>
        <div className="studio-result__model-pill">
          <span>Model</span>
          <div className={hasModelSettings ? 'studio-model-pill__box' : 'studio-model-pill__box studio-model-pill__box--static'}>
            <Tooltip content={displayModelLabel} placement="top" className="min-w-0">
              <strong>{displayModelLabel}</strong>
            </Tooltip>
            {hasModelSettings ? (
              <Tooltip content={modelSettingsOpen ? 'Hide model settings' : 'Show model settings'} placement="top">
                <IconButton
                  type="button"
                  className={modelSettingsOpen ? 'studio-model-pill__trigger studio-model-pill__trigger--open' : 'studio-model-pill__trigger'}
                  aria-label={modelSettingsOpen ? 'Hide model settings' : 'Show model settings'}
                  aria-expanded={modelSettingsOpen}
                  onClick={() => setModelSettingsOpen((value) => !value)}
                  icon={<ChevronRight size={15} aria-hidden="true" />}
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>
      {modelSettingsOpen && modelSettings ? modelSettings : null}
      <div className="studio-result__body">{body}</div>
      <RuntimeDetails capability={capability} result={result} admission={admission} verboseConsole={verboseConsole} />
    </Surface>
  );
}
