import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState, IconButton, StatusBadge, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { AlertTriangle, ChevronRight, Clock, Copy as CopyIcon, Download as DownloadIcon, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from '../../shell/i18n/index.js';
import type { TesterCapability } from '../tester-capabilities.js';
import { formatTesterRunTimestamp } from '../tester-history.js';
import type { TesterCapabilityRunResult } from '../tester-runtime.js';
import { unavailableReasonUserAction, unavailableReasonUserMessage } from '../tester-unavailable.js';
import { countStudioWords, getCapabilityStudioProfile, runtimeMethodFor } from './capability-studio-profiles.js';
import type { CapabilityStatus } from './section-ai-testing-admission.js';
import { ArtifactMediaResult, RuntimeDiagnosticsActions, formatTypedOutput, formatUnavailableOutput, resultPlainText, TextStudioOutputBody } from './section-ai-testing-output.js';
import { useTesterRendererHost } from '../../renderer/context.js';

// Readable body for a successful typed result (light surface), with structured
// summaries for embedding / voice-catalog rather than raw JSON (which moves to
// the Runtime details disclosure).
function ReadyBody({ result }: { result: TesterCapabilityRunResult & { ok: true } }) {
  const { t } = useTranslation();
  const output = result.output;
  if (output.kind === 'text' || output.kind === 'transcript') {
    return <TextStudioOutputBody text={output.text} />;
  }
  if (output.kind === 'artifacts') {
    return (
      <div className="studio-result__rich">
        {output.artifacts.map((artifact, index) => (
          <ArtifactMediaResult
            key={artifact.relativePath}
            artifact={artifact}
            fallbackLabel={`${output.jobId}:${index + 1}`}
          />
        ))}
      </div>
    );
  }
  if (output.kind === 'embedding') {
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">{t('StudioShell.embeddingSuccess')}</p>
      </div>
    );
  }
  if (output.kind === 'voice-asset') {
    return (
      <ul className="studio-voice-list">
        <li>
          <strong>{output.voiceAssetId}</strong>
          <span>{output.creationSource} / {output.assetStatus}</span>
        </li>
      </ul>
    );
  }
  return (
    <ul className="studio-voice-list">
      {output.sample.map((voice) => (
        <li key={voice.voiceId}>
          <strong>{voice.voiceId}</strong>
          <span>{voice.creationSource} / {voice.status}</span>
        </li>
      ))}
      {output.sample.length === 0 ? <li><span>{t('StudioShell.noVoices')}</span></li> : null}
    </ul>
  );
}

// Runtime details disclosure - preserves the developer-tester diagnostic surface
// (runtime method id, admission detail, typed JSON, trace) beneath the product
// result view. Blockers are returned as typed unavailable results, surfaced here.
// The exported text stays English: it is a machine-oriented diagnostic dump.
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
    lines.push(`Trace: ${result.trace.traceId}`);
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
  const { t } = useTranslation();
  const diagnosticsText = result && !result.ok ? formatUnavailableOutput(result) : '';
  const runtimeDetailsText = formatRuntimeDetailsExport({ capability, result, admission, verboseConsole });
  return (
    <details className="studio-diag">
      <summary>{t('StudioShell.runtimeDetails')}</summary>
      <RuntimeDiagnosticsActions text={runtimeDetailsText} filenameBase={capability.id} />
      <dl className="studio-diag__grid">
        <div>
          <dt>{t('Studio.result.methodLabel')}</dt>
          <dd><code>{runtimeMethodFor(capability.id)}</code></dd>
        </div>
        <div>
          <dt>{t('Studio.result.admissionLabel')}</dt>
          <dd>{admission.detail}</dd>
        </div>
        {result && !result.ok ? (
          <div>
            <dt>{t('Studio.result.reasonLabel')}</dt>
            <dd>{result.reason}</dd>
          </div>
        ) : null}
        {result?.ok && result.trace?.traceId ? (
          <div>
            <dt>{t('Studio.result.traceLabel')}</dt>
            <dd><code>{result.trace.traceId}</code></dd>
          </div>
        ) : null}
      </dl>
      {result ? <pre className="studio-diag__json">{result.ok ? formatTypedOutput(result) : diagnosticsText}</pre> : null}
      {verboseConsole ? (
        <p className="studio-diag__note">
          {t('Studio.result.verboseConsoleNote', {
            capability: capability.id,
            state: result
              ? (result.ok
                ? t('Studio.result.verboseTypedSuccess')
                : t('Studio.result.verboseFailClosed', { reason: result.reason }))
              : t('Studio.result.verboseNoResult'),
          })}
        </p>
      ) : null}
    </details>
  );
}

type StudioResultStat = {
  label: string;
  value: string;
};

function studioResultIntentLabel(result: TesterCapabilityRunResult | null, capability: TesterCapability, preferredLabel: string | undefined, translate: (key: string) => string): string {
  const preferred = preferredLabel?.trim();
  if (preferred) return preferred;
  if (result && !result.ok) return translate('Studio.result.sdkUnavailable');
  return translate(capability.labelKey);
}

