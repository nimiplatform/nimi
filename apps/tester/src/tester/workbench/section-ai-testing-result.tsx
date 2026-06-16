import type { ReactNode } from 'react';
import { AlertTriangle, Clock, FileText, MessageSquare, SlidersHorizontal } from 'lucide-react';
import type { TesterCapability } from '../tester-capabilities.js';
import { formatTesterRunTimestamp, getTesterRunConfigParamRows, getTesterRunPromptControlFacts, getTesterRunResultTags, getTesterRunStatusLabel, type TesterRunConfigParamRow, type TesterRunHistoryRecord, type TesterRunHistoryResultSnapshot, type TesterRunPromptControlFact } from '../tester-history.js';
import { StudioResult, statusForCapability } from './section-ai-testing-surface.js';
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
        <span>{paramSummary}</span>
      </div>
      {paramGroups.map((group) => (
        <div key={group.group} className="studio-history-settings__group">
          <strong>{group.group}</strong>
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
      <TextStudioModelSettings record={record} />
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

export function TextStudioResultState({
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
                streamingText={streamingText}
                verboseConsole={verboseConsole}
                onCopy={onCopy}
                onDownload={onDownload}
                onRegenerate={onRegenerate}
              />
              {activeRun.record ? <TextStudioModelSettings record={activeRun.record} /> : null}
            </>
          ) : activeRun.record ? (
            <TextStudioHistoryRecordResult record={activeRun.record} />
          ) : null}
        </article>
      </div>
      <div className="studio-thread__composer">{composer}</div>
    </section>
  );
}
