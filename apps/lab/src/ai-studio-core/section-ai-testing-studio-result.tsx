import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState, IconButton, StatusBadge, Surface, Tooltip } from '@nimiplatform/kit/ui';
import { AlertTriangle, ChevronRight, Clock, Copy as CopyIcon, Download as DownloadIcon, FileText, FolderOpen, Loader2, RefreshCw, Sparkles, Square } from 'lucide-react';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRunResult } from './runtime-types.js';
import type { StudioCapabilityDescriptor, StudioCapabilityRegistration } from './module-registration.js';
import { formatStudioRunTimestamp } from './history.js';
import { studioNonSuccessReasonUserAction, studioNonSuccessReasonUserMessage, type StudioTranslate } from './non-success-presentation.js';
import { countStudioWords } from './studio-directives.js';
import type { CapabilityStatus } from './section-ai-testing-admission.js';
import { ArtifactMediaResult, RuntimeDiagnosticsActions, formatTypedOutput, formatNonSuccessOutput, resultPlainText, TextStudioOutputBody } from './section-ai-testing-output.js';

// Readable body for a successful typed result (light surface), with structured
// summaries for embedding / voice-catalog rather than raw JSON (which moves to
// the Runtime details disclosure).
function ReadyBody({ result }: { result: StudioCapabilityRunResult & { ok: true } }) {
  const { translate: t } = useAIStudioHost();
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
      <div className="studio-result__rich">
        <p className="studio-result__plain">{t('StudioShell.voiceAssetSuccess')}</p>
      </div>
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

// Runtime details disclosure shared by every AI Studio host.
// (runtime method id, admission detail, typed JSON, trace) beneath the product
// result view. Blockers are returned as typed unavailable results, surfaced here.
// The exported text stays English: it is a machine-oriented diagnostic dump.
function formatRuntimeDetailsExport({
  registration,
  result,
  admission,
  verboseConsole,
  translate,
}: {
  registration: StudioCapabilityRegistration;
  result: StudioCapabilityRunResult | null;
  admission: CapabilityStatus;
  verboseConsole: boolean;
  translate: StudioTranslate;
}): string {
  const capability = registration.descriptor;
  const lines = [
    'Runtime details',
    '',
    `Capability: ${capability.id}`,
    `Method: ${registration.runtimeMethod}`,
    `Admission: ${admission.detail}`,
  ];
  if (result && !result.ok) {
    lines.push(`Reason: ${result.reason}`);
  }
  if (result?.ok && result.trace?.traceId) {
    lines.push(`Trace: ${result.trace.traceId}`);
  }
  if (result) {
    lines.push('', result.ok ? 'Output:' : 'Diagnostics:', result.ok ? formatTypedOutput(result, translate) : formatNonSuccessOutput(result, translate));
  }
  if (verboseConsole) {
    lines.push('', `Verbose console: capability ${capability.id}; ${result ? (result.ok ? 'typed success' : `fail-closed ${result.reason}`) : 'no current-session result'}.`);
  }
  return lines.join('\n');
}

function RuntimeDetails({
  registration,
  result,
  admission,
  verboseConsole,
}: {
  registration: StudioCapabilityRegistration;
  result: StudioCapabilityRunResult | null;
  admission: CapabilityStatus;
  verboseConsole: boolean;
}) {
  const { translate: t } = useAIStudioHost();
  const capability = registration.descriptor;
  const diagnosticsText = result && !result.ok ? formatNonSuccessOutput(result, t) : '';
  const runtimeDetailsText = formatRuntimeDetailsExport({ registration, result, admission, verboseConsole, translate: t });
  return (
    <details className="studio-diag">
      <summary>{t('StudioShell.runtimeDetails')}</summary>
      <RuntimeDiagnosticsActions text={runtimeDetailsText} filenameBase={capability.id} />
      <dl className="studio-diag__grid">
        <div>
          <dt>{t('Studio.result.methodLabel')}</dt>
          <dd><code>{registration.runtimeMethod}</code></dd>
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
      {result ? <pre className="studio-diag__json">{result.ok ? formatTypedOutput(result, t) : diagnosticsText}</pre> : null}
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

function studioResultIntentLabel(result: StudioCapabilityRunResult | null, capability: StudioCapabilityDescriptor, preferredLabel: string | undefined, translate: (key: string) => string): string {
  const preferred = preferredLabel?.trim();
  if (preferred) return preferred;
  if (result && !result.ok) return translate('Studio.result.sdkUnavailable');
  return translate(capability.labelKey);
}

export function StudioResult({
  result,
  running,
  cancelRequested,
  registration,
  admission,
  createdAt,
  intentLabel,
  requestSettings,
  streamingText,
  verboseConsole,
  onCopy,
  onDownload,
  onRegenerate,
  onCancel,
}: {
  result: StudioCapabilityRunResult | null;
  running: boolean;
  cancelRequested: boolean;
  registration: StudioCapabilityRegistration;
  admission: CapabilityStatus;
  createdAt?: string;
  intentLabel?: string;
  requestSettings?: ReactNode;
  streamingText?: string | null;
  verboseConsole: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
  onCancel?: () => void;
}) {
  const rendererHost = useAIStudioHost();
  const t = rendererHost.translate;
  const capability = registration.descriptor;
  const profile = registration.profile;
  const ready = result?.ok ? result : null;
  const operationAborted = result && !result.ok && result.reason === 'operation-aborted' ? result : null;
  const canceled = result && !result.ok && result.reason === 'runtime-canceled' ? result : null;
  const timedOut = result && !result.ok && result.reason === 'runtime-timeout' ? result : null;
  const blocked = result && !result.ok
    && result.reason !== 'runtime-canceled'
    && result.reason !== 'operation-aborted'
    && result.reason !== 'runtime-timeout' ? result : null;
  const plainText = ready ? resultPlainText(ready, t) : '';
  const canExport = Boolean(ready && plainText);
  const revealsManagedAsset = ready?.output.kind === 'artifacts';
  const displayIntentLabel = studioResultIntentLabel(result, capability, intentLabel, t);
  const [requestSettingsOpen, setRequestSettingsOpen] = useState(false);
  const hasRequestSettings = Boolean(requestSettings);
  const runTimeLabel = createdAt
    ? formatStudioRunTimestamp(createdAt, new Date(rendererHost.clock.now()))
    : running ? t('Studio.result.statRunning') : t('Studio.result.notRecorded');
  const statusTitleKey = cancelRequested ? 'stopping' : running ? 'runtimeRunning' : operationAborted ? 'operationAborted' : canceled ? 'runtimeCanceled' : timedOut ? 'runtimeTimedOut' : blocked ? 'runtimeBlocked' : ready ? 'runtimeResult' : 'runtimeWaiting';
  const statusTitle = t(`Studio.result.status.${statusTitleKey}`);
  const statusTone = blocked || operationAborted || canceled || timedOut ? 'warning' : ready ? 'success' : running ? 'info' : 'neutral';
  useEffect(() => {
    if (!hasRequestSettings) setRequestSettingsOpen(false);
  }, [hasRequestSettings]);

  function formatStudioTokenCount(inputTokens?: number, outputTokens?: number, totalTokens?: number): string {
    if (typeof totalTokens === 'number') return String(totalTokens);
    if (typeof inputTokens === 'number' && typeof outputTokens === 'number') return String(inputTokens + outputTokens);
    return t('Studio.result.tokensNotCaptured');
  }

  function studioResultStats(fallbackMetric: string): StudioResultStat[] {
    if (running) return [{ label: t('Studio.result.statStatus'), value: t(cancelRequested ? 'Studio.result.statStopping' : 'Studio.result.statRunning') }];
    if (!result) return [{ label: t('Studio.result.statStatus'), value: t('Studio.result.statWaiting') }];
    if (!result.ok) return [{
      label: t('Studio.result.statStatus'),
      value: t(result.reason === 'operation-aborted'
        ? 'Studio.result.statStopped'
        : result.reason === 'runtime-canceled'
          ? 'Studio.result.statCanceled'
        : result.reason === 'runtime-timeout'
          ? 'Studio.result.statTimedOut'
          : 'Studio.result.statBlocked'),
    }];
    const output = result.output;
    if (output.kind === 'text') {
      const tokenCount = formatStudioTokenCount(output.inputTokens, output.outputTokens, output.totalTokens);
      return [
        ...(tokenCount === t('Studio.result.tokensNotCaptured') ? [] : [{ label: t('Studio.result.statTokens'), value: tokenCount }]),
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
        { label: t('Studio.result.statState'), value: output.jobState === 'COMPLETED' ? t('Studio.result.statCompleted') : output.jobState || t('Studio.result.stateUnknown') },
      ];
    }
    if (output.kind === 'voice-asset') {
      return [
        { label: t('Studio.result.statState'), value: t('Studio.result.statAvailable') },
        { label: t('Studio.result.statResult'), value: t(output.creationSource === 'text-description' ? 'Studio.result.createdFromDescription' : 'Studio.result.createdFromAudio') },
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
          <span>{cancelRequested
            ? t('Studio.result.pendingCancel')
            : profile.pendingLabelKey
            ? t(profile.pendingLabelKey)
            : hasStream ? t('Studio.result.pendingStreaming') : t('Studio.result.pendingRuntime')}</span>
        </div>
        {hasStream ? <div className="studio-result__text studio-result__text--stream" aria-live="polite">{streamingText || '...'}</div> : null}
      </div>
    );
  } else if (operationAborted) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <Clock size={15} aria-hidden="true" />
          <span>{statusTitle}</span>
        </div>
        <p>{studioNonSuccessReasonUserMessage(operationAborted.reason, t)}</p>
        <p className="studio-result__hint">{studioNonSuccessReasonUserAction(operationAborted.reason, t)}</p>
      </div>
    );
  } else if (canceled) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <Clock size={15} aria-hidden="true" />
          <span>{t('StudioShell.generationCanceled')}</span>
        </div>
        <p>{studioNonSuccessReasonUserMessage(canceled.reason, t)}</p>
        <p className="studio-result__hint">{studioNonSuccessReasonUserAction(canceled.reason, t)}</p>
      </div>
    );
  } else if (timedOut) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <Clock size={15} aria-hidden="true" />
          <span>{statusTitle}</span>
        </div>
        <p>{studioNonSuccessReasonUserMessage(timedOut.reason, t)}</p>
        <p className="studio-result__hint">{studioNonSuccessReasonUserAction(timedOut.reason, t)}</p>
      </div>
    );
  } else if (blocked) {
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{t('StudioShell.generationFailed')}</span>
        </div>
        <p>{studioNonSuccessReasonUserMessage(blocked.reason, t)}</p>
        <p className="studio-result__hint">{studioNonSuccessReasonUserAction(blocked.reason, t)}</p>
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
          {running && onCancel ? (
            <Tooltip content={t(cancelRequested ? 'StudioShell.cancelRequested' : 'StudioShell.cancelGeneration')} placement="top">
              <IconButton type="button" className="studio-result__action" onClick={onCancel} disabled={cancelRequested} aria-label={t(cancelRequested ? 'StudioShell.cancelRequested' : 'StudioShell.cancelGeneration')} icon={<Square size={14} aria-hidden="true" />} />
            </Tooltip>
          ) : null}
          {!blocked && !canceled ? (
            <>
              <Tooltip content={t('Common.copy')} placement="top">
                <IconButton type="button" className="studio-result__action" onClick={onCopy} disabled={!canExport} aria-label={t('StudioShell.copyGeneration')} icon={<CopyIcon size={15} aria-hidden="true" />} />
              </Tooltip>
              <Tooltip content={t(revealsManagedAsset ? 'StudioShell.revealAsset' : 'StudioShell.download')} placement="top">
                <IconButton type="button" className="studio-result__action" onClick={onDownload} disabled={!canExport} aria-label={t(revealsManagedAsset ? 'StudioShell.revealGeneration' : 'StudioShell.downloadGeneration')} icon={revealsManagedAsset ? <FolderOpen size={15} aria-hidden="true" /> : <DownloadIcon size={15} aria-hidden="true" />} />
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
          <span>{t('Studio.result.runtimeChip')}</span>
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
      <RuntimeDetails registration={registration} result={result} admission={admission} verboseConsole={verboseConsole} />
    </Surface>
  );
}
