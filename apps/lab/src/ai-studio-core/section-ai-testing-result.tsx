import { useState, type ReactNode } from 'react';
import { IconButton, nimiToast, StatusBadge, Tooltip } from '@nimiplatform/kit/ui';
import { AlertTriangle, ChevronRight, Copy as CopyIcon, Download as DownloadIcon, FileText, MessageSquare, RefreshCw, SlidersHorizontal, SquarePen } from 'lucide-react';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRegistration } from './module-registration.js';
import { formatStudioRunTimestamp, getStudioRunConfigParamRows, getStudioRunIntentLabel, getStudioRunPromptControlFacts, getStudioRunResultTags, getStudioRunStatusTone, type StudioRunConfigParamRow, type StudioRunHistoryRecord, type StudioRunHistoryResultSnapshot, type StudioRunPromptControlFact } from './history.js';
import { studioNonSuccessReasonTitle, studioNonSuccessReasonUserAction, studioNonSuccessReasonUserMessage } from './non-success-presentation.js';
import { ArtifactMediaResult, RuntimeDiagnosticsActions, StudioResult, TextStudioOutputBody, downloadTextFile, statusForCapability } from './section-ai-testing-surface.js';
import type { TextStudioActiveRun } from './section-ai-testing-run.js';

function TextStudioPromptControlFacts({ facts }: { facts: readonly StudioRunPromptControlFact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="studio-prompt-settings__facts">
      {facts.map((fact) => (
        <div key={`${fact.label}:${fact.value}`}>
          <dt>{fact.label}</dt>
          <dd>{fact.code ? <code>{fact.value}</code> : fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextStudioPromptSettings({ activeRun }: { activeRun: TextStudioActiveRun }) {
  const { translate: t } = useAIStudioHost();
  const runConfig = activeRun.record?.runConfig;
  const facts = runConfig ? getStudioRunPromptControlFacts(runConfig) : [];
  const context = (runConfig?.promptControls.context ?? activeRun.context).trim();
  if (facts.length === 0 && !context) return null;
  return (
    <div className="studio-prompt-settings">
      <TextStudioPromptControlFacts facts={facts} />
      {context ? (
        <div className="studio-prompt-settings__context">
          <strong>{t('StudioShell.contextLabel')}</strong>
          <p>{context}</p>
        </div>
      ) : null}
    </div>
  );
}

function groupParamRows(rows: readonly StudioRunConfigParamRow[]): Array<{ group: string; rows: StudioRunConfigParamRow[] }> {
  const groups: Array<{ group: string; rows: StudioRunConfigParamRow[] }> = [];
  for (const row of rows) {
    const current = groups.find((entry) => entry.group === row.group);
    if (current) {
      current.rows.push(row);
    } else {
      groups.push({ group: row.group, rows: [row] });
    }
  }
  return groups;
}

function TextStudioRequestSettings({ record }: { record: StudioRunHistoryRecord }) {
  const { translate: t } = useAIStudioHost();
  const runConfig = record.runConfig;
  if (!runConfig) {
    return null;
  }

  const paramRows = getStudioRunConfigParamRows(runConfig);
  const fallbackSummary = runConfig.target.paramsSummary.join(' / ');
  if (paramRows.length === 0 && !fallbackSummary) {
    return null;
  }
  const paramGroups = groupParamRows(paramRows);

  return (
    <section className="studio-history-settings" aria-label={t('StudioShell.requestSettings')}>
      <div className="studio-history-settings__head">
        <SlidersHorizontal size={14} aria-hidden="true" />
        <strong>{t('StudioShell.requestSettings')}</strong>
      </div>
      {paramGroups.map((group) => (
        <div key={group.group} className="studio-history-settings__group">
          <strong className="studio-history-settings__group-title">{group.group}</strong>
          <dl className="studio-history-settings__params">
            {group.rows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.code ? <code>{row.value}</code> : row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}

function hasTextStudioRequestSettings(record: StudioRunHistoryRecord): boolean {
  const runConfig = record.runConfig;
  if (!runConfig) return false;
  return getStudioRunConfigParamRows(runConfig).length > 0 || Boolean(runConfig.target.paramsSummary.join(' / '));
}

function historyRecordPlainText(record: StudioRunHistoryRecord): string {
  const snapshot = record.result;
  if (!snapshot) return record.message;
  if (!snapshot.ok) return snapshot.message;
  if (snapshot.kind === 'text' || snapshot.kind === 'transcript') return snapshot.body;
  return snapshot.summary;
}

function historyNonSuccessDiagnosticsText(snapshot: Extract<StudioRunHistoryResultSnapshot, { ok: false }>): string {
  return [
    `Reason: ${snapshot.reason}`,
    snapshot.missingSurface ? `Missing surface: ${snapshot.missingSurface}` : '',
    '',
    'Message:',
    snapshot.message,
    '',
    'Action:',
    snapshot.actionHint,
    snapshot.diagnostics ? 'Technical diagnostics:' : '',
    snapshot.diagnostics?.reasonCode ? `Reason code: ${snapshot.diagnostics.reasonCode}` : '',
    snapshot.diagnostics?.actionHint ? `Owner action: ${snapshot.diagnostics.actionHint}` : '',
    snapshot.diagnostics?.traceId ? `Trace: ${snapshot.diagnostics.traceId}` : '',
    snapshot.diagnostics?.retryable !== undefined ? `Retryable: ${String(snapshot.diagnostics.retryable)}` : '',
    snapshot.diagnostics?.source ? `Source: ${snapshot.diagnostics.source}` : '',
  ].filter(Boolean).join('\n');
}

function historyResultToneClass(record: StudioRunHistoryRecord): string {
  const tone = getStudioRunStatusTone(record.status);
  return tone === 'danger' ? 'warning' : tone;
}

function TextStudioHistoryRecordResult({
  record,
  onRegenerate,
  onUseAsDraft,
}: {
  record: StudioRunHistoryRecord;
  onRegenerate: () => void;
  onUseAsDraft: (record: StudioRunHistoryRecord) => void;
}) {
  const rendererHost = useAIStudioHost();
  const { translate: t } = useAIStudioHost();
  const snapshot = record.result;
  const blocked = snapshot && !snapshot.ok ? snapshot : null;
  const tags = blocked ? [studioNonSuccessReasonTitle(blocked.reason, t)] : getStudioRunResultTags(record);
  const intentLabel = getStudioRunIntentLabel(record);
  const toneClass = historyResultToneClass(record);
  const exportText = historyRecordPlainText(record);
  const canExport = !blocked && Boolean(exportText.trim());
  const hasRequestSettings = hasTextStudioRequestSettings(record);
  const [requestSettingsOpen, setRequestSettingsOpen] = useState(false);
  function handleCopy() {
    if (!exportText.trim()) return;
    void rendererHost.app.commands.copyText(exportText)
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
    const stamp = record.createdAt.replace(/[:.]/g, '-');
    if (!exportText.trim()) return;
    void downloadTextFile(rendererHost.app.commands, `${record.capabilityId}-${stamp}.txt`, exportText);
  }
  let body: ReactNode;
  if (!snapshot) {
    body = (
      <>
        <p>{record.message}</p>
        <p className="studio-result__hint">
          {t('StudioShell.legacyRecordHint')}
        </p>
      </>
    );
  } else if (!snapshot.ok) {
    const diagnosticsText = historyNonSuccessDiagnosticsText(snapshot);
    body = (
      <div className="studio-result__blocked">
        <div className="studio-result__blocked-line">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{studioNonSuccessReasonTitle(snapshot.reason, t)}</span>
        </div>
        <p>{studioNonSuccessReasonUserMessage(snapshot.reason, t)}</p>
        <p className="studio-result__hint">{studioNonSuccessReasonUserAction(snapshot.reason, t)}</p>
        <details className="studio-diag">
          <summary>{t('StudioShell.runtimeDetails')}</summary>
          <RuntimeDiagnosticsActions text={diagnosticsText} filenameBase={record.capabilityId} />
          <pre className="studio-diag__json">{diagnosticsText}</pre>
        </details>
      </div>
    );
  } else {
    body = <TextStudioHistorySnapshotBody snapshot={snapshot} />;
  }
  return (
    <div className="studio-history-result" role="status">
      <div className="studio-history-result__head">
        <div className="studio-history-result__line">
          <StatusBadge tone={getStudioRunStatusTone(record.status)} shape="dot">
            {blocked ? studioNonSuccessReasonTitle(blocked.reason, t) : rendererHost.app.projection.runStatusLabel(record.status)}
          </StatusBadge>
          <span className="studio-history-result__title-stack">
            <time dateTime={record.createdAt}>{t('StudioShell.runLabel')} / {formatStudioRunTimestamp(record.createdAt, new Date(rendererHost.clock.now()))}</time>
          </span>
        </div>
        <div className="studio-result__actions studio-history-result__actions">
          {!blocked ? (
            <>
              <Tooltip content={t('Common.copy')} placement="top">
                <IconButton type="button" className="studio-result__action" onClick={handleCopy} disabled={!canExport} aria-label={t('StudioShell.copyGeneration')} icon={<CopyIcon size={16} aria-hidden="true" />} />
              </Tooltip>
              <Tooltip content={t('StudioShell.download')} placement="top">
                <IconButton type="button" className="studio-result__action" onClick={handleDownload} disabled={!canExport} aria-label={t('StudioShell.downloadGeneration')} icon={<DownloadIcon size={16} aria-hidden="true" />} />
              </Tooltip>
            </>
          ) : null}
          <Tooltip content={t('StudioShell.useAsDraft')} placement="top">
            <IconButton type="button" className="studio-result__action" onClick={() => onUseAsDraft(record)} aria-label={t('StudioShell.useAsDraft')} icon={<SquarePen size={16} aria-hidden="true" />} />
          </Tooltip>
          <Tooltip content={t('StudioShell.regenerate')} placement="top">
            <IconButton type="button" className="studio-result__action" onClick={onRegenerate} aria-label={t('StudioShell.regenerate')} icon={<RefreshCw size={16} aria-hidden="true" />} />
          </Tooltip>
        </div>
      </div>
      <div className="studio-history-result__meta">
        <div className="studio-history-result__tags">
          {tags.map((tag, index) => <span key={tag} className={index === 0 ? `studio-history-result__tag--${toneClass}` : undefined}>{tag}</span>)}
        </div>
        <div className="studio-history-result__intent">
          <span>{t('StudioShell.intentLabel')}</span>
          <div className={hasRequestSettings ? 'studio-intent-pill__box' : 'studio-intent-pill__box studio-intent-pill__box--static'}>
            <Tooltip content={intentLabel} placement="top" className="min-w-0">
              <strong>{intentLabel}</strong>
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
      {requestSettingsOpen && hasRequestSettings ? <TextStudioRequestSettings record={record} /> : null}
      {body}
    </div>
  );
}

function TextStudioHistorySnapshotBody({ snapshot }: { snapshot: Extract<StudioRunHistoryResultSnapshot, { ok: true }> }) {
  const { translate: t } = useAIStudioHost();
  if (snapshot.kind === 'text' || snapshot.kind === 'transcript') {
    return <TextStudioOutputBody text={snapshot.body} />;
  }
  if (snapshot.kind === 'embedding') {
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">{t('StudioShell.embeddingSuccess')}</p>
      </div>
    );
  }
  if (snapshot.kind === 'artifacts') {
    const artifacts = snapshot.artifacts ?? (snapshot.firstArtifact ? [snapshot.firstArtifact] : []);
    return (
      <div className="studio-result__rich">
        {artifacts.map((artifact, index) => (
          <ArtifactMediaResult
            key={artifact.relativePath}
            artifact={artifact}
            fallbackLabel={`${snapshot.jobId}:${index + 1}`}
          />
        ))}
      </div>
    );
  }
  if (snapshot.kind === 'voice-asset') {
    return (
      <div className="studio-result__rich">
        <p className="studio-result__plain">{t('StudioShell.voiceAssetSuccess')}</p>
      </div>
    );
  }
  return (
    <ul className="studio-voice-list">
      {snapshot.sample.map((voice) => (
        <li key={voice.voiceId}>
          <strong>{voice.voiceId}</strong>
          <span>{voice.creationSource} / {voice.status}</span>
        </li>
      ))}
      {snapshot.sample.length === 0 ? <li><span>{t('StudioShell.noVoices')}</span></li> : null}
    </ul>
  );
}

function TextStudioRunError({ message }: { message: string }) {
  const { translate: t } = useAIStudioHost();
  return (
    <div className="studio-result__blocked" role="alert">
      <div className="studio-result__blocked-line">
        <AlertTriangle size={15} aria-hidden="true" />
        <span>{t('StudioShell.generationFailed')}</span>
      </div>
      <p>{t('StudioShell.runStoppedEarly')}</p>
      <p className="studio-result__hint">{t('StudioShell.noResultProduced')}</p>
      <details className="studio-diag">
        <summary>{t('StudioShell.runtimeDetails')}</summary>
        <RuntimeDiagnosticsActions text={message} filenameBase="runtime-call" />
        <pre className="studio-diag__json">{message}</pre>
      </details>
    </div>
  );
}

export function TextStudioResultState({
  registration,
  activeRun,
  admission,
  intentLabel,
  running,
  cancelRequested,
  streamingText,
  verboseConsole,
  composer,
  onCopy,
  onDownload,
  onRegenerate,
  onCancel,
  onUseAsDraft,
}: {
  registration: StudioCapabilityRegistration;
  activeRun: TextStudioActiveRun;
  admission: ReturnType<typeof statusForCapability>;
  intentLabel: string;
  running: boolean;
  cancelRequested: boolean;
  streamingText: string | null;
  verboseConsole: boolean;
  composer: ReactNode;
  onCopy: () => void;
  onDownload: () => void;
  onRegenerate: () => void;
  onCancel?: () => void;
  onUseAsDraft: (record: StudioRunHistoryRecord) => void;
}) {
  const { translate: t } = useAIStudioHost();
  const capability = registration.descriptor;
  return (
    <section className="studio-thread" aria-label={t('StudioShell.resultAriaLabel', { capability: t(capability.labelKey) })}>
      <div className="studio-thread__scroll">
        <article className="studio-turn studio-turn--user">
          <div className="studio-turn__label">
            <MessageSquare size={14} aria-hidden="true" />
            <span>{t('StudioShell.promptLabel')}</span>
          </div>
          <p>{activeRun.prompt}</p>
          <TextStudioPromptSettings activeRun={activeRun} />
        </article>
        <article className="studio-turn studio-turn--assistant">
          <div className="studio-turn__label">
            <FileText size={14} aria-hidden="true" />
            <span>{t('StudioShell.generationLabel')}</span>
          </div>
          {activeRun.error ? (
            <TextStudioRunError message={activeRun.error} />
          ) : activeRun.result || running ? (
            <>
              <StudioResult
                result={activeRun.result}
                running={running}
                cancelRequested={cancelRequested}
                registration={registration}
                admission={admission}
                createdAt={activeRun.createdAt}
                intentLabel={intentLabel}
                requestSettings={activeRun.record && hasTextStudioRequestSettings(activeRun.record) ? <TextStudioRequestSettings record={activeRun.record} /> : null}
                streamingText={streamingText}
                verboseConsole={verboseConsole}
                onCopy={onCopy}
                onDownload={onDownload}
                onRegenerate={onRegenerate}
                onCancel={onCancel}
              />
            </>
          ) : activeRun.record ? (
            <TextStudioHistoryRecordResult record={activeRun.record} onRegenerate={onRegenerate} onUseAsDraft={onUseAsDraft} />
          ) : null}
        </article>
      </div>
      <div className="studio-thread__composer">{composer}</div>
    </section>
  );
}
