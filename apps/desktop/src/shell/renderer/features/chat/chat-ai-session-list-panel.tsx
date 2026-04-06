import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationThreadSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { RightPanelHeader } from './chat-right-panel-character-rail';

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 7) return `${diffDay}d`;
  if (diffWeek < 5) return `${diffWeek}w`;
  return `${diffMonth}mo`;
}

// ---------------------------------------------------------------------------
// AI Session List — right panel for AI mode
// ---------------------------------------------------------------------------

export type ChatAiSessionListPanelProps = {
  threads: readonly ConversationThreadSummary[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread?: () => void;
  onArchiveThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string, title: string) => void;
  routeLabel?: string | null;
  onToggleSettings: () => void;
  settingsActive: boolean;
};

// ---------------------------------------------------------------------------
// Single thread item with inline rename
// ---------------------------------------------------------------------------

function SessionThreadItem({
  thread,
  active,
  onSelect,
  onArchive,
  onRename,
}: {
  thread: ConversationThreadSummary;
  active: boolean;
  onSelect: () => void;
  onArchive?: () => void;
  onRename?: (title: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(thread.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== thread.title && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, onRename, thread.title]);

  const handleTitleClick = useCallback((e: React.MouseEvent) => {
    if (active && onRename) {
      e.stopPropagation();
      setEditValue(thread.title);
      setEditing(true);
    }
  }, [active, onRename, thread.title]);

  return (
    <div
      className={cn(
        'group relative rounded-xl transition-colors duration-100',
        active
          ? 'bg-white/90 shadow-sm ring-1 ring-slate-200/60'
          : 'hover:bg-slate-50/80',
      )}
    >
      <button
        type="button"
        className="w-full px-3 py-2.5 pr-10 text-left"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { commitRename(); }
                  if (e.key === 'Escape') { setEditing(false); }
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded-md border border-emerald-300 bg-white px-1.5 py-0.5 text-[13px] font-semibold text-slate-900 outline-none focus:ring-1 focus:ring-emerald-400"
              />
            ) : (
              <p
                className={cn(
                  'truncate text-[13px]',
                  active ? 'font-semibold text-slate-900 cursor-text' : 'font-medium text-slate-700',
                )}
                onClick={handleTitleClick}
              >
                {thread.title}
              </p>
            )}
          </div>
          {!editing ? (
            <div className={cn(
              'shrink-0 pt-0.5 pr-1 text-[10px] text-slate-400 transition-opacity',
              onArchive ? 'group-hover:opacity-0' : null,
            )}>
              {formatRelativeTime(thread.updatedAt)}
            </div>
          ) : null}
        </div>
      </button>
      {onArchive && !editing ? (
        <button
          type="button"
          onClick={() => onArchive()}
          className="absolute right-2 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:flex"
          aria-label={t('Chat.archiveConversation', { defaultValue: 'Archive conversation' })}
          title={t('Chat.archiveConversation', { defaultValue: 'Archive conversation' })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function ChatAiSessionListPanel(props: ChatAiSessionListPanelProps) {
  const { t } = useTranslation();
  return (
    <aside
      className="relative flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-l border-white/70 bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]"
      data-right-panel="session-list"
    >
      {/* New conversation button */}
      <div className="shrink-0 px-3 pt-2 pb-1">
        <button
          type="button"
          onClick={props.onCreateThread}
          disabled={!props.onCreateThread}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors',
            'hover:bg-emerald-100/60 active:bg-emerald-100',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t('Chat.newConversation', { defaultValue: 'New conversation' })}
        </button>
      </div>

      {/* Thread list with archive action */}
      {props.threads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
          <p className="text-sm font-medium text-slate-500">{t('Chat.noConversationsYet', { defaultValue: 'No conversations yet' })}</p>
          <p className="text-xs text-slate-400">{t('Chat.startNewConversation', { defaultValue: 'Start a new conversation above' })}</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-1.5">
          <div className="flex flex-col gap-0.5 py-1">
            {props.threads.map((thread) => (
              <SessionThreadItem
                key={thread.id}
                thread={thread}
                active={thread.id === props.activeThreadId}
                onSelect={() => props.onSelectThread(thread.id)}
                onArchive={props.onArchiveThread ? () => props.onArchiveThread!(thread.id) : undefined}
                onRename={props.onRenameThread ? (title) => props.onRenameThread!(thread.id, title) : undefined}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Bottom bar: route info + settings */}
      <RightPanelHeader onToggleSettings={props.onToggleSettings} settingsActive={props.settingsActive} routeLabel={props.routeLabel} />
    </aside>
  );
}
