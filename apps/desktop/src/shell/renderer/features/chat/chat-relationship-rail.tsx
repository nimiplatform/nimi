import { Rotate3d, ContactRound, History, Settings2 } from 'lucide-react';
import { useReceivedFriendRequests } from '../relationship/human-contact-data.js';
import './chat-relationship-rail.css';
import { useHumanChatList } from './use-human-chat-list.js';
import { useHomeNavigation, useHomeDestination } from '../../app-shell/providers/app-store.js';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { IconButton, IconToggleAction } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  RelationshipHoverCard,
  buildRelationshipProfileNavigationTarget,
  clampHoverCardTop,
  type RelationshipHoverCardPosition,
} from './chat-relationship-hover-card.js';
import { useRelationshipHoverCardSubtitle } from './chat-relationship-hover-subtitle.js';
import { resolveAgentTargetSourceRef } from '../agents/agent-conversation-source-resolution.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
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

function RelationshipAvatar({
  target,
  selected,
  onSelect,
}: {
  target: ConversationTargetSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const navigation = useHomeNavigation();
  const bindings = useDesktopRendererBindings();

  const ownerUserId = useAppStore((state) => normalizeText(state.auth.user?.id));
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const cancelHideRef = useRef<(() => void) | null>(null);
  const profileOpenPendingRef = useRef(false);
  const [hoverCardPos, setHoverCardPos] = useState<RelationshipHoverCardPosition | null>(null);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const hoverCardVisible = hoverCardPos !== null;
  useEffect(() => {
    if (!hoverCardVisible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      cancelHideRef.current?.();
      cancelHideRef.current = null;
      if (hoverCardRef.current?.contains(document.activeElement)) {
        ref.current?.focus({ preventScroll: true });
      }
      setHoverCardPos(null);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [hoverCardVisible]);
  // The character subtitle resolves lazily only while the hover card is visible.
  const hoverCardSubtitle = useRelationshipHoverCardSubtitle({
    target,
    enabled: Boolean(hoverCardPos),
  });

  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const deselectAgent = selected && target.source === 'agent';
  const avatarActionLabel = deselectAgent
    ? t('Chat.rail.deselectCompanion', { name: target.title })
    : `${t('Chat.hoverCardOpenChat', { defaultValue: 'Open chat' })}: ${target.title}`;
  const unread = target.unreadCount && target.unreadCount > 0 ? target.unreadCount : null;
  const profileTarget = buildRelationshipProfileNavigationTarget(target);
  const canShowHoverCard = target.source !== 'ai';
  // Sidebar agent references carry no source identity; the character profile
  // opens through an on-demand owner-scope resolution on click instead.
  const canResolveAgentProfile = target.source === 'agent'
    && Boolean(normalizeText(target.metadata?.agentHandle));
  const testId = target.source === 'human'
    ? E2E_IDS.chatRow(String(target.canonicalSessionId || target.id))
    : target.source === 'agent' || target.source === 'ai'
      ? E2E_IDS.chatTarget(String(target.id))
      : undefined;

  useEffect(() => () => {
    cancelHideRef.current?.();
    cancelHideRef.current = null;
  }, [bindings.clock]);

  const cancelHide = () => {
    cancelHideRef.current?.();
    cancelHideRef.current = null;
  };

  const scheduleHide = () => {
    cancelHide();
    cancelHideRef.current = bindings.clock.schedule(90, () => {
      setHoverCardPos(null);
      cancelHideRef.current = null;
    });
  };

  const showHoverCard = (top: number) => {
    if (!canShowHoverCard) {
      return;
    }
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setHoverCardPos({
        top: clampHoverCardTop(top),
        right: bindings.app.projection.viewportWidth() - rect.left + 14,
      });
    }
  };

  const handleMouseEnter = () => {
    cancelHide();
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      showHoverCard(rect.top + rect.height / 2);
    }
  };

  const handleMouseMove = (event: MouseEvent<HTMLButtonElement>) => {
    cancelHide();
    showHoverCard(event.clientY);
  };

  const handleFocus = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      showHoverCard(rect.top + rect.height / 2);
    }
  };

  const handleOpenProfile = () => {
    if (!profileTarget && !canResolveAgentProfile) {
      onSelect();
      return;
    }
    cancelHide();
    setHoverCardPos(null);
    if (profileTarget) {
      if (profileTarget.kind === 'character') {
        navigation.push({ id: 'source-detail', sourceRef: profileTarget.sourceRef });
        return;
      }
      navigation.push({ id: 'profile', profileId: profileTarget.profileId });
      return;
    }
    if (profileOpenPendingRef.current) {
      return;
    }
    profileOpenPendingRef.current = true;
    void resolveAgentTargetSourceRef({
      agentHandle: normalizeText(target.metadata?.agentHandle),
      ownerUserId,
      sdk: bindings.sdk,
    }).then((sourceRef) => {
      if (sourceRef) {
        navigation.push({ id: 'source-detail', sourceRef: sourceRef });
        return;
      }
      onSelect();
    }).catch((error: unknown) => {
      logRendererEvent({
        level: 'warn',
        area: 'chat',
        message: 'action:relationship-hover-card-open-profile:failed',
        details: { error: error instanceof Error ? error.message : String(error || '') },
      });
      onSelect();
    }).finally(() => {
      profileOpenPendingRef.current = false;
    });
  };

  return (
    <>
      <div className="group relative flex h-11 w-full items-center justify-center">
        {/* Selection indicator — Discord-style right pill, outside the avatar */}
        <div
          className={`absolute right-0 w-[3px] rounded-l-full bg-[var(--nimi-action-primary-bg)] transition-all duration-200 ${
            selected
              ? 'h-8'
              : 'h-0 group-hover:h-4'
          }`}
        />

        {/* Keep the hit target centered; the selection pill stays at the edge. */}
        <button
          ref={ref}
          type="button"
          data-testid={testId}
          onClick={() => {
            if (!deselectAgent) { onSelect(); return; }
            cancelHide(); setHoverCardPos(null);
            void navigation.push({ id: 'chat', chat: { mode: 'ai', targetId: 'ai:assistant' } });
          }}
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={scheduleHide}
          onFocus={handleFocus}
          onBlur={scheduleHide}
          aria-current={selected ? 'page' : undefined}
          aria-pressed={target.source === 'agent' ? selected : undefined}
          className="relative flex h-11 w-11 items-center justify-center"
          aria-label={avatarActionLabel}
          title={deselectAgent ? avatarActionLabel : undefined}
        >
          {/* Rounded clipping stays on the inner wrapper so the unread badge is not clipped. */}
          <div
            className={`flex h-10 w-10 items-center justify-center overflow-hidden transition-all duration-200 ${
              selected ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'
            }`}
          >
            {target.avatarUrl ? (
              <img
                src={target.avatarUrl}
                alt={target.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                className={`flex h-full w-full items-center justify-center text-sm font-semibold ${
                  target.source === 'ai'
                    ? 'bg-gradient-to-br from-sky-400 to-teal-500 text-white'
                    : target.source === 'agent'
                      ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white'
                      : 'bg-gradient-to-br from-violet-400 to-indigo-500 text-white'
                }`}
              >
                {initial}
              </div>
            )}
          </div>

          {/* Unread badge */}
          {unread ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--nimi-status-danger)] px-1 text-[10px] font-bold text-white shadow-sm">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      </div>

      {canShowHoverCard && hoverCardPos ? (
        <RelationshipHoverCard
          elementRef={hoverCardRef}
          target={target}
          pos={hoverCardPos}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onSelect={onSelect}
          onOpenProfile={profileTarget || canResolveAgentProfile ? handleOpenProfile : undefined}
          subtitle={hoverCardSubtitle}
        />
      ) : null}
    </>
  );
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
  const recent = targets.filter(target => humanSide
    ? target.source === 'human' && Boolean(target.canonicalSessionId)
    : target.source === 'agent');
  const [limit, setLimit] = useState(7);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setLimit(Math.max(1, Math.min(7, Math.floor(element.clientHeight / 52)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const selected = recent.find(target => target.id === selectedTargetId);
  const visible = recent.slice(0, limit);
  if (selected && !visible.includes(selected)) visible[visible.length - 1] = selected;
  const otherUnread = targets.filter(target => humanSide ? target.source !== 'human' : target.source === 'human')
    .reduce((count, target) => count + (target.unreadCount ?? 0), humanSide ? 0 : requestCount);
  const flipLabel = t(humanSide ? 'Chat.rail.switchToCompanions' : 'Chat.rail.switchToPeople');
  const openContacts = (contactsSection: 'friends' | 'conversations') => {
    void navigation.push({ id: 'chat', chat: { mode: 'human', contactsSection } });
  };
  return <aside data-testid={E2E_IDS.chatList} data-chat-relationship-rail-chrome="transparent"
    data-chat-side={humanSide ? 'human' : 'companion'}
    className="absolute right-4 top-0 z-10 flex h-full w-14 flex-col items-center bg-transparent pb-4 pt-5">
    <div className="relative flex shrink-0 flex-col items-center gap-1 pb-4">
      <IconButton tone="ghost" icon={<span className="chat-side-flip" data-side={humanSide ? 'human' : 'companion'} aria-hidden="true">
        <Rotate3d size={29} strokeWidth={1.55} />
      </span>} aria-label={flipLabel} title={flipLabel} data-testid="chat-side-flip"
        onClick={() => { void navigation.switchChatSide(humanSide ? 'companion' : 'human'); }}
        className="chat-side-toggle h-11 w-11 rounded-full" />
      {otherUnread > 0 ? <span className="absolute -right-1 top-6 h-2.5 w-2.5 rounded-full bg-[var(--nimi-status-danger)] ring-2 ring-[var(--nimi-surface-canvas)]" role="status" aria-label={t('Chat.rail.otherUnread', { count: otherUnread })} /> : null}
      <span className="whitespace-nowrap text-[10px] font-medium text-[var(--nimi-text-secondary)]" aria-live="polite">{t(humanSide ? 'Chat.rail.people' : 'Chat.rail.companions')}</span>
    </div>
    <div ref={listRef} className="mt-4 min-h-0 w-full flex-1 overflow-hidden">
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
      {activeMode === 'ai' || humanSide && selectedTargetId ? <IconToggleAction icon={<Settings2 size={18} />} active={settingsOpen} aria-pressed={settingsOpen}
        aria-label={t('Chat.toggleSettings')} title={t('Chat.toggleSettings')} onClick={onToggleSettings} data-testid={E2E_IDS.chatSettingsToggle} data-chat-settings-toggle="true" className="h-10 w-10 rounded-2xl" /> : null}
    </div> : null}
  </aside>;
}
