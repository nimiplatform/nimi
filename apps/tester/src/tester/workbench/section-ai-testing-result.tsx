import type { ReactNode } from 'react';
import { Tooltip } from '@nimiplatform/kit/ui';
import { AlertTriangle, Copy as CopyIcon, Download as DownloadIcon, FileText, MessageSquare, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { TesterCapability } from '../tester-capabilities.js';
import { formatTesterRunTimestamp, getTesterRunConfigParamRows, getTesterRunModelLabel, getTesterRunPromptControlFacts, getTesterRunResultTags, getTesterRunStatusLabel, getTesterRunStatusTone, type TesterRunConfigParamRow, type TesterRunHistoryRecord, type TesterRunHistoryResultSnapshot, type TesterRunPromptControlFact } from '../tester-history.js';
import { unavailableReasonUserAction, unavailableReasonUserMessage } from '../tester-unavailable.js';
import { StudioResult, TextStudioOutputBody, artifactExtension, downloadArtifactUrl, downloadTextFile, statusForCapability } from './section-ai-testing-surface.js';
import type { TextStudioActiveRun } from './section-ai-testing-run.js';

function TextStudioPromptControlFacts({ facts }: { facts: readonly TesterRunPromptControlFact[] }) {
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
  const runConfig = activeRun.record?.runConfig;
  const facts = runConfig ? getTesterRunPromptControlFacts(runConfig) : [];
  const context = (runConfig?.promptControls.context ?? activeRun.context).trim();
  if (facts.length === 0 && !context) return null;
  return (
    <div className="studio-prompt-settings">
      <TextStudioPromptControlFacts facts={facts} />
      {context ? (
        <div className="studio-prompt-settings__context">
          <strong>Context</strong>
          <p>{context}</p>
        </div>
      ) : null}
    </div>
  );
}

function groupParamRows(rows: readonly TesterRunConfigParamRow[]): Array<{ group: string; rows: TesterRunConfigParamRow[] }> {
  const groups: Array<{ group: string; rows: TesterRunConfigParamRow[] }> = [];
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

function summarizeParamRows(rows: readonly TesterRunConfigParamRow[]): string {
  return rows.slice(0, 5).map((row) => `${row.label} ${row.value}`).join(' / ');
}

function TextStudioModelSettings({ record }: { record: TesterRunHistoryRecord }) {
  const runConfig = record.runConfig;
  if (!runConfig) {
    return null;
  }

  const paramRows = getTesterRunConfigParamRows(runConfig);
  const fallbackSummary = runConfig.target.paramsSummary.join(' / ');
  if (paramRows.length === 0 && !fallbackSummary) {
    return null;
  }
  const paramGroups = groupParamRows(paramRows);
  const paramSummary = paramRows.length > 0
    ? summarizeParamRows(paramRows)
    : fallbackSummary;

  return (
    <section className="studio-history-settings" aria-label="Model settings">
      <div className="studio-history-settings__head">
        <SlidersHorizontal size={14} aria-hidden="true" />
        <strong>Model settings</strong>
        <span className="studio-history-settings__summary">{paramSummary}</span>
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

function historyRecordPlainText(record: TesterRunHistoryRecord): string {
  const snapshot = record.result;
  if (!snapshot) return record.message;
  if (!snapshot.ok) return snapshot.message;
  if (snapshot.kind === 'text' || snapshot.kind === 'transcript') return snapshot.body;
  return snapshot.summary;
}

function historyRecordArtifact(record: TesterRunHistoryRecord): { url: string; mimeType?: string } | null {
  const snapshot = record.result;
  if (!snapshot?.ok || snapshot.kind !== 'artifacts' || !snapshot.firstArtifact?.url) return null;
  return {
    url: snapshot.firstArtifact.url,
    mimeType: snapshot.firstArtifact.mimeType,
  };
}

function historyResultToneClass(record: TesterRunHistoryRecord): string {
  const tone = getTesterRunStatusTone(record.status);
  return tone === 'danger' ? 'warning' : tone;
}

function TextStudioHistoryRecordResult({
  record,
  onRegenerate,
}: {
  record: TesterRunHistoryRecord;
  onRegenerate: () => void;
}) {
  const snapshot = record.result;
  const tags = getTesterRunResultTags(record);
  const modelLabel = getTesterRunModelLabel(record);
  const toneClass = historyResultToneClass(record);
  const exportText = historyRecordPlainText(record);
  const canExport = Boolean(exportText.trim() || historyRecordArtifact(record));
  function handleCopy() {
    if (!exportText.trim()) return;
    try {
      void navigator.clipboard?.writeText(exportText);
    } catch {
      // Clipboard remains best-effort; download is the durable path.
    }
  }
  function handleDownload() {
    const artifact = historyRecordArtifact(record);
    const stamp = record.createdAt.replace(/[:.]/g, '-');
    if (artifact) {
      void downloadArtifactUrl(
        `${record.capabilityId}-${stamp}.${artifactExtension(artifact.mimeType)}`,
        artifact.url,
      );
      return;
    }
    if (!exportText.trim()) return;
    void downloadTextFile(`${record.capabilityId}-${stamp}.txt`, exportText);
  }
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
          <span>Generation could not be completed</span>
        </div>
        <p>{unavailableReasonUserMessage(snapshot.reason)}</p>
        <p className="studio-result__hint">{unavailableReasonUserAction(snapshot.reason)}</p>
        <details className="studio-diag">
          <summary>Runtime details</summary>
          <pre className="studio-diag__json">
            {[
              `Reason: ${snapshot.reason}`,
              snapshot.missingSurface ? `Missing surface: ${snapshot.missingSurface}` : '',
              '',
              'Message:',
              snapshot.message,
              '',
              'Action:',
              snapshot.actionHint,
            ].filter(Boolean).join('\n')}
          </pre>
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
          <span className={`studio-history-result__status-mark studio-history-result__status-mark--${toneClass}`} aria-hidden="true" />
          <span className="studio-history-result__title-stack">
            <strong>{getTesterRunStatusLabel(record.status)}</strong>
            <time dateTime={record.createdAt}>Run / {formatTesterRunTimestamp(record.createdAt)}</time>
          </span>
        </div>
        <div className="studio-result__actions studio-history-result__actions">
          <Tooltip content="Copy" placement="top">
            <button type="button" className="studio-result__action" onClick={handleCopy} disabled={!canExport} aria-label="Copy generation">
              <CopyIcon size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="Download" placement="top">
            <button type="button" className="studio-result__action" onClick={handleDownload} disabled={!canExport} aria-label="Download generation">
              <DownloadIcon size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="Regenerate" placement="top">
            <button type="button" className="studio-result__action" onClick={onRegenerate} aria-label="Regenerate">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="studio-history-result__meta">
        <div className="studio-history-result__tags">
          {tags.map((tag, index) => <span key={tag} className={index === 0 ? `studio-history-result__tag--${toneClass}` : undefined}>{tag}</span>)}
        </div>
        <div className="studio-history-result__model">
          <span>Model</span>
          <Tooltip content={modelLabel} placement="top" className="min-w-0">
            <strong>{modelLabel}</strong>
          </Tooltip>
        </div>
      </div>
      <TextStudioModelSettings record={record} />
      {body}
    </div>
  );
}

function TextStudioHistorySnapshotBody({ snapshot }: { snapshot: Extract<TesterRunHistoryResultSnapshot, { ok: true }> }) {
  if (snapshot.kind === 'text' || snapshot.kind === 'transcript') {
    return <TextStudioOutputBody text={snapshot.body} />;
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
        <span>Generation could not be completed</span>
      </div>
      <p>The run stopped before a typed Runtime result was returned.</p>
      <p className="studio-result__hint">No local fallback result was produced. Retry after Runtime is ready.</p>
      <details className="studio-diag">
        <summary>Runtime details</summary>
        <pre className="studio-diag__json">{message}</pre>
      </details>
    </div>
  );
}

export function TextStudioResultState({
  capability,
  activeRun,
  admission,
  modelLabel,
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
  modelLabel: string;
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
          <p>{activeRun.prompt}</p>
          <TextStudioPromptSettings activeRun={activeRun} />
        </article>
        <article className="studio-turn studio-turn--assistant">
          <div className="studio-turn__label">
            <FileText size={14} aria-hidden="true" />
            <span>Generation</span>
          </div>
          {activeRun.error ? (
            <TextStudioRunError message={activeRun.error} />
          ) : activeRun.result || running ? (
            <>
              <StudioResult
                result={activeRun.result}
                running={running}
                capability={capability}
                admission={admission}
                createdAt={activeRun.createdAt}
                modelLabel={modelLabel}
                streamingText={streamingText}
                verboseConsole={verboseConsole}
                onCopy={onCopy}
                onDownload={onDownload}
                onRegenerate={onRegenerate}
              />
              {activeRun.record ? <TextStudioModelSettings record={activeRun.record} /> : null}
            </>
          ) : activeRun.record ? (
            <TextStudioHistoryRecordResult record={activeRun.record} onRegenerate={onRegenerate} />
          ) : null}
        </article>
      </div>
      <div className="studio-thread__composer">{composer}</div>
    </section>
  );
}
