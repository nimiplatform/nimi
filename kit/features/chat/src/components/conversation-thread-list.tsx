import { EmptyState, ScrollArea, cn } from '@nimiplatform/kit/ui';
import type { ReactNode } from 'react';
import type { ConversationThreadSummary } from '../types.js';
import { resolveChatCopy, type ChatCopy } from '../copy.js';

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; conversation entry lists are owned by the canonical target pane.
 */
export type ConversationThreadListProps = {
  threads: readonly ConversationThreadSummary[];
  activeThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  emptyState?: ReactNode;
  renderMeta?: (thread: ConversationThreadSummary) => ReactNode;
  className?: string;
  /** Optional copy overrides merged over the default English strings. */
  copy?: ChatCopy;
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; conversation entry lists are owned by the canonical target pane.
 */
export function ConversationThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  emptyState,
  renderMeta,
  className,
  copy,
}: ConversationThreadListProps) {
  const copyResolved = resolveChatCopy(copy);
  if (threads.length === 0) {
    return (
      <div className={cn('px-2 py-2', className)}>
        {emptyState ?? <EmptyState title={copyResolved.threadListEmptyTitle} />}
      </div>
    );
  }

  return (
    <ScrollArea className={cn('min-h-0 flex-1', className)}>
      <div className="flex flex-col gap-0.5 py-1">
        {threads.map((thread) => {
          const active = thread.id === activeThreadId;
          return (
            <button
              key={thread.id}
              type="button"
              className={cn(
                'w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-[var(--nimi-motion-fast)]',
                active
                  ? 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,transparent)] shadow-sm ring-1 ring-[var(--nimi-border-subtle)]'
                  : 'hover:bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)]',
              )}
              onClick={() => onSelectThread?.(thread.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={cn(
                      'truncate text-[length:var(--nimi-type-body-sm-size)]',
                      active ? 'font-semibold text-[var(--nimi-text-primary)]' : 'font-medium text-[var(--nimi-text-secondary)]',
                    )}>
                      {thread.title}
                    </p>
                    {thread.unreadCount > 0 ? (
                      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--nimi-surface-active)] px-1 text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-action-primary-bg)]">
                        {thread.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                    {thread.previewText || 'No preview yet.'}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">
                  {thread.updatedAt}
                </div>
              </div>
              {renderMeta ? (
                <div className="mt-1.5 text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">
                  {renderMeta(thread)}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
