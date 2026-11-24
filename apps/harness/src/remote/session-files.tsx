import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { ChatMarkdownRenderer } from '@nimiplatform/kit/features/chat';
import { Button } from '@nimiplatform/kit/ui';
import { ChevronLeft, Download, File, FileCode2, FileImage, FileText, Folder, Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { invokeSessionOperation, readSessionCall } from './integration-call.js';
import { receiveFile } from './received-file.js';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

type RemoteFileItem = { name: string; ref: string; directory: boolean; size?: number };

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(item: RemoteFileItem) {
  if (item.directory) return Folder;
  const lower = item.name.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return FileImage;
  if (/\.(ts|tsx|js|jsx|json|py|go|rs|sh|css|html|sql|yaml|yml)$/.test(lower)) return FileCode2;
  if (/\.(md|markdown|txt|csv|log)$/.test(lower)) return FileText;
  return File;
}

export function RemoteSessionFiles({
  scope,
  target,
  sessionId,
  mayListFiles,
  mayDownload,
}: {
  scope: NimiAppScope;
  target: string;
  sessionId: string;
  mayListFiles: boolean;
  mayDownload: boolean;
}) {
  const { t } = useI18n();
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<RemoteFileItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [downloadingRef, setDownloadingRef] = useState<string>();
  const [manualId, setManualId] = useState('');
  const [progress, setProgress] = useState<{ loaded: number; total: number }>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; type: string; name: string; text?: string; truncated: boolean }>();
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setFolder('');
    setItems([]);
    setNextOffset(null);
    setResult(undefined);
    setError('');
    return () => controller.abort();
  }, [scope, target, sessionId]);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const loadFolder = useCallback(async (targetFolder: string, offset: number) => {
    if (!mayListFiles || !lifetime.current) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    setLoadingList(true);
    setError('');
    try {
      const json = await invokeSessionOperation(
        scope,
        target,
        'session.listFiles',
        { sessionId, ...(targetFolder ? { folder: targetFolder } : {}), offset },
        signal,
      );
      const parsed = JSON.parse(json) as { items: RemoteFileItem[]; nextOffset: number | null };
      if (!Array.isArray(parsed.items)) throw new Error('Invalid file list response.');
      setItems(prev => offset === 0 ? parsed.items : [...prev, ...parsed.items]);
      setNextOffset(parsed.nextOffset ?? null);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) setLoadingList(false);
    }
  }, [scope, target, sessionId, mayListFiles]);

  useEffect(() => {
    if (mayListFiles) void loadFolder(folder, 0);
  }, [mayListFiles, folder, loadFolder]);

  async function download(selector: { ref: string; name: string } | { fileId: string }) {
    if (!mayDownload || !lifetime.current || downloadingRef) return;
    const signal = AbortSignal.any([scope.signal, lifetime.current.signal]);
    const label = 'ref' in selector ? selector.ref : selector.fileId;
    setDownloadingRef(label);
    setError('');
    setProgress(undefined);
    try {
      const storage = scope.client.storage;
      const transferPath = 'transfers/' + crypto.randomUUID();
      const call = await scope.client.integration.invoke({
        targetRef: target,
        operation: 'session.downloadResult',
        inputJson: JSON.stringify('ref' in selector
          ? { sessionId, ref: selector.ref }
          : { sessionId, fileId: selector.fileId }),
        asset: { relativePath: transferPath },
      });
      const responseJson = await readSessionCall(scope, call, signal);
      const item = JSON.parse(responseJson) as { fileId?: string; name?: string };
      if (typeof item.fileId !== 'string' || !uuid.test(item.fileId)) {
        throw new Error('The PC returned an invalid file reference.');
      }
      const read = await storage.assets.read({ relativePath: transferPath });
      const preferredName = item.name || ('name' in selector ? selector.name : undefined);
      const { blob, ...view } = await receiveFile(read, item.fileId, signal, (loaded, total) => setProgress({ loaded, total }), preferredName);
      signal.throwIfAborted();
      setResult(prev => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { ...view, url: URL.createObjectURL(blob) };
      });
      await storage.assets.remove(transferPath).catch(() => {});
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) {
        setDownloadingRef(undefined);
        setProgress(undefined);
      }
    }
  }

  return (
    <div className="harness-remote-files">
      {mayListFiles && (
        <div className="harness-remote-files__browser">
          <div className="harness-inspector-toolbar">
            <div className="harness-inspector-path">
              {folder && (
                <Button
                  size="sm"
                  tone="ghost"
                  leadingIcon={<ChevronLeft size={14} />}
                  onClick={() => setFolder(folder.split('/').slice(0, -1).join('/'))}
                  aria-label={t('inspector.backFolder')}
                />
              )}
              <code>/{folder}</code>
            </div>
            <Button
              size="sm"
              tone="ghost"
              disabled={loadingList}
              leadingIcon={<RefreshCw size={13} className={loadingList ? 'harness-spin' : ''} />}
              onClick={() => void loadFolder(folder, 0)}
              aria-label={t('remote.refresh')}
            />
          </div>

          <ul className="harness-remote-file-list">
            {items.map(item => {
              const Icon = fileIcon(item);
              const isBusy = downloadingRef === item.ref;
              return (
                <li key={item.ref} className="harness-remote-file-row">
                  <button
                    type="button"
                    className="harness-file-row"
                    onClick={() => {
                      if (item.directory) setFolder(item.ref);
                      else if (mayDownload) void download({ ref: item.ref, name: item.name });
                    }}
                  >
                    <Icon size={15} className={item.directory ? 'harness-file-row__folder' : ''} aria-hidden="true" />
                    <span className="harness-file-row__name">{item.name}{item.directory ? '/' : ''}</span>
                    {!item.directory && item.size !== undefined && (
                      <span className="harness-file-row__size">{formatSize(item.size)}</span>
                    )}
                    {!item.directory && mayDownload && (
                      <span className="harness-remote-file-row__dl">
                        {isBusy ? <Loader2 size={14} className="harness-spin" /> : <Download size={14} />}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {!loadingList && items.length === 0 && !error && (
            <p className="harness-muted harness-muted--sm">{t('remote.filesEmpty')}</p>
          )}
          {nextOffset !== null && (
            <Button size="sm" tone="secondary" disabled={loadingList} onClick={() => void loadFolder(folder, nextOffset)}>
              {t('remote.loadMore')}
            </Button>
          )}
        </div>
      )}

      {downloadingRef && (
        <div className="harness-remote-progress" role="status">
          <span>{t('remote.downloading')}</span>
          {progress && <progress value={progress.loaded} max={progress.total} />}
        </div>
      )}

      {error && <p className="harness-error" role="alert">{error}</p>}

      {result && (
        <section className="harness-remote-preview">
          <header className="harness-remote-preview__header">
            <strong>{result.name}</strong>
            <a className="harness-download-link" href={result.url} download={result.name}>
              <Download size={14} aria-hidden="true" />
              <span>{t('remote.saveFile', { name: result.name })}</span>
            </a>
          </header>
          {['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(result.type) && (
            <img className="harness-remote-preview__img" alt={result.name} src={result.url} />
          )}
          {result.text !== undefined && (
            <>
              {result.name.toLowerCase().endsWith('.md') || result.type === 'text/markdown' ? (
                <div className="harness-file-preview__markdown">
                  <ChatMarkdownRenderer content={result.text} />
                </div>
              ) : (
                <pre className="harness-code-block">{result.text}</pre>
              )}
              {result.truncated && <p className="harness-muted harness-muted--xs">{t('remote.truncatedPreview')}</p>}
            </>
          )}
          {['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/flac'].includes(result.type) && (
            <audio controls src={result.url} className="harness-remote-preview__audio" />
          )}
        </section>
      )}

      {mayDownload && (
        <details className="harness-remote-legacy-dl">
          <summary>{t('remote.downloadById')}</summary>
          <div className="harness-remote-legacy-dl__row">
            <input
              type="text"
              className="harness-input"
              placeholder={t('remote.fileIdPlaceholder')}
              value={manualId}
              onChange={e => setManualId(e.target.value)}
            />
            <Button
              size="sm"
              tone="secondary"
              disabled={Boolean(downloadingRef) || !uuid.test(manualId.trim())}
              onClick={() => void download({ fileId: manualId.trim() })}
            >
              {t('remote.download')}
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}
