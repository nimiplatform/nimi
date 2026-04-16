import { ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
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
      {/* New conversation button */}
      <button
        type="button"
        onClick={onNewConversation}
        className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors hover:bg-white/60"
        style={{ background: 'rgba(78,204,163,0.12)', color: '#0F766E', border: '1px solid rgba(78,204,163,0.2)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新对话
      </button>

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
                className="w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-100"
                style={
                  active
                    ? { background: '#ffffff', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }
                    : { background: 'transparent' }
                }
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.5)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p
                    className="min-w-0 flex-1 truncate text-[12px]"
                    style={{ color: active ? '#1e293b' : '#475569', fontWeight: active ? 600 : 500 }}
                  >
                    {conv.title ?? '新对话'}
                  </p>
                  <span className="shrink-0 pt-0.5 text-[10px]" style={{ color: '#94a3b8' }}>
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
