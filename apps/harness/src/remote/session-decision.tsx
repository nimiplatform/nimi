import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { Button } from '@nimiplatform/kit/ui';
import { Check, MessageSquareWarning, ShieldAlert, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { FileDiffProposal, type Replacement } from '../product/tool-decision.js';
import { invokeSessionOperation } from './integration-call.js';

type DiffPreview = {
  kind: 'write' | 'edit' | 'command';
  path?: string;
  content?: string;
  command?: string;
  replacements?: Replacement[];
};

type Review = {
  taskId: number | string;
  revision: string | number;
  tool: string;
  title?: string;
  summary?: string;
  argumentsJson: string;
  diffPreview?: DiffPreview;
};

export function RemoteDecision({
  scope,
  target,
  sessionId,
  mayResolve,
  autoTrigger,
  onResolved,
}: {
  scope: NimiAppScope;
  target: string;
  sessionId: string;
  mayResolve: boolean;
  autoTrigger: boolean;
  onResolved?: () => void;
}) {
  const { t } = useI18n();
  const [review, setReview] = useState<Review>();
  const [openOnPc, setOpenOnPc] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    const current = new AbortController();
    lifetime.current = current;
    setReview(undefined);
    setOpenOnPc(false);
    setNotice('');
    setEditingFeedback(false);
    setFeedback('');
    return () => current.abort();
  }, [scope, target, sessionId]);

  const fetchDecision = useCallback(async (quiet = false) => {
    if (!lifetime.current || pending.current) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    pending.current = true;
    setBusy(true);
    if (!quiet) setNotice('');
    try {
      const value = JSON.parse(await invokeSessionOperation(scope, target, 'session.reviewDecision', { sessionId }, signal));
      if (value?.state === 'none') {
        setReview(undefined);
        setOpenOnPc(false);
        if (!quiet) setNotice('No tool decision is pending.');
      } else if (value?.state === 'open-on-pc') {
        setReview(undefined);
        setOpenOnPc(true);
      } else if (value?.state === 'review'
        && ((Number.isSafeInteger(value.taskId) && value.taskId > 0) || (typeof value.taskId === 'string' && value.taskId.length > 0))
        && typeof value.tool === 'string' && value.tool
        && ((typeof value.revision === 'string' && value.revision.length > 0) || (Number.isSafeInteger(value.revision) && value.revision >= 0))
        && typeof value.argumentsJson === 'string' && new TextEncoder().encode(value.argumentsJson).length <= 32768) {
        setOpenOnPc(false);
        setReview(value as Review);
      } else {
        throw new Error('The PC returned an invalid tool proposal.');
      }
    } catch (cause) {
      if (!signal.aborted && !quiet) setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }, [scope, target, sessionId]);

  // Auto-surface pending approval whenever observeProgress enters waiting state.
  useEffect(() => {
    if (autoTrigger) {
      void fetchDecision(true);
    } else {
      setReview(undefined);
      setOpenOnPc(false);
    }
  }, [autoTrigger, fetchDecision]);

  async function resolve(allow: boolean, note?: string) {
    if (!lifetime.current || pending.current || !review || !mayResolve) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      const input: Record<string, unknown> = {
        sessionId,
        taskId: review.taskId,
        revision: review.revision,
        allow,
      };
      if (!allow && note?.trim()) input.feedback = note.trim();
      setReview(undefined);
      setEditingFeedback(false);
      setFeedback('');
      const value = JSON.parse(await invokeSessionOperation(scope, target, 'session.resolveDecision', input, signal));
      if (value?.outcome === 'recorded') {
        onResolved?.();
      } else if (value?.outcome === 'stale') {
        setNotice('That proposal is no longer pending.');
      } else {
        throw new Error('The PC returned an invalid decision receipt.');
      }
    } catch (cause) {
      if (!signal.aborted) setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  if (!review && !openOnPc && !notice && !autoTrigger) return null;

  return (
    <section className="harness-remote-decision" aria-label={t('decision.badge')}>
      {openOnPc && (
        <article className="harness-decision-card">
          <div className="harness-decision-card__title-group">
            <span className="harness-decision-card__icon" aria-hidden="true"><ShieldAlert size={16} /></span>
            <p>{t('remote.openOnPcDecision')}</p>
          </div>
        </article>
      )}

      {review && (
        <article className="harness-decision-card">
          <header className="harness-decision-card__header">
            <div className="harness-decision-card__title-group">
              <span className="harness-decision-card__icon" aria-hidden="true"><ShieldAlert size={16} /></span>
              <div className="harness-decision-card__meta">
                <div className="harness-decision-card__eyebrow">
                  <span className="harness-pill harness-pill--warning">{t('decision.badge')}</span>
                  <code className="harness-decision-card__tool-name">{review.tool}</code>
                </div>
                <strong>{review.title || t('decision.genericTitle', { name: review.tool })}</strong>
                {review.summary && <p className="harness-decision-card__subtitle">{review.summary}</p>}
              </div>
            </div>
            {mayResolve && !editingFeedback && (
              <div className="harness-decision-card__actions">
                <Button size="sm" tone="ghost" disabled={busy} leadingIcon={<MessageSquareWarning size={14} />} onClick={() => setEditingFeedback(true)}>
                  {t('decision.requestChanges')}
                </Button>
                <Button size="sm" tone="secondary" disabled={busy} leadingIcon={<X size={14} />} onClick={() => void resolve(false)}>
                  {t('decision.decline')}
                </Button>
                <Button size="sm" disabled={busy} leadingIcon={<Check size={14} />} onClick={() => void resolve(true)}>
                  {t('remote.allowOnPc')}
                </Button>
              </div>
            )}
          </header>

          {editingFeedback && (
            <form
              className="harness-decision-feedback"
              onSubmit={event => {
                event.preventDefault();
                if (!busy && feedback.trim()) void resolve(false, feedback.trim());
              }}
            >
              <label className="harness-decision-feedback__label">
                <span>{t('decision.feedbackPrompt')}</span>
                <textarea
                  autoFocus
                  rows={2}
                  maxLength={4000}
                  value={feedback}
                  placeholder={t('decision.feedbackPlaceholder')}
                  onChange={e => setFeedback(e.target.value)}
                />
              </label>
              <div className="harness-decision-card__actions">
                <Button type="button" size="sm" tone="ghost" disabled={busy} onClick={() => setEditingFeedback(false)}>
                  {t('decision.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={busy || !feedback.trim()}>
                  {t('decision.sendFeedback')}
                </Button>
              </div>
            </form>
          )}

          {review.diffPreview ? (
            <FileDiffProposal
              kind={review.diffPreview.kind}
              path={review.diffPreview.path}
              content={review.diffPreview.content}
              replacements={review.diffPreview.replacements}
              command={review.diffPreview.command}
            />
          ) : (
            <pre className="harness-code-block">{review.argumentsJson}</pre>
          )}

          {review.diffPreview && (
            <details className="harness-decision-raw">
              <summary>{t('decision.fullArgs')}</summary>
              <pre className="harness-code-block">{review.argumentsJson}</pre>
            </details>
          )}
        </article>
      )}

      {!review && !openOnPc && autoTrigger && (
        <div className="harness-remote-decision__manual">
          <Button size="sm" tone="secondary" disabled={busy} onClick={() => void fetchDecision(false)}>
            {t('remote.checkDecision')}
          </Button>
        </div>
      )}

      {notice && <p className="harness-muted harness-muted--sm" role="status">{notice}</p>}
    </section>
  );
}
