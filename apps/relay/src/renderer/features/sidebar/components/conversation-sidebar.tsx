// Conversation sidebar — session list with search, time-grouped, agent picker at bottom
// Per design.md §7

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Settings, X } from 'lucide-react';
import { Button, IconButton, SidebarHeader, SidebarItem, SidebarSearch, SidebarSection, SidebarShell, StatusBadge } from '@nimiplatform/nimi-ui';
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
    <SidebarShell
      width={collapsed ? 0 : 260}
      className="overflow-hidden rounded-none border-y-0 border-l-0 border-r"
    >
      <SidebarHeader
        title={<span className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{t('sidebar.sessions', { defaultValue: 'Conversations' })}</span>}
      />
      <div className="px-4 pb-3">
        <Button
          tone="primary"
          fullWidth
          onClick={onNewChat}
          leadingIcon={<Plus size={16} />}
        >
          {t('sidebar.newChat')}
        </Button>
      </div>
      <SidebarSearch
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={() => setSearchQuery('')}
        clearLabel={t('Common.clear', { defaultValue: 'Clear' })}
        placeholder={t('sidebar.search')}
        primaryAction={(
          <IconButton
            tone="ghost"
            icon={collapsed ? <Plus size={16} /> : <Search size={16} />}
            onClick={collapsed ? onNewChat : undefined}
            aria-label={collapsed ? t('sidebar.newChat') : t('sidebar.search')}
          />
        )}
      />
      <div className="flex-1 overflow-y-auto px-2">
        {grouped.length === 0 && (
          <div className="mt-6 px-2 text-center text-[12px] text-[color:var(--nimi-text-muted)]">
            {searchQuery ? t('sidebar.noResults') : t('sidebar.noSessions')}
          </div>
        )}
        {grouped.map(({ group, sessions }) => (
          <SidebarSection key={group} label={t(groupLabels[group])} className="pb-2">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <SidebarItem
                  key={session.id}
                  kind="entity-row"
                  active={isActive}
                  onClick={() => onSelectSession?.(session.id)}
                  label={session.title || t('sidebar.untitled')}
                />
              );
            })}
          </SidebarSection>
        ))}
      </div>

      <div className="space-y-2 border-t border-[color:var(--nimi-border-subtle)] p-3">
        <div className="relative">
          <Button
            onClick={() => setAgentPickerOpen(!agentPickerOpen)}
            tone="secondary"
            fullWidth
            className="justify-start"
            leadingIcon={
              currentAgent?.avatarUrl ? (
                <img src={currentAgent.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-elevated text-[11px] font-medium text-text-secondary">
                  {currentAgent?.name?.charAt(0).toUpperCase() || '?'}
                </span>
              )
            }
          >
            <span className="flex-1 truncate text-left text-[13px] text-[color:var(--nimi-text-primary)]">
              {currentAgent?.name || t('agent.selectAnAgent')}
            </span>
          </Button>
          {agentPickerOpen && (
            <AgentPickerPopover onClose={() => setAgentPickerOpen(false)} />
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge tone={runtimeAvailable ? 'success' : 'danger'}>
              {t('runtime.runtime', { defaultValue: 'Runtime' })}
            </StatusBadge>
            <StatusBadge tone={realtimeConnected ? 'success' : 'danger'}>
              {t('sidebar.realtime', { defaultValue: 'Realtime' })}
            </StatusBadge>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              onClick={onOpenSettings}
              icon={<Settings size={16} />}
              aria-label={t('sidebar.settings', { defaultValue: 'Settings' })}
            />
            <IconButton
              onClick={onToggleCollapse}
              icon={<X size={16} />}
              aria-label={t('sidebar.collapse', { defaultValue: 'Collapse sidebar' })}
            />
            <UserMenu />
          </div>
        </div>
      </div>
    </SidebarShell>
  );
}
