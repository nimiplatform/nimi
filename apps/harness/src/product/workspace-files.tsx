import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatMarkdownRenderer } from '@nimiplatform/kit/features/chat';
import { Button } from '@nimiplatform/kit/ui';
import {
  ChevronLeft,
  ExternalLink,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  Folder,
  Maximize2,
  Minimize2,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { useI18n } from '../i18n.js';
import type { Material, SessionDrafts } from './session-drafts.js';

export type WorkspaceItem = { name: string; ref: string; directory: boolean; size?: number };
type FileInfo = { name: string; ref: string; size: number };
type DocumentPreview = FileInfo & ({ format: 'file'; message?: string } | { format: 'text' | 'markdown'; content: string; page: number; pages: number });
export type FilePreview = DocumentPreview | (FileInfo & { format: 'image'; mimeType: string; bytes: ArrayBuffer });
type VisiblePreview = DocumentPreview | (FileInfo & { format: 'image'; url: string });

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function itemIcon(item: WorkspaceItem) {
  if (item.directory) return Folder;
  const lower = item.name.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return FileImage;
  if (lower.endsWith('.json')) return FileJson;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|sh|zsh|css|scss|html|xml|sql)$/.test(lower)) return FileCode2;
  if (/\.(md|markdown|txt|log|csv|yaml|yml|toml)$/.test(lower)) return FileText;
  return File;
}

