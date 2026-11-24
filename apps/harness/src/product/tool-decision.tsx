import { useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { Check, CheckCheck, FileEdit, FilePlus, Globe, MessageSquareWarning, Plug, ShieldAlert, Terminal, Volume2, Share2, X } from 'lucide-react';
import { useI18n } from '../i18n.js';

export type Replacement = { oldText: string; newText: string };

export function isReplacement(value: unknown): value is Replacement {
  return typeof value === 'object' && value !== null && 'oldText' in value && typeof value.oldText === 'string'
    && 'newText' in value && typeof value.newText === 'string';
}

export function UnifiedDiffLines({ content, kind }: { content: string; kind: 'add' | 'remove' }) {
  const lines = content.split(/\r?\n/);
  const prefix = kind === 'add' ? '+' : '-';
  return (
    <div className={`harness-diff-block harness-diff-block--${kind}`}>
      {lines.map((line, idx) => (
        <div key={idx} className="harness-diff-line">
          <span className="harness-diff-gutter" aria-hidden="true">{prefix}</span>
          <span className="harness-diff-code">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

export function FileDiffProposal({
  kind,
  path,
  content,
  replacements,
  command,
}: {
  kind: 'write' | 'edit' | 'command';
  path?: string;
  content?: string;
  replacements?: Replacement[];
  command?: string;
}) {
  const { t } = useI18n();
  if (kind === 'command' && command !== undefined) {
    return (
      <div className="harness-terminal-box" role="region" aria-label={t('decision.shellTitle')}>
        <div className="harness-terminal-box__bar">
          <Terminal size={13} aria-hidden="true" />
          <span>shell</span>
        </div>
        <pre className="harness-terminal-box__code"><code>{command}</code></pre>
      </div>
    );
  }
  if (kind === 'write') {
    return (
      <div className="harness-diff-viewer" role="region" aria-label={t('decision.writeTitle')}>
        {path && <div className="harness-diff-viewer__header"><code>{path}</code></div>}
        {content === '' ? (
          <p className="harness-diff-viewer__empty">{t('decision.emptyFile')}</p>
        ) : (
          <div className="harness-diff-viewer__body">
            <UnifiedDiffLines content={content ?? ''} kind="add" />
          </div>
        )}
      </div>
    );
  }
  if (kind === 'edit' && replacements && replacements.length > 0) {
    return (
      <div className="harness-diff-viewer" role="region" aria-label={t('decision.editTitle')}>
        <div className="harness-diff-viewer__header">
          {path && <code>{path}</code>}
          <span className="harness-diff-viewer__count">{t('decision.replacements', { count: replacements.length })}</span>
        </div>
        <div className="harness-diff-viewer__body">
          {replacements.map((edit, idx) => (
            <div key={idx} className="harness-diff-hunk">
              {replacements.length > 1 && <div className="harness-diff-hunk__label">#{idx + 1}</div>}
              {edit.oldText !== '' && <UnifiedDiffLines content={edit.oldText} kind="remove" />}
              {edit.newText !== '' && <UnifiedDiffLines content={edit.newText} kind="add" />}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

export function ToolDecision({
  name,
  args,
  allowSessionPermitted = true,
  isControlPlane = false,
  isFreeShell = false,
  recentAiEditedWarning,
  effect,
  targetDisplayName,
  operationDisplayName,
  decide,
}: {
  name: string;
  args: Record<string, unknown>;
  allowSessionPermitted?: boolean;
  isControlPlane?: boolean;
  isFreeShell?: boolean;
  recentAiEditedWarning?: string[];
  effect?: 'read' | 'write';
  targetDisplayName?: string;
  operationDisplayName?: string;
  decide(allow: boolean, feedback?: string, allowForSession?: boolean): Promise<boolean>;
}) {
  const { t } = useI18n();
  const [reviewing, setReviewing] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function resolve(allow: boolean, feedback?: string, allowForSession?: boolean) {
    setSubmitting(true);
    if (!await decide(allow, feedback, allowForSession)) setSubmitting(false);
  }

  const path = typeof args.path === 'string' ? args.path : undefined;
  const isWrite = name === 'write' && path && typeof args.content === 'string';
  const isEdit = name === 'edit' && path && Array.isArray(args.edits) && args.edits.every(isReplacement);
  const isShell = (name === 'bash' || name === 'powershell') && typeof args.command === 'string';
  const isWebFetch = name === 'web_fetch' && typeof args.url === 'string';
  const isIntegration = name === 'invoke_nimi_integration' || name === 'read_nimi_integration';
  const isRecording = name === 'transcribe_audio' && Boolean(path);
  const sharedFile = name === 'share_result_file' && typeof args.filename === 'string' ? args.filename : undefined;

  const title = isWrite
    ? t('decision.writeTitle')
    : isEdit
      ? t('decision.editTitle')
      : isShell
        ? t('decision.shellTitle')
        : isWebFetch
          ? t('decision.webFetchTitle')
          : isIntegration
            ? t('decision.integrationTitle')
            : isRecording
              ? t('decision.transcribeTitle')
              : sharedFile
                ? t('decision.shareTitle')
                : t('decision.genericTitle', { name });

  const Icon = isWrite ? FilePlus
    : isEdit ? FileEdit
    : isShell ? Terminal
    : isWebFetch ? Globe
    : isIntegration ? Plug
    : isRecording ? Volume2
    : sharedFile ? Share2
    : ShieldAlert;

  const integrationEffect: 'read' | 'write' | undefined = isIntegration
    ? (effect ?? (name === 'read_nimi_integration' ? 'read' : undefined))
    : undefined;

  return (
    <article className="harness-decision-card" aria-label={title}>
      <header className="harness-decision-card__header">
        <div className="harness-decision-card__title-group">
          <span className="harness-decision-card__icon" aria-hidden="true"><Icon size={16} /></span>
          <div className="harness-decision-card__meta">
            <div className="harness-decision-card__eyebrow">
              <span className="harness-pill harness-pill--warning">{t('decision.badge')}</span>
              {integrationEffect && (
                <span className={`harness-pill harness-pill--${integrationEffect === 'write' ? 'danger' : 'info'}`}>
                  {integrationEffect === 'write' ? t('decision.writeBadge') : t('decision.readBadge')}
                </span>
              )}
              <code className="harness-decision-card__tool-name">{name}</code>
            </div>
            <strong>{title}</strong>
            {isIntegration && (
              <p className="harness-decision-card__subtitle">
                {targetDisplayName ? `${targetDisplayName} · ` : ''}
                <code>{operationDisplayName || String(args.operation ?? '')}</code>
              </p>
            )}
            {isWebFetch && <p className="harness-decision-card__subtitle"><code>{String(args.url)}</code></p>}
            {isRecording && <p className="harness-decision-card__subtitle"><code>{path}</code></p>}
            {sharedFile && <p className="harness-decision-card__subtitle"><code>{sharedFile}</code></p>}
          </div>
        </div>
        {!editingFeedback && (
          <div className="harness-decision-card__actions">
            <Button size="sm" tone="ghost" disabled={submitting} onClick={() => setEditingFeedback(true)} leadingIcon={<MessageSquareWarning size={14} />}>
              {t('decision.requestChanges')}
            </Button>
            <Button size="sm" tone="secondary" disabled={submitting} onClick={() => void resolve(false)} leadingIcon={<X size={14} />}>
              {t('decision.decline')}
            </Button>
            {allowSessionPermitted && !isFreeShell && !isControlPlane && (
              <Button size="sm" tone="secondary" disabled={submitting} onClick={() => void resolve(true, undefined, true)} leadingIcon={<CheckCheck size={14} />}>
                {t('decision.allowSession')}
              </Button>
            )}
            <Button size="sm" disabled={submitting} onClick={() => void resolve(true)} leadingIcon={<Check size={14} />}>
              {t('decision.allowOnce')}
            </Button>
          </div>
        )}
      </header>

      {isControlPlane && (
        <p className="harness-decision-card__hint" role="note">
          控制面文件保护：修改构建/脚本/Git 配置仅允许单次授权（allow_once）。
        </p>
      )}
      {isFreeShell && (
        <div className="harness-decision-card__hint" role="note">
          <p>安全提示：获批命令在当前操作系统用户权限下运行（已启用最小环境变量白名单与 .env 凭据输出脱敏），且仅支持单次授权。</p>
          {recentAiEditedWarning && recentAiEditedWarning.length > 0 && (
            <p>
              <strong>本会话近期由 AI 改动的文件：</strong>
              <code>{recentAiEditedWarning.slice(0, 6).join(', ')}</code>
            </p>
          )}
        </div>
      )}

      {editingFeedback && (
        <form
          className="harness-decision-feedback"
          onSubmit={event => {
            event.preventDefault();
            if (!submitting && note.trim()) void resolve(false, note.trim());
          }}
        >
          <label className="harness-decision-feedback__label">
            <span>{t('decision.feedbackPrompt')}</span>
            <textarea
              autoFocus
              rows={3}
              value={note}
              maxLength={4000}
              placeholder={t('decision.feedbackPlaceholder')}
              onChange={event => setNote(event.currentTarget.value)}
            />
          </label>
          <div className="harness-decision-card__actions">
            <Button type="button" size="sm" tone="ghost" disabled={submitting} onClick={() => setEditingFeedback(false)}>
              {t('decision.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !note.trim()}>
              {t('decision.sendFeedback')}
            </Button>
          </div>
        </form>
      )}

      {isWrite && (
        <>
          <p className="harness-decision-card__hint">{t('decision.writeWarning')}</p>
          <FileDiffProposal kind="write" path={path} content={String(args.content)} />
        </>
      )}
      {isEdit && (
        <FileDiffProposal kind="edit" path={path} replacements={args.edits as Replacement[]} />
      )}
      {isShell && (
        <FileDiffProposal kind="command" command={String(args.command)} />
      )}
      {isIntegration && args.input !== undefined && (
        <pre className="harness-code-block">{JSON.stringify(args.input, null, 2)}</pre>
      )}

      {(isWrite || isEdit || isShell || isIntegration) ? (
        <details className="harness-decision-raw" onToggle={event => setReviewing(event.currentTarget.open)}>
          <summary>{t('decision.fullArgs')}</summary>
          {reviewing && <pre className="harness-code-block">{JSON.stringify(args, null, 2)}</pre>}
        </details>
      ) : (!isWebFetch && !isRecording && !sharedFile && (
        <pre className="harness-code-block">{JSON.stringify(args, null, 2)}</pre>
      ))}
    </article>
  );
}
