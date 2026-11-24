import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { ChatMarkdownRenderer } from '@nimiplatform/kit/features/chat';
import { Button } from '@nimiplatform/kit/ui';
import { extractNimiErrorFields, isJsonObject } from '@nimiplatform/sdk/types';
import { ChevronUp, Loader2, Paperclip, RotateCw, Send, Square, Wrench, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { invokeSessionOperation, readSessionCall } from './integration-call.js';
import { sessionFileLimit, uploadFile } from './received-file.js';
import { RemoteDecision } from './session-decision.js';
import { SessionProgressBadge, useSessionProgress } from './session-progress.js';

type HistoryEntry = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolName?: string;
  toolFailure?: string;
  truncated?: boolean;
  timestamp?: number;
};

type SavedReceipt = { requestId: string; digest: string };
type UploadedAttachment = { fileId: string; name: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

async function sha256(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function RemoteSessionInput({
  scope,
  target,
  session,
  mayHistory,
  mayObserve,
  maySend,
  mayStop,
  mayReview,
  mayResolve,
  mayUpload,
}: {
  scope: NimiAppScope;
  target: string;
  session: { id: string; title: string };
  mayHistory: boolean;
  mayObserve: boolean;
  maySend: boolean;
  mayStop: boolean;
  mayReview: boolean;
  mayResolve: boolean;
  mayUpload: boolean;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [receiptPath, setReceiptPath] = useState('');
  const [savedReceipt, setSavedReceipt] = useState<SavedReceipt>();
  const [failedText, setFailedText] = useState<string>();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState<{ name: string; loaded: number; total: number }>();
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const prevStageRef = useRef<string | undefined>(undefined);

  const progress = useSessionProgress(scope, target, session.id, mayObserve);
  const stage = progress.view?.stage;
  const isRunning = stage === 'generating' || stage === 'tools' || stage === 'waiting' || stage === 'queued' || stage === 'placed';
  const hasPendingDecision = Boolean(progress.view?.hasPendingDecision || stage === 'waiting');

  const fetchHistory = useCallback(async (cursor = 0, prepend = false) => {
    if (!mayHistory || !lifetime.current) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    setLoadingHistory(true);
    try {
      const json = await invokeSessionOperation(scope, target, 'session.getHistory', { sessionId: session.id, cursor, limit: 30 }, signal);
      const parsed = JSON.parse(json) as { entries: HistoryEntry[]; nextCursor: number | null };
      if (!Array.isArray(parsed.entries)) throw new Error('Invalid history response.');
      setEntries(prev => prepend ? [...parsed.entries, ...prev] : parsed.entries);
      setNextCursor(parsed.nextCursor ?? null);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) setLoadingHistory(false);
    }
  }, [scope, target, session.id, mayHistory]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    const signal = AbortSignal.any([controller.signal, scope.signal]);
    setEntries([]);
    setNextCursor(null);
    setDraft('');
    setAttachments([]);
    setError('');
    setFailedText(undefined);
    prevStageRef.current = undefined;

    async function init() {
      const key = `remote-input-${await sha256(JSON.stringify([target, session.id]))}.json`;
      signal.throwIfAborted();
      try {
        const { value } = await scope.client.storage.readJson(key);
        signal.throwIfAborted();
        if (isJsonObject(value) && typeof value.requestId === 'string' && uuid.test(value.requestId)
          && typeof value.digest === 'string' && /^[0-9a-f]{64}$/.test(value.digest)) {
          setSavedReceipt({ requestId: value.requestId, digest: value.digest });
        }
      } catch (cause) {
        if (extractNimiErrorFields(cause).reasonCode !== 'APP_STORAGE_ENTRY_NOT_FOUND') throw cause;
      }
      if (!signal.aborted) setReceiptPath(key);
    }
    void init().catch(cause => { if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    if (mayHistory) void fetchHistory(0, false);
    return () => controller.abort();
  }, [scope, target, session.id, mayHistory, fetchHistory]);

  // Refresh history whenever a turn finishes on the PC.
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = stage;
    if (mayHistory && prev && prev !== stage && (stage === 'done' || stage === 'unanswered' || stage === 'idle')) {
      void fetchHistory(0, false);
    }
  }, [stage, mayHistory, fetchHistory]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, progress.view?.text]);

  async function handleFileSelect(file: File) {
    if (!mayUpload || !lifetime.current || uploading) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    setError('');
    if (file.size < 1 || file.size > sessionFileLimit) {
      setError('Choose a nonempty file up to 32 MiB.');
      return;
    }
    setUploading({ name: file.name, loaded: 0, total: file.size });
    try {
      const storage = scope.client.storage;
      const transferPath = 'transfers/' + crypto.randomUUID();
      const record = await storage.assets.write({
        relativePath: transferPath,
        body: uploadFile(file, signal, (loaded, total) => setUploading({ name: file.name, loaded, total })),
        mediaType: file.type || 'application/octet-stream',
      });
      const call = await scope.client.integration.invoke({
        targetRef: target,
        operation: 'session.importAttachment',
        inputJson: JSON.stringify({ sessionId: session.id }),
        asset: {
          relativePath: transferPath,
          source: { sha256: record.sha256, mediaType: record.mediaType ?? 'application/octet-stream', sizeBytes: record.sizeBytes },
        },
      });
      const response = await readSessionCall(scope, call, signal);
      const item = JSON.parse(response) as { fileId?: string };
      if (typeof item.fileId !== 'string' || !uuid.test(item.fileId)) throw new Error('Invalid attachment ID.');
      await storage.assets.remove(transferPath).catch(() => {});
      signal.throwIfAborted();
      setAttachments(prev => [...prev, { fileId: item.fileId!, name: file.name }]);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) setUploading(undefined);
    }
  }

  async function handleSend(isRetry = false) {
    if (!maySend || !receiptPath || !lifetime.current || sending || uploading) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    const attachmentLines = attachments.map(a => `Attachment ID: ${a.fileId} (${a.name})`);
    const text = isRetry && failedText
      ? failedText
      : [draft.trim(), ...attachmentLines].filter(Boolean).join('\n\n');
    if (!text) return;
    if (new TextEncoder().encode(text).length > 65536) {
      setError('Enter a task of up to 64 KiB.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const hash = await sha256(text);
      signal.throwIfAborted();
      let receipt = savedReceipt;
      if (!isRetry || receipt?.digest !== hash) {
        receipt = { requestId: crypto.randomUUID(), digest: hash };
        await scope.client.storage.writeJson(receiptPath, receipt);
        signal.throwIfAborted();
        setSavedReceipt(receipt);
      }
      const res = JSON.parse(await invokeSessionOperation(
        scope,
        target,
        'session.submit',
        { sessionId: session.id, requestId: receipt.requestId, text },
        signal,
      ));
      if (res?.requestId !== receipt.requestId) throw new Error('The PC returned a different input receipt.');
      setDraft('');
      setAttachments([]);
      setFailedText(undefined);
      if (mayHistory) void fetchHistory(0, false);
    } catch (cause) {
      if (!signal.aborted) {
        setFailedText(text);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (!signal.aborted) setSending(false);
    }
  }

  async function handleStop() {
    if (!mayStop || !savedReceipt || !lifetime.current || stopping) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    setStopping(true);
    setError('');
    try {
      await invokeSessionOperation(
        scope,
        target,
        'session.stopInput',
        { sessionId: session.id, requestId: savedReceipt.requestId },
        signal,
      );
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) setStopping(false);
    }
  }

  const showLiveBubble = Boolean(progress.view?.text && (stage === 'generating' || stage === 'tools' || stage === 'waiting'));

  return (
    <div className="harness-remote-chat">
      <div className="harness-remote-chat__status-bar">
        {mayObserve && (
          <SessionProgressBadge view={progress.view} error={progress.error} onReconnect={progress.reconnect} />
        )}
      </div>

      <div ref={viewportRef} className="harness-remote-chat__thread">
        {nextCursor !== null && (
          <div className="harness-remote-chat__load-older">
            <Button
              size="sm"
              tone="ghost"
              disabled={loadingHistory}
              leadingIcon={<ChevronUp size={14} />}
              onClick={() => void fetchHistory(nextCursor, true)}
            >
              {t('remote.loadOlder')}
            </Button>
          </div>
        )}

        {!loadingHistory && entries.length === 0 && !showLiveBubble && (
          <p className="harness-muted harness-remote-chat__empty">{t('remote.emptyChat')}</p>
        )}

        {entries.map(entry => (
          entry.role === 'user' ? (
            <article key={entry.id} className="harness-msg harness-msg--user">
              <div className="harness-msg__bubble">
                <p className="harness-msg__plain">{entry.text}</p>
              </div>
            </article>
          ) : entry.role === 'assistant' ? (
            <article key={entry.id} className="harness-msg harness-msg--assistant">
              <div className="harness-msg__markdown">
                <ChatMarkdownRenderer content={entry.text} />
              </div>
            </article>
          ) : (
            <details key={entry.id} className="harness-remote-tool-pill">
              <summary>
                <Wrench size={12} aria-hidden="true" />
                <code>{entry.toolName || 'tool'}</code>
                {entry.toolFailure && <span className="harness-pill harness-pill--danger harness-pill--xs">{entry.toolFailure}</span>}
              </summary>
              <pre className="harness-code-block">{entry.text}</pre>
            </details>
          )
        ))}

        {showLiveBubble && (
          <article className="harness-msg harness-msg--assistant harness-msg--streaming">
            <div className="harness-msg__markdown">
              <ChatMarkdownRenderer content={progress.view!.text} />
            </div>
            {progress.view?.truncated && (
              <p className="harness-muted harness-muted--xs">{t('remote.truncatedStream')}</p>
            )}
          </article>
        )}
      </div>

      {mayReview && (
        <RemoteDecision
          scope={scope}
          target={target}
          sessionId={session.id}
          mayResolve={mayResolve}
          autoTrigger={hasPendingDecision}
          onResolved={() => { if (mayHistory) void fetchHistory(0, false); }}
        />
      )}

      {error && (
        <div className="harness-error-banner" role="alert">
          <span>{error}</span>
          {failedText && (
            <Button size="sm" tone="secondary" leadingIcon={<RotateCw size={13} />} onClick={() => void handleSend(true)}>
              {t('remote.retrySend')}
            </Button>
          )}
        </div>
      )}

      {maySend && (
        <form
          className="harness-remote-composer"
          onSubmit={event => {
            event.preventDefault();
            void handleSend(false);
          }}
        >
          {attachments.length > 0 && (
            <div className="harness-draft-files">
              {attachments.map((file, idx) => (
                <div key={file.fileId} className="harness-draft-file">
                  <span className="harness-draft-file__open">
                    <Paperclip size={12} aria-hidden="true" />
                    <span className="filename">{file.name}</span>
                  </span>
                  <button
                    type="button"
                    className="harness-draft-file__remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="harness-remote-progress" role="status">
              <span>{t('remote.uploading', { name: uploading.name })}</span>
              <progress value={uploading.loaded} max={uploading.total} />
            </div>
          )}

          <div className="harness-remote-composer__row">
            {mayUpload && (
              <>
                <input
                  hidden
                  ref={fileInputRef}
                  type="file"
                  onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) void handleFileSelect(file);
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  tone="ghost"
                  disabled={Boolean(uploading) || sending}
                  leadingIcon={<Paperclip size={16} />}
                  aria-label={t('remote.attachFile')}
                  title={t('remote.attachFile')}
                  onClick={() => fileInputRef.current?.click()}
                />
              </>
            )}

            <textarea
              className="harness-remote-composer__input"
              rows={2}
              value={draft}
              placeholder={t('remote.sendPlaceholder')}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(false);
                }
              }}
            />

            {isRunning && mayStop && savedReceipt ? (
              <Button
                type="button"
                size="sm"
                tone="secondary"
                disabled={stopping}
                leadingIcon={<Square size={14} />}
                onClick={() => void handleStop()}
              >
                {t('remote.stop')}
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                disabled={!receiptPath || sending || Boolean(uploading) || (!draft.trim() && attachments.length === 0)}
                leadingIcon={sending ? <Loader2 size={14} className="harness-spin" /> : <Send size={14} />}
              >
                {t('remote.send')}
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
