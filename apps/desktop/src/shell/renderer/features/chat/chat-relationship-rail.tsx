import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { IconToggleAction, ScrollArea } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import {
  ProfileDetailModal,
} from '../relationship/profile-detail-modal.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  RelationshipHoverCard,
  buildRelationshipProfileSeed,
  clampHoverCardTop,
  type RelationshipHoverCardPosition,
} from './chat-relationship-hover-card.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRelationshipRailProps = {
  targets: readonly ConversationTargetSummary[];
  selectedTargetId: string | null;
  activeMode: 'ai' | 'human' | 'agent' | 'group';
  onSelectTarget: (targetId: string) => void;
  onCreateGroup?: () => void;
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
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [hoverCardPos, setHoverCardPos] = useState<RelationshipHoverCardPosition | null>(null);
  const [profileTarget, setProfileTarget] = useState<ReturnType<typeof buildRelationshipProfileSeed>>(null);

  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const unread = target.unreadCount && target.unreadCount > 0 ? target.unreadCount : null;
  const profileSeed = buildRelationshipProfileSeed(target);
  const canShowHoverCard = target.source !== 'ai';
  const testId = target.source === 'human'
    ? E2E_IDS.chatRow(String(target.canonicalSessionId || target.id))
    : target.source === 'agent' || target.source === 'ai'
      ? E2E_IDS.chatTarget(String(target.id))
      : undefined;

  useEffect(() => () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
  }, []);

  const cancelHide = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      setHoverCardPos(null);
      hideTimerRef.current = null;
    }, 90);
  };

  const showHoverCard = (top: number) => {
    if (!canShowHoverCard) {
      return;
    }
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setHoverCardPos({
        top: clampHoverCardTop(top),
        right: window.innerWidth - rect.left + 14,
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
    if (!profileSeed) {
      onSelect();
      return;
    }
    cancelHide();
    setHoverCardPos(null);
    setProfileTarget(profileSeed);
  };

  return (
    <>
      <div className="group relative flex h-11 w-full items-center justify-start">
        {/* Selection indicator — Discord-style right pill, outside the avatar */}
        <div
          className={`absolute right-0 w-[3px] rounded-l-full bg-emerald-500 transition-all duration-200 ${
            selected
              ? 'h-8'
              : 'h-0 group-hover:h-4'
          }`}
        />

        {/* Avatar button — offset left to leave space for the pill */}
        <button
          ref={ref}
          type="button"
          data-testid={testId}
          onClick={onSelect}
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={scheduleHide}
          onFocus={handleFocus}
          onBlur={scheduleHide}
          aria-current={selected ? 'page' : undefined}
          className={`relative ml-0.5 flex h-10 w-10 items-center justify-center overflow-hidden transition-all duration-200 ${
            selected ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'
          }`}
          aria-label={`${t('Chat.hoverCardOpenChat', { defaultValue: 'Open chat' })}: ${target.title}`}
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

          {/* Unread badge */}
          {unread ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      </div>

      {canShowHoverCard && hoverCardPos ? (
        <RelationshipHoverCard
          target={target}
          selected={selected}
          pos={hoverCardPos}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onSelect={onSelect}
          onOpenProfile={profileSeed ? handleOpenProfile : undefined}
        />
      ) : null}

      {profileTarget ? (
        <ProfileDetailModal
          open
          profileId={profileTarget.profileId}
          profileSeed={profileTarget.seed}
          onClose={() => setProfileTarget(null)}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function SidebarSeparator() {
  return <div className="mx-auto my-1.5 h-px w-7 rounded-full bg-slate-200/80" />;
}

// ---------------------------------------------------------------------------
// Section label (optional, for source grouping)
// ---------------------------------------------------------------------------

export function ChatRelationshipRail({
  targets,
  selectedTargetId,
  activeMode,
  onSelectTarget,
  onCreateGroup,
  settingsOpen,
  onToggleSettings,
  nimiThreadListOpen,
  onToggleNimiThreadList,
}: ChatRelationshipRailProps) {
  const { t } = useTranslation();
  const aiTargets = targets.filter((t) => t.source === 'ai');
  const humanTargets = targets.filter((t) => t.source === 'human');
  const agentTargets = targets.filter((t) => t.source === 'agent');
  const groupTargets = targets.filter((t) => t.source === 'group');
  const createGroupLabel = t('Chat.createGroupShortcut', { defaultValue: 'New Group' });
  const showNimiThreadToggle = activeMode === 'ai';

  return (
    <aside
      data-testid={E2E_IDS.chatList}
      data-chat-relationship-rail-chrome="transparent"
      className="ml-4 mr-1 flex h-full w-14 shrink-0 flex-col items-center bg-transparent py-2"
    >
      <ScrollArea
        className="w-full flex-1 px-1 py-1"
        viewportClassName="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        contentClassName="flex flex-col items-center gap-1.5"
      >
        {/* AI targets (always visible) */}
        {aiTargets.map((target) => (
          <RelationshipAvatar
            key={target.id}
            target={target}
            selected={selectedTargetId === target.id}
            onSelect={() => onSelectTarget(target.id)}
          />
        ))}

        {/* Human contacts */}
        {humanTargets.length > 0 ? (
          <>
            <SidebarSeparator />
            {humanTargets.map((target) => (
              <RelationshipAvatar
                key={target.id}
                target={target}
                selected={selectedTargetId === target.id}
                onSelect={() => onSelectTarget(target.id)}
              />
            ))}
          </>
        ) : null}

        {/* Source-backed localAgent targets */}
        {agentTargets.length > 0 ? (
          <>
            <SidebarSeparator />
            {agentTargets.map((target) => (
              <RelationshipAvatar
                key={target.id}
                target={target}
                selected={selectedTargetId === target.id}
                onSelect={() => onSelectTarget(target.id)}
              />
            ))}
          </>
        ) : null}

        {onCreateGroup ? (
          <>
            <SidebarSeparator />
            <div className="group relative flex h-11 w-full items-center justify-start">
              <div className="absolute right-0 h-0 w-[3px] rounded-l-full bg-emerald-500 transition-all duration-200 group-hover:h-4" />
              <button
                type="button"
                data-testid={E2E_IDS.chatCreateGroupButton}
                onClick={onCreateGroup}
                aria-label={createGroupLabel}
                title={createGroupLabel}
                className="relative ml-0.5 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white transition-all duration-200 hover:rounded-2xl"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </>
        ) : null}

        {/* Group chats */}
        {groupTargets.length > 0 ? (
          <>
            <SidebarSeparator />
            {groupTargets.map((target) => (
              <RelationshipAvatar
                key={target.id}
                target={target}
                selected={selectedTargetId === target.id}
                onSelect={() => onSelectTarget(target.id)}
              />
            ))}
          </>
        ) : null}
      </ScrollArea>
      <div className="mt-2 flex w-full shrink-0 flex-col items-center gap-2 border-t border-white/70 px-1 pb-1 pt-3">
        {showNimiThreadToggle ? (
          <IconToggleAction
            icon={(
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
            )}
            active={nimiThreadListOpen}
            aria-pressed={nimiThreadListOpen}
            aria-label={t('Chat.toggleNimiThreadList', { defaultValue: 'Toggle Nimi conversations' })}
            title={t('Chat.toggleNimiThreadList', { defaultValue: 'Toggle Nimi conversations' })}
            onClick={onToggleNimiThreadList}
            data-chat-nimi-thread-toggle="true"
            className="h-10 w-10 rounded-2xl"
          />
        ) : null}
        <IconToggleAction
          icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
          active={settingsOpen}
          aria-pressed={settingsOpen}
          aria-label={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
          title={t('Chat.toggleSettings', { defaultValue: 'Toggle settings' })}
          onClick={onToggleSettings}
          data-testid={E2E_IDS.chatSettingsToggle}
          data-chat-settings-toggle="true"
          className="h-10 w-10 rounded-2xl"
        />
      </div>
    </aside>
  );
}
