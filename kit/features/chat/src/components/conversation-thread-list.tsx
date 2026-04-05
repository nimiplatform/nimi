import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import type { ReactNode } from 'react';
import type { ConversationThreadSummary } from '../types.js';

export type ConversationThreadListProps = {
  threads: readonly ConversationThreadSummary[];
  activeThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  emptyState?: ReactNode;
  renderMeta?: (thread: ConversationThreadSummary) => ReactNode;
  className?: string;
};

export function ConversationThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  emptyState,
  renderMeta,
  className,
}: ConversationThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className={cn('px-2 py-6 text-center text-sm text-slate-400', className)}>
        {emptyState || 'No conversations yet.'}
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
                'w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-100',
                active
                  ? 'bg-white/90 shadow-sm ring-1 ring-slate-200/60'
                  : 'hover:bg-slate-50/80',
              )}
              onClick={() => onSelectThread?.(thread.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={cn(
                      'truncate text-[13px]',
                      active ? 'font-semibold text-slate-900' : 'font-medium text-slate-700',
                    )}>
                      {thread.title}
                    </p>
                    {thread.unreadCount > 0 ? (
                      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-700">
                        {thread.unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-400">
                    {thread.previewText || 'No preview yet.'}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5 text-[10px] text-slate-400">
                  {thread.updatedAt}
                </div>
              </div>
              {renderMeta ? (
                <div className="mt-1.5 text-[11px] text-slate-400">
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
