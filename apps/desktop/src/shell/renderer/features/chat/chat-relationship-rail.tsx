import { ChatHumanAvatarCard } from './chat-human-avatar-card.js';
import { ContactRound, History, Settings2 } from 'lucide-react';
import { useReceivedFriendRequests } from '../relationship/human-contact-data.js';
import './chat-relationship-rail.css';
import { visibleChatRailTargets } from './chat-sidebar-targets.js';
import { useHumanChatList } from './use-human-chat-list.js';
import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { useEffect, useRef } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { IconButton, IconToggleAction } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useAppStore } from '../../app-shell/providers/app-store.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRelationshipRailProps = {
  targets: readonly ConversationTargetSummary[];
  selectedTargetId: string | null;
  activeMode: 'ai' | 'human' | 'agent';
  onSelectTarget: (targetId: string) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  nimiThreadListOpen: boolean;
  onToggleNimiThreadList: () => void;
};

// ---------------------------------------------------------------------------
// Single contact avatar button
// ---------------------------------------------------------------------------

function RelationshipAvatar({ target, selected, onSelect }: { target: ConversationTargetSummary; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const id = normalizeText(target.metadata?.otherUserId) || target.id;
  const unread = target.unreadCount || 0;
  const label = `${t('Chat.hoverCardOpenChat')}: ${target.title}${unread ? ` · ${t('Relationship.contacts.unreadMessages', { count: unread })}` : ''}`;
  return <div className="group relative flex h-11 w-full items-center justify-center">
    <div aria-hidden className={`absolute right-0 w-[3px] rounded-l-full bg-[var(--nimi-action-primary-bg)] transition-all ${selected ? 'h-8' : 'h-0 group-hover:h-4'}`} />
    <ChatHumanAvatarCard person={{ id, name: target.title, handle: target.handle, avatarUrl: target.avatarUrl, deleted: target.metadata?.isDeleted === true }} placement="rail" onSelect={onSelect}>
      <button type="button" data-testid={E2E_IDS.chatRow(String(target.canonicalSessionId || target.id))} aria-label={label} aria-current={selected ? 'page' : undefined}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
        <span className={`flex h-10 w-10 items-center justify-center overflow-hidden bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)] ${selected ? 'rounded-2xl' : 'rounded-full'}`}>
          {target.avatarUrl ? <img src={target.avatarUrl} alt="" className="h-full w-full object-cover" /> : <span>{(target.avatarFallback || target.title || '?').charAt(0)}</span>}
        </span>
        {unread ? <span aria-hidden className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--nimi-status-danger)] px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
    </ChatHumanAvatarCard>
  </div>;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function ChatRelationshipRail({
  targets, selectedTargetId, activeMode, onSelectTarget,
  settingsOpen, onToggleSettings, nimiThreadListOpen, onToggleNimiThreadList,
}: ChatRelationshipRailProps) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const authStatus = useAppStore(state => state.auth.status);
  const humanChats = useHumanChatList(authStatus);
  const requests = useReceivedFriendRequests();
  const requestCount = requests.data?.pages[0]?.total ?? 0;
  const position = useHomeDestination().chat;
  const contactsOpen = activeMode === 'human' && !position?.targetId && !position?.threadId && position?.contactsSection !== 'conversations';
  const humanSide = activeMode === 'human';
  const visible = humanSide ? visibleChatRailTargets(targets, true) : [];
  const listRef = useRef<HTMLDivElement>(null);
  const visibleSelectedId = visible.find(target => target.id === selectedTargetId)?.id;
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [visibleSelectedId, humanSide]);
  const openContacts = (contactsSection: 'friends' | 'conversations') => {
    void navigation.push({ id: 'friends', chat: { mode: 'human', contactsSection } });
  };
  return <aside data-testid={E2E_IDS.chatList} data-chat-relationship-rail-chrome="transparent"
    data-chat-side={humanSide ? 'human' : 'companion'}
    className="absolute right-4 top-0 z-10 flex h-full w-14 flex-col items-center bg-transparent pb-4 pt-5">
    <div ref={listRef} className="mt-4 min-h-0 w-full flex-1 overflow-y-auto">
      <div key={humanSide ? 'human' : 'companion'} className="chat-side-entry flex flex-col items-center gap-2" data-side={humanSide ? 'human' : 'companion'}>
        {visible.map(target => <RelationshipAvatar key={target.id} target={target} selected={selectedTargetId === target.id} onSelect={() => onSelectTarget(target.id)} />)}
      </div>
    </div>
    {humanSide || activeMode === 'ai' ? <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-[var(--nimi-border-subtle)] pt-3" data-chat-rail-footer="true">
      {humanSide ? <div key="human" className="flex w-full shrink-0 flex-col items-center gap-1" data-side="human">
        <div className="relative">
          <IconToggleAction icon={<ContactRound size={21} />}
            active={contactsOpen}
            aria-label={t('Relationship.contacts.title')}
            title={t('Relationship.contacts.title')}
            onClick={() => openContacts('friends')}
            data-testid="human-contacts-entry" className="h-11 w-11 rounded-2xl" />
          {requestCount > 0 ? <span className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-[var(--nimi-status-danger)] px-1.5 text-[10px] font-semibold tabular-nums text-white">{requestCount > 99 ? '99+' : requestCount}</span> : null}
        </div>
        <span className="whitespace-nowrap text-[10px] font-medium text-[var(--nimi-text-secondary)]">{t('Relationship.contacts.title')}</span>
      </div> : null}
      {humanSide && humanChats.isError ? <button type="button" className="rounded px-1 py-1 text-xs text-[var(--nimi-text-secondary)]" onClick={() => { void humanChats.refetch(); }}>{t('Common.retry')}</button> : null}
      {activeMode === 'ai' ? <IconToggleAction icon={<History size={18} />} active={nimiThreadListOpen} aria-pressed={nimiThreadListOpen}
        aria-label={t('Chat.toggleNimiThreadList')} title={t('Chat.toggleNimiThreadList')} onClick={onToggleNimiThreadList} data-chat-nimi-thread-toggle="true" className="h-10 w-10 rounded-2xl" /> : null}
      {activeMode === 'ai' ? <IconToggleAction icon={<Settings2 size={18} />} active={settingsOpen} aria-pressed={settingsOpen}
        aria-label={t('Chat.toggleSettings')} title={t('Chat.toggleSettings')} onClick={onToggleSettings} data-testid={E2E_IDS.chatSettingsToggle} data-chat-settings-toggle="true" className="h-10 w-10 rounded-2xl" /> : null}
    </div> : null}
  </aside>;
}
