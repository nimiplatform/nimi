import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationThreadSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { useTranslation } from 'react-i18next';
import { ChatRightColumn, ChatRightColumnCard, ChatRightColumnCardTitle } from './chat-right-column-primitives';
import { ChatRightPanelSettings } from './chat-right-panel-settings';

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

export type ChatAiSessionListPanelProps = {
  threads: readonly ConversationThreadSummary[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread?: () => void;
  onArchiveThread?: (threadId: string) => void;
  onRenameThread?: (threadId: string, title: string) => void;
  onToggleSettings: () => void;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  onToggleFold?: () => void;
  assistantTitle: string;
  assistantHandle?: string | null;
  assistantBio?: string | null;
  settingsContent?: ReactNode;
};

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
        'group relative rounded-[12px] border transition-colors duration-100',
        active
          ? 'border-emerald-200/80 bg-white/96 shadow-[0_10px_22px_rgba(15,23,42,0.05)]'
          : 'border-transparent bg-white/46 hover:bg-white/72',
      )}
    >
      <button type="button" className="w-full px-3 py-2.5 pr-10 text-left" onClick={onSelect}>
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
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditing(false);
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
            <div className={cn('shrink-0 pt-0.5 pr-1 text-[10px] text-slate-400 transition-opacity', onArchive ? 'group-hover:opacity-0' : null)}>
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
  const activeThread = props.threads.find((thread) => thread.id === props.activeThreadId) || null;

  return (
    <ChatRightColumn data-chat-mode-column="ai">
      <ChatRightColumnCard cardKey="primary" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-white/70 px-4 pb-3 pt-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-sky-400 to-teal-500 text-base font-semibold text-white shadow-[0_10px_20px_rgba(56,189,248,0.22)]">
              {(props.assistantTitle || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <ChatRightColumnCardTitle
                title={props.assistantTitle}
                subtitle={props.assistantHandle || t('Chat.aiModeSubtitle', { defaultValue: 'Assistant threads and summaries' })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {props.assistantBio || t('Chat.aiTranscriptEmpty', { defaultValue: 'Send a message to start this conversation.' })}
          </p>
          <button
            type="button"
            onClick={props.onCreateThread}
            disabled={!props.onCreateThread}
            className={cn(
              'mt-4 flex w-full items-center justify-center gap-2 rounded-[12px] border border-emerald-200/70 bg-emerald-50/76 px-3 py-2.5 text-xs font-semibold text-emerald-700 transition-colors',
              'hover:bg-emerald-100/72 active:bg-emerald-100',
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
        {props.threads.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-500">{t('Chat.noConversationsYet', { defaultValue: 'No conversations yet' })}</p>
            <p className="text-xs text-slate-400">{t('Chat.startNewConversation', { defaultValue: 'Start a new conversation above' })}</p>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1 px-3 py-3">
            <div className="flex flex-col gap-1.5">
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
      </ChatRightColumnCard>

      <ChatRightColumnCard cardKey="status" className="px-4 py-4">
        <ChatRightColumnCardTitle
          title={t('Chat.statusCardTitle', { defaultValue: 'Assistant status' })}
          subtitle={activeThread
            ? t('Chat.activeThreadSummary', {
              defaultValue: 'Active thread updated {{time}}',
              time: formatRelativeTime(activeThread.updatedAt),
            })
            : t('Chat.aiStatusSummary', { defaultValue: 'Ready when you are.' })}
        />
        <div className="mt-4 flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700/72">
            {t('Chat.aiPresenceLabel', { defaultValue: 'Assistant online' })}
          </p>
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-900">{props.assistantTitle}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {activeThread?.title || t('Chat.aiStatusFallback', { defaultValue: 'Select a thread or start a new one.' })}
        </p>
      </ChatRightColumnCard>

      <ChatRightPanelSettings
        onToggleSettings={props.onToggleSettings}
        thinkingState={props.thinkingState}
        onThinkingToggle={props.onThinkingToggle}
        onToggleFold={props.onToggleFold}
        expanded={props.settingsActive}
        collapsedSummary={t('Chat.aiSettingsCollapsedSummary', {
          defaultValue: 'Model and diagnostics stay docked here when you need them.',
        })}
      >
        {props.settingsContent ?? null}
      </ChatRightPanelSettings>
    </ChatRightColumn>
  );
}
