import { Button, ScrollArea, Surface, cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationRow } from '../../bridge/sqlite-bridge.js';
import { formatRelativeTimeCn } from './advisor-theme.js';

export type AdvisorSidebarProps = {
  conversations: ConversationRow[];
  activeConvId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
};

export function AdvisorSidebar({
  conversations,
  activeConvId,
  onSelectConversation,
  onNewConversation,
}: AdvisorSidebarProps) {
  return (
    <Surface
      as="div"
      material="glass-regular"
      padding="none"
      tone="card"
      className="mt-2 mb-10 flex w-56 shrink-0 flex-col p-3"
    >
      <Button
        onClick={onNewConversation}
        tone="secondary"
        size="md"
        fullWidth
        leadingIcon={<PlusIcon />}
        className="mb-3"
      >
        新对话
      </Button>

      {/* Conversation list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1">
          {conversations.map((conv) => {
            const active = conv.conversationId === activeConvId;
            return (
              <button
                key={conv.conversationId}
                type="button"
                onClick={() => onSelectConversation(conv.conversationId)}
                className={cn(
                  'w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-[var(--nimi-motion-fast)] hover:bg-[var(--nimi-action-ghost-hover)]',
                  active && 'bg-[var(--nimi-surface-active)] shadow-[var(--nimi-elevation-base)]',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      'min-w-0 flex-1 truncate text-[14px] text-[var(--nimi-text-secondary)]',
                      active && 'font-semibold text-[var(--nimi-text-primary)]',
                    )}
                  >
                    {conv.title ?? '新对话'}
                  </p>
                  <span className="shrink-0 pt-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                    {formatRelativeTimeCn(conv.lastMessageAt)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </Surface>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