function AttachToDraft({ store, sessionId, file }: { store: SessionDrafts; sessionId: string; file: Material }) {
  const { t } = useI18n();
  const draft = useSyncExternalStore(store.subscribe, () => store.current(sessionId));
  const [saveError, setSaveError] = useState('');
  const attached = draft?.files.some(item => item.ref === file.ref);
  return (
    <>
      <Button
        size="sm"
        tone="secondary"
        leadingIcon={<Paperclip size={13} />}
        disabled={!draft || (attached && !saveError)}
        onClick={async () => {
          try {
            await store.attach(sessionId, { ref: file.ref, name: file.name });
            setSaveError('');
          } catch (cause) {
            setSaveError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        {saveError ? t('inspector.retryAttach') : attached ? t('inspector.attachedDraft') : t('inspector.attachDraft')}
      </Button>
      {saveError && <p className="harness-error" role="alert">{saveError}</p>}
    </>
  );
}

export function WorkspaceFiles({
  sessionId,
  selected,
  toolRevision,
  drafts,
  onSelect,
}: {
  drafts?: SessionDrafts;
  sessionId: string;
  selected?: string;
  toolRevision?: number;
  onSelect(ref: string | undefined): void;
}) {
  const { t } = useI18n();
  const [folder, setFolder] = useState('');
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<VisiblePreview>();
  const [failedImageUrl, setFailedImageUrl] = useState('');
  const [actualSizeRef, setActualSizeRef] = useState<string>();
  const [location, setLocation] = useState<{ ref: string; page: number }>();
  const page = location && selected === location.ref ? location.page : 0;
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const panel = useRef<HTMLDivElement>(null);
  const visiblePage = preview && 'page' in preview ? preview.page : undefined;

  useLayoutEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [preview?.ref, visiblePage]);

  const fileRevision = selected || offset === 0 ? toolRevision : undefined;

  useEffect(() => {
    let active = true;
    let imageUrl: string | undefined;
    setError('');
    setPreview(current => current?.ref === selected ? current : undefined);
    setNext(null);
    setLoading(true);
    if (!offset) setItems([]);
    async function load() {
      if (selected) {
        const file = await window.nimiHarness.previewFile(sessionId, selected, page);
        if (!active) return;
        if (file.format === 'image') {
          imageUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }));
          setPreview({ format: 'image', name: file.name, ref: file.ref, size: file.size, url: imageUrl });
        } else {
          setPreview(file);
        }
      } else {
        const listed = await window.nimiHarness.listFiles(sessionId, folder, offset);
        if (active) {
          setItems(prev => offset ? [...prev, ...listed.items] : listed.items);
          setNext(listed.next);
        }
      }
    }
    void load()
      .catch(err => { if (active) { setPreview(undefined); setError(String(err.message ?? err)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [sessionId, selected, folder, offset, refresh, fileRevision, page]);

  function openFolder(ref: string) {
    setLocation(undefined);
    setActualSizeRef(undefined);
    setOffset(0);
    setFolder(ref);
    onSelect(undefined);
  }

  return (
    <div ref={panel} className="harness-inspector-section">
      <div className="harness-inspector-toolbar">
        <div className="harness-inspector-path" title={selected || folder || '/'}>
          {(selected || folder) && (
            <Button
              size="sm"
              tone="ghost"
              leadingIcon={<ChevronLeft size={14} />}
              onClick={() => openFolder((selected ?? folder).split('/').slice(0, -1).join('/'))}
              aria-label={t('inspector.backFolder')}
            />
          )}
          <code>{selected || folder || '/'}</code>
        </div>
        <div className="harness-inspector-toolbar__actions">
          <Button
            size="sm"
            tone="ghost"
            leadingIcon={<RefreshCw size={13} />}
            onClick={() => { setOffset(0); setRefresh(n => n + 1); }}
            aria-label={t('inspector.refresh')}
          />
          <Button
            size="sm"
            tone="ghost"
            leadingIcon={<ExternalLink size={13} />}
            onClick={() => void window.nimiHarness.revealWorkspace(sessionId).catch(err => setError(String(err.message ?? err)))}
            title={t('workspace.revealFolder')}
            aria-label={t('workspace.revealFolder')}
          />
        </div>
      </div>

      {error && <p className="harness-error" role="alert">{error}</p>}

      {preview && preview.ref === selected && (
        <div className="harness-file-preview">
          <div className="harness-file-actions">
            {drafts && <AttachToDraft key={preview.ref} store={drafts} sessionId={sessionId} file={preview} />}
            {preview.format === 'image' && failedImageUrl !== preview.url && (
              <Button
                size="sm"
                tone="secondary"
                leadingIcon={actualSizeRef === preview.ref ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                onClick={() => setActualSizeRef(actualSizeRef === preview.ref ? undefined : preview.ref)}
              >
                {actualSizeRef === preview.ref ? t('inspector.fitImage') : t('inspector.actualSize')}
              </Button>
            )}
            <Button
              size="sm"
              tone="ghost"
              leadingIcon={<ExternalLink size={13} />}
              onClick={() => void window.nimiHarness.revealFile(sessionId, preview.ref).catch(err => setError(String(err.message ?? err)))}
            >
              {t('inspector.showInFolder')}
            </Button>
          </div>

          {'pages' in preview && preview.pages > 1 && (
            <nav className="harness-page-nav" aria-label="File pages">
              {preview.page > 1 && (
                <Button size="sm" tone="ghost" disabled={loading} onClick={() => setLocation({ ref: preview.ref, page: 0 })}>
                  {t('inspector.first')}
                </Button>
              )}
              <Button size="sm" tone="ghost" disabled={loading || !preview.page} onClick={() => setLocation({ ref: preview.ref, page: preview.page - 1 })}>
                {t('inspector.prev')}
              </Button>
              <span role="status">{t('inspector.pageOf', { page: preview.page + 1, pages: preview.pages })}</span>
              <Button size="sm" tone="ghost" disabled={loading || preview.page === preview.pages - 1} onClick={() => setLocation({ ref: preview.ref, page: preview.page + 1 })}>
                {t('inspector.next')}
              </Button>
              {preview.page < preview.pages - 2 && (
                <Button size="sm" tone="ghost" disabled={loading} onClick={() => setLocation({ ref: preview.ref, page: preview.pages - 1 })}>
                  {t('inspector.last')}
                </Button>
              )}
            </nav>
          )}

          {preview.format === 'markdown' && (
            <div className="harness-file-preview__markdown">
              <ChatMarkdownRenderer content={preview.content} />
            </div>
          )}
          {preview.format === 'text' && (
            <pre className="harness-code-block harness-file-preview__code">{preview.content}</pre>
          )}
          {preview.format === 'image' && (
            failedImageUrl === preview.url ? (
              <p className="harness-error" role="alert">{t('inspector.imageError')}</p>
            ) : (
              <div className="harness-image-viewport" data-actual-size={actualSizeRef === preview.ref}>
                <img src={preview.url} alt={preview.name} onError={() => setFailedImageUrl(preview.url)} />
              </div>
            )
          )}
          {preview.format === 'file' && (
            <p className="harness-muted">{preview.message ?? t('inspector.binaryHint')}</p>
          )}
        </div>
      )}

      {!selected && (
        <div className="harness-file-tree">
          <ul>
            {items.map(item => {
              const Icon = itemIcon(item);
              return (
                <li key={item.ref}>
                  <button
                    type="button"
                    className="harness-file-row"
                    onClick={() => item.directory ? openFolder(item.ref) : onSelect(item.ref)}
                  >
                    <Icon size={15} className={item.directory ? 'harness-file-row__folder' : ''} aria-hidden="true" />
                    <span className="harness-file-row__name">{item.name}{item.directory ? '/' : ''}</span>
                    {!item.directory && item.size !== undefined && (
                      <span className="harness-file-row__size">{formatSize(item.size)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {!items.length && !error && !loading && (
            <p className="harness-muted">{t('inspector.emptyFolder')}</p>
          )}
          {next !== null && (
            <Button size="sm" tone="secondary" onClick={() => setOffset(next)}>
              {t('inspector.moreFiles')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
