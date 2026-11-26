import { useEffect, useRef, useState } from 'react';
import { useNimiAppSession } from '@nimiplatform/kit/auth/app';
import { ConfirmDialog, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import {
  ChevronDown,
  Download,
  Folder,
  FolderPlus,
  Languages,
  Loader2,
  Monitor,
  Moon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n.js';
import { useAppTheme } from '../theme.js';
import type { HarnessSessionSummary } from './harness-types.js';

function formatRelativeTime(
  updatedAt: number | undefined,
  t: ReturnType<typeof useI18n>['t'],
): string | undefined {
  if (!updatedAt || !Number.isFinite(updatedAt)) return undefined;
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t('sidebar.time.justNow');
  if (mins < 60) return t('sidebar.time.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sidebar.time.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('sidebar.time.daysAgo', { n: days });
  return undefined;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  activeDestination,
  disabled,
  onSelectSession,
  onCreateSession,
  onPinSession,
  onRenameSession,
  onExportSession,
  onDeleteSession,
  onOpenModels,
}: {
  sessions: HarnessSessionSummary[];
  activeSessionId?: string;
  activeDestination: 'conversations' | 'models';
  disabled: boolean;
  onSelectSession: (id: string) => void;
  onCreateSession: (pickFolder?: boolean) => void;
  onPinSession: (id: string, pinned: boolean) => void;
  onRenameSession: (id: string, title: string) => void;
  onExportSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onOpenModels: () => void;
}) {
  const { t, locale, toggleLocale } = useI18n();
  const { preference, cyclePreference } = useAppTheme();
  const { session: appSession, snapshot: access } = useNimiAppSession();
  const [query, setQuery] = useState('');
  const [partnerFilter, setPartnerFilter] = useState<string>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [editTitle, setEditTitle] = useState('');
  const [pendingDelete, setPendingDelete] = useState<HarnessSessionSummary | null>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeDestination === 'conversations' && activeSessionId) {
      activeRowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeDestination, activeSessionId]);

  const partnerBindings = Array.from(
    new Set(sessions.map(item => item.agentBinding?.trim()).filter((v): v is string => Boolean(v))),
  );
  const effectivePartnerFilter = partnerFilter === 'all' || partnerBindings.includes(partnerFilter)
    ? partnerFilter
    : 'all';

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = sessions
    .filter(item => effectivePartnerFilter === 'all' || item.agentBinding === effectivePartnerFilter)
    .filter(item => !normalizedQuery || item.title.toLocaleLowerCase().includes(normalizedQuery)
      || (item.workspaceLabel?.toLocaleLowerCase().includes(normalizedQuery) ?? false))
    .slice()
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const pinned = filtered.filter(item => item.pinned);
  const recent = filtered.filter(item => !item.pinned);

  const user = access.identity.status === 'signed-in' ? access.identity.user : null;
  const runtimeStatus = access.runtime.status;
  const ThemeIcon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;
  const themeLabel = preference === 'light' ? t('app.theme.light') : preference === 'dark' ? t('app.theme.dark') : t('app.theme.system');

  function commitRename(id: string, original: string) {
    const trimmed = editTitle.trim();
    setEditingId(undefined);
    if (trimmed && trimmed !== original) onRenameSession(id, trimmed);
  }

  function renderSessionRow(item: HarnessSessionSummary) {
    const selected = activeDestination === 'conversations' && item.id === activeSessionId;
    const isEditing = editingId === item.id;
    const relTime = formatRelativeTime(item.updatedAt, t);
    const hasSubMeta = Boolean(item.hasPendingDecision || item.workspaceLabel || relTime);

    return (
      <div
        key={item.id}
        ref={selected ? activeRowRef : undefined}
        className={`harness-session-row ${selected ? 'harness-session-row--active' : ''}`}
      >
        {isEditing ? (
          <form
            className="harness-session-row__edit"
            onSubmit={e => { e.preventDefault(); commitRename(item.id, item.title); }}
          >
            <input
              autoFocus
              className="harness-input harness-input--sm"
              maxLength={120}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={() => commitRename(item.id, item.title)}
              onKeyDown={e => { if (e.key === 'Escape') setEditingId(undefined); }}
            />
          </form>
        ) : (
          <>
            <button
              type="button"
              className="harness-session-row__main"
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelectSession(item.id)}
              title={item.workspaceDir ? `${item.title}\n${item.workspaceDir}` : item.title}
            >
              <span className={`harness-status-indicator harness-status-indicator--${item.status}`} aria-label={t(`sidebar.status.${item.status}` as const)}>
                {item.status === 'running' ? <Loader2 size={12} className="harness-spin" /> : <span className="harness-status-dot" />}
              </span>
              <span className="harness-session-row__text">
                <span className="harness-session-row__title">{item.title}</span>
                {hasSubMeta && (
                  <span className="harness-session-row__sub">
                    {item.hasPendingDecision && (
                      <span className="harness-pill harness-pill--warning harness-pill--xs">{t('sidebar.status.waiting')}</span>
                    )}
                    {item.workspaceLabel && (
                      <span className="harness-folder-tag">
                        <Folder size={10} aria-hidden="true" />
                        <span>{item.workspaceLabel}</span>
                      </span>
                    )}
                    {relTime && !item.hasPendingDecision && (
                      <span className="harness-session-row__time">{relTime}</span>
                    )}
                  </span>
                )}
              </span>
            </button>
            <div className="harness-session-row__actions">
              <button
                type="button"
                className="harness-icon-action"
                title={item.pinned ? t('sidebar.unpin') : t('sidebar.pin')}
                aria-label={item.pinned ? t('sidebar.unpin') : t('sidebar.pin')}
                onClick={e => { e.stopPropagation(); onPinSession(item.id, !item.pinned); }}
              >
                {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
              <button
                type="button"
                className="harness-icon-action"
                title={t('sidebar.rename')}
                aria-label={t('sidebar.rename')}
                onClick={e => { e.stopPropagation(); setEditingId(item.id); setEditTitle(item.title); }}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className="harness-icon-action"
                title={t('sidebar.exportMarkdown')}
                aria-label={t('sidebar.exportMarkdown')}
                onClick={e => { e.stopPropagation(); onExportSession(item.id); }}
              >
                <Download size={13} />
              </button>
              <button
                type="button"
                className="harness-icon-action harness-icon-action--danger"
                title={t('sidebar.delete')}
                aria-label={t('sidebar.delete')}
                onClick={e => {
                  e.stopPropagation();
                  setPendingDelete(item);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <aside className="harness-sidebar" aria-label={t('sidebar.title')}>
      <div className="harness-sidebar__header">
        <div className="harness-sidebar__create-group">
          <button
            type="button"
            className="harness-new-btn"
            disabled={disabled}
            onClick={() => onCreateSession()}
          >
            <Plus size={15} aria-hidden="true" />
            <span>{t('sidebar.newSession')}</span>
          </button>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="harness-new-menu-btn"
                disabled={disabled}
                aria-label={t('sidebar.newSessionInFolder')}
                title={t('sidebar.newSessionInFolder')}
              >
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="harness-popover">
              <div className="harness-popover__list">
                <button
                  type="button"
                  className="harness-popover__item"
                  onClick={() => { setMenuOpen(false); onCreateSession(true); }}
                >
                  <span className="harness-popover__item-lead">
                    <FolderPlus size={14} aria-hidden="true" />
                    <span>{t('sidebar.newSessionInFolder')}</span>
                  </span>
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="harness-sidebar__search">
          <Search size={13} className="harness-sidebar__search-icon" aria-hidden="true" />
          <input
            type="text"
            className="harness-input harness-input--search"
            aria-label={t('sidebar.searchPlaceholder')}
            placeholder={t('sidebar.searchPlaceholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="harness-sidebar__search-clear"
              aria-label={t('sidebar.clearSearch')}
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {partnerBindings.length > 1 && (
          <div className="harness-sidebar__partner-filter" style={{ marginTop: 6 }}>
            <select
              className="harness-input harness-input--search"
              aria-label={t('sidebar.partnerFilterLabel')}
              value={effectivePartnerFilter}
              onChange={e => setPartnerFilter(e.target.value)}
            >
              <option value="all">{t('sidebar.partnerFilterAll')}</option>
              {partnerBindings.map(binding => (
                <option key={binding} value={binding}>{binding}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <nav className="harness-sidebar__list" aria-label={t('sidebar.title')}>
        {pinned.length > 0 && (
          <div className="harness-sidebar__group">
            <div className="harness-sidebar__group-label">{t('sidebar.pinned')}</div>
            {pinned.map(renderSessionRow)}
          </div>
        )}
        {recent.length > 0 && (
          <div className="harness-sidebar__group">
            {pinned.length > 0 && <div className="harness-sidebar__group-label">{t('sidebar.recent')}</div>}
            {recent.map(renderSessionRow)}
          </div>
        )}
        {filtered.length === 0 && (
          <p className="harness-muted harness-muted--sm harness-sidebar__empty">{t('sidebar.noMatches')}</p>
        )}
      </nav>

      {/* Persistent Account + Runtime + Theme + Language + Models Footer (Contract 1.3) */}
      <footer className="harness-sidebar__footer">
        <button
          type="button"
          className="harness-account-pill"
          title={t('app.openHome')}
          onClick={() => {
            if (appSession.account.kind === 'home-managed') {
              void appSession.account.openAccountOwner();
            } else {
              onOpenModels();
            }
          }}
        >
          <span className="harness-account-pill__avatar" aria-hidden="true">
            {(user?.displayName?.[0] ?? 'N').toUpperCase()}
          </span>
          <span className="harness-account-pill__info">
            <span className="harness-account-pill__name">{user?.displayName || t('app.account')}</span>
            <span className="harness-account-pill__runtime">
              <span className={`harness-runtime-dot harness-runtime-dot--${runtimeStatus}`} />
              <span>{t(`app.runtimeStatus.${runtimeStatus}` as const)}</span>
            </span>
          </span>
        </button>

        <div className="harness-sidebar__footer-tools">
          <div className="harness-sidebar__footer-quick">
            <button
              type="button"
              className="harness-footer-icon-btn"
              title={`${t('app.theme.label')}: ${themeLabel}`}
              aria-label={`${t('app.theme.label')}: ${themeLabel}`}
              onClick={cyclePreference}
            >
              <ThemeIcon size={14} />
            </button>
            <button
              type="button"
              className="harness-footer-text-btn"
              title={t('app.language.label')}
              aria-label={t('app.language.label')}
              onClick={toggleLocale}
            >
              <Languages size={13} aria-hidden="true" />
              <span>{locale === 'en' ? '中文' : 'EN'}</span>
            </button>
          </div>
          <button
            type="button"
            className={`harness-footer-text-btn ${activeDestination === 'models' ? 'harness-footer-text-btn--active' : ''}`}
            onClick={onOpenModels}
          >
            <Settings size={13} aria-hidden="true" />
            <span>{t('app.modelsAccess')}</span>
          </button>
        </div>
      </footer>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('sidebar.delete')}
        message={pendingDelete ? t('sidebar.deleteConfirm', { title: pendingDelete.title }) : ''}
        confirmLabel={t('sidebar.delete')}
        cancelLabel={t('decision.cancel')}
        confirmTone="danger"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDeleteSession(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </aside>
  );
}
