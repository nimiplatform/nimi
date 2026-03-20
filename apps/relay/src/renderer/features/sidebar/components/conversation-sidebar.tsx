// Conversation sidebar — session list with search, time-grouped, agent picker at bottom
// Per design.md §7

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Settings, X } from 'lucide-react';
import { useSessionList, type DateGroup } from '../hooks/use-session-list.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';
import { UserMenu } from '../../../app-shell/components/user-menu.js';
import { AgentPickerPopover } from '../../agent/components/agent-picker-popover.js';

interface ConversationSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onNewChat?: () => void;
  onOpenSettings?: () => void;
}

const groupLabels: Record<DateGroup, string> = {
  today: 'sidebar.today',
  yesterday: 'sidebar.yesterday',
  previous7Days: 'sidebar.previous7Days',
  older: 'sidebar.older',
};

export function ConversationSidebar({
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onOpenSettings,
}: ConversationSidebarProps) {
  const { t } = useTranslation();
  const currentAgent = useAppStore((s) => s.currentAgent);
  const runtimeAvailable = useAppStore((s) => s.runtimeAvailable);
  const realtimeConnected = useAppStore((s) => s.realtimeConnected);
  const { grouped, searchQuery, setSearchQuery } = useSessionList();
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  return (
    <aside
      className="flex flex-col bg-bg-surface border-r border-border-subtle transition-all duration-250 overflow-hidden flex-shrink-0"
      style={{ width: collapsed ? 0 : 260 }}
    >
      {/* New Chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors duration-150"
        >
          <Plus size={16} />
          {t('sidebar.newChat')}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-placeholder" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('sidebar.search')}
            className="w-full bg-bg-elevated border border-border-subtle rounded-lg pl-8 pr-8 py-2 text-[13px] text-text-primary placeholder:text-text-placeholder outline-none focus:border-accent transition-colors duration-150"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2">
        {grouped.length === 0 && (
          <div className="text-center text-text-secondary text-[12px] mt-6 px-2">
            {searchQuery ? t('sidebar.noResults') : t('sidebar.noSessions')}
          </div>
        )}
        {grouped.map(({ group, sessions }) => (
          <div key={group} className="mb-3">
            <div className="px-2 py-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider">
              {t(groupLabels[group])}
            </div>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  onClick={() => onSelectSession?.(session.id)}
                  className={`group w-full text-left px-2 py-2 rounded-lg text-[13px] leading-[1.4] truncate transition-colors duration-150 relative ${
                    isActive
                      ? 'bg-bg-elevated text-text-primary'
                      : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-accent rounded-r" />
                  )}
                  <span className="block truncate pl-1">{session.title || t('sidebar.untitled')}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom fixed area */}
      <div className="border-t border-border-subtle p-3 space-y-2">
        {/* Agent selector */}
        <div className="relative">
          <button
            onClick={() => setAgentPickerOpen(!agentPickerOpen)}
            className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-bg-elevated transition-colors duration-150"
          >
            {currentAgent?.avatarUrl ? (
              <img src={currentAgent.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-bg-elevated flex items-center justify-center text-[11px] font-medium text-text-secondary">
                {currentAgent?.name?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <span className="flex-1 text-[13px] text-text-primary truncate text-left">
              {currentAgent?.name || t('agent.selectAnAgent')}
            </span>
          </button>
          {agentPickerOpen && (
            <AgentPickerPopover onClose={() => setAgentPickerOpen(false)} />
          )}
        </div>

        {/* Status + settings + user */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot active={runtimeAvailable} />
            <StatusDot active={realtimeConnected} />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-150"
            >
              <Settings size={16} />
            </button>
            <UserMenu />
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <div
      className={`w-2 h-2 rounded-full ${active ? 'bg-success' : 'bg-error'}`}
    />
  );
}