export function StudioResult({
  result,
  running,
  capability,
  admission,
  createdAt,
  intentLabel,
  requestSettings,
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
  intentLabel?: string;
  requestSettings?: ReactNode;
  streamingText?: string | null;
  verboseConsole: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
}) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const profile = getCapabilityStudioProfile(capability.id);
  const ready = result?.ok ? result : null;
  const canceled = result && !result.ok && result.reason === 'runtime-canceled' ? result : null;
  const timedOut = result && !result.ok && result.reason === 'runtime-timeout' ? result : null;
  const blocked = result && !result.ok
    && result.reason !== 'runtime-canceled'
    && result.reason !== 'runtime-timeout' ? result : null;
  const plainText = ready ? resultPlainText(ready) : '';
  const canExport = Boolean(ready && plainText);
  const displayIntentLabel = studioResultIntentLabel(result, capability, intentLabel, t);
  const [requestSettingsOpen, setRequestSettingsOpen] = useState(false);
  const hasRequestSettings = Boolean(requestSettings);
  const simulated = ready?.trace?.simulated === true;
  const runTimeLabel = createdAt
    ? formatTesterRunTimestamp(createdAt, new Date(rendererHost.clock.now()))
    : running ? t('Studio.result.statRunning') : t('Studio.result.notRecorded');
  const statusTitleKey = simulated
    ? running ? 'simulatorRunning' : blocked ? 'simulatorBlocked' : ready ? 'simulatorResult' : 'simulatorWaiting'
    : running ? 'runtimeRunning' : canceled ? 'runtimeCanceled' : timedOut ? 'runtimeTimedOut' : blocked ? 'runtimeBlocked' : ready ? 'runtimeResult' : 'runtimeWaiting';
  const statusTitle = t(`Studio.result.status.${statusTitleKey}`);
  const statusTone = blocked || canceled || timedOut ? 'warning' : ready ? 'success' : running ? 'info' : 'neutral';
  useEffect(() => {
    if (!hasRequestSettings) setRequestSettingsOpen(false);
  }, [hasRequestSettings]);

  function formatStudioTokenCount(inputTokens?: number, outputTokens?: number, totalTokens?: number): string {
    if (typeof totalTokens === 'number') return String(totalTokens);
    if (typeof inputTokens === 'number' && typeof outputTokens === 'number') return String(inputTokens + outputTokens);
    return t('Studio.result.tokensNotCaptured');
  }

  function studioResultStats(fallbackMetric: string): StudioResultStat[] {
    if (running) return [{ label: t('Studio.result.statStatus'), value: t('Studio.result.statRunning') }];
    if (!result) return [{ label: t('Studio.result.statStatus'), value: t('Studio.result.statWaiting') }];
    if (!result.ok) return [{
      label: t('Studio.result.statStatus'),
      value: t(result.reason === 'runtime-canceled'
        ? 'Studio.result.statCanceled'
        : result.reason === 'runtime-timeout'
          ? 'Studio.result.statTimedOut'
          : 'Studio.result.statBlocked'),
    }];
    const output = result.output;
    if (output.kind === 'text') {
      return [
        { label: t('Studio.result.statTokens'), value: formatStudioTokenCount(output.inputTokens, output.outputTokens, output.totalTokens) },
        { label: t('Studio.result.statCharacters'), value: String(output.text.length) },
      ];
    }
    if (output.kind === 'transcript') {
      return [
        { label: t('Studio.result.statCharacters'), value: String(output.text.length) },
        { label: t('Studio.result.statArtifacts'), value: String(output.artifactCount) },
      ];
    }
    if (output.kind === 'embedding') {
      return [{ label: t('Studio.result.statResult'), value: t('Studio.result.statCreated') }];
    }
    if (output.kind === 'artifacts') {
      return [
        { label: t('Studio.result.statArtifacts'), value: String(output.artifactCount) },
        { label: t('Studio.result.statState'), value: output.jobState || t('Studio.result.stateUnknown') },
      ];
    }
    if (output.kind === 'voice-asset') {
      return [
        { label: t('Studio.result.statState'), value: output.assetStatus },
        { label: t('Studio.result.statResult'), value: output.creationSource },
      ];
    }
    return [
      { label: t('Studio.result.statVoices'), value: String(output.voiceCount) },
      { label: t('Studio.result.statResult'), value: fallbackMetric },
    ];
  }

  let metric = '-';
  if (ready) {
    const output = ready.output;
    if (output.kind === 'text' || output.kind === 'transcript') metric = t('Studio.result.metricWords', { count: countStudioWords(output.text) });
    else if (output.kind === 'artifacts') metric = t('Studio.result.metricArtifacts', { count: output.artifactCount });
    else if (output.kind === 'embedding') metric = t('Studio.result.metricCreated');
    else if (output.kind === 'voice-asset') metric = output.creationSource;
    else metric = t('Studio.result.metricVoices', { count: output.voiceCount });
  }
  const stats = studioResultStats(metric);

  let body: ReactNode;
  if (running) {
    const hasStream = typeof streamingText === 'string';
    body = (
      <div className="studio-result__pending">
        <div className="studio-result__pending-line">
          <Loader2 size={15} aria-hidden="true" className="studio-spin" />
          <span>{capability.execution === 'standalone-tauri'
            ? t('Studio.result.pendingViewer')
            : simulated
              ? t('Studio.result.pendingSimulator')
              : hasStream ? t('Studio.result.pendingStreaming') : t('Studio.result.pendingRuntime')}</span>
        </div>
        {hasStream ? <div className="studio-result__text studio-result__text--stream" aria-live="polite">{streamingText || '...'}</div> : null}
      </div>
    );
  } else if (canceled) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <Clock size={15} aria-hidden="true" />
          <span>{t('StudioShell.generationCanceled')}</span>
        </div>
        <p>{unavailableReasonUserMessage(canceled.reason)}</p>
        <p className="studio-result__hint">{unavailableReasonUserAction(canceled.reason)}</p>
      </div>
    );
  } else if (timedOut) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <Clock size={15} aria-hidden="true" />
          <span>{statusTitle}</span>
        </div>
        <p>{unavailableReasonUserMessage(timedOut.reason)}</p>
        <p className="studio-result__hint">{unavailableReasonUserAction(timedOut.reason)}</p>
      </div>
    );
  } else if (blocked) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{t('StudioShell.generationFailed')}</span>
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
        title={t(profile.emptyTitleKey)}
        description={t(profile.emptyHintKey)}
      />
    );
  }

  return (
    <Surface className="studio-result" material="glass-regular" tone="panel" elevation="floating" padding="none">
      <div className="studio-result__top">
        <div className="studio-result__identity">
          <StatusBadge
            tone={statusTone}
            shape="soft"
            className="grid h-11 w-11 place-items-center rounded-[var(--nimi-radius-md)] p-0"
            aria-hidden="true"
          >
            <Sparkles size={20} />
          </StatusBadge>
          <span className="studio-result__title-stack">
            <strong>{statusTitle}</strong>
            <span className="studio-result__time">
              <Clock size={14} aria-hidden="true" />
              <time dateTime={createdAt}>{t('Studio.result.runTimeLabel', { time: runTimeLabel })}</time>
            </span>
          </span>
        </div>
        <div className="studio-result__actions">
          {!blocked && !canceled ? (
            <>
              <Tooltip content={t('Common.copy')} placement="top">
                <IconButton type="button" className="studio-result__action" onClick={onCopy} disabled={!canExport} aria-label={t('StudioShell.copyGeneration')} icon={<CopyIcon size={15} aria-hidden="true" />} />
              </Tooltip>
              <Tooltip content={t('StudioShell.download')} placement="top">
                <IconButton type="button" className="studio-result__action" onClick={onDownload} disabled={!canExport} aria-label={t('StudioShell.downloadGeneration')} icon={<DownloadIcon size={15} aria-hidden="true" />} />
              </Tooltip>
            </>
          ) : null}
          <Tooltip content={t('StudioShell.regenerate')} placement="top">
            <IconButton type="button" className="studio-result__action" onClick={onRegenerate} disabled={running} aria-label={t('StudioShell.regenerate')} icon={<RefreshCw size={15} aria-hidden="true" />} />
          </Tooltip>
        </div>
      </div>
      <div className="studio-result__meta">
        <StatusBadge tone={statusTone} shape="soft" className="min-h-[30px] shrink-0 gap-[7px] px-3 text-sm font-[var(--nimi-type-page-title-weight)]">
          <Sparkles size={14} aria-hidden="true" />
          <span>{simulated ? t('Studio.result.simulatedChip') : t('Studio.result.runtimeChip')}</span>
        </StatusBadge>
        <div className="studio-result__stats studio-result__stats--top" aria-label={t('Studio.result.generationMetrics')}>
          {stats.map((stat) => (
            <span key={stat.label} className="studio-result__metric">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </span>
          ))}
        </div>
        <div className="studio-result__intent-pill">
          <span>{t('StudioShell.intentLabel')}</span>
          <div className={hasRequestSettings ? 'studio-intent-pill__box' : 'studio-intent-pill__box studio-intent-pill__box--static'}>
            <Tooltip content={displayIntentLabel} placement="top" className="min-w-0">
              <strong>{displayIntentLabel}</strong>
            </Tooltip>
            {hasRequestSettings ? (
              <Tooltip content={requestSettingsOpen ? t('StudioShell.hideRequestSettings') : t('StudioShell.showRequestSettings')} placement="top">
                <IconButton
                  type="button"
                  className={requestSettingsOpen ? 'studio-intent-pill__trigger studio-intent-pill__trigger--open' : 'studio-intent-pill__trigger'}
                  aria-label={requestSettingsOpen ? t('StudioShell.hideRequestSettings') : t('StudioShell.showRequestSettings')}
                  aria-expanded={requestSettingsOpen}
                  onClick={() => setRequestSettingsOpen((value) => !value)}
                  icon={<ChevronRight size={15} aria-hidden="true" />}
                />
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>
      {requestSettingsOpen && requestSettings ? requestSettings : null}
      <div className="studio-result__body">{body}</div>
      <RuntimeDetails capability={capability} result={result} admission={admission} verboseConsole={verboseConsole} />
    </Surface>
  );
}
