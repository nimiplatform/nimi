import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { DesktopIconToggleAction } from '@renderer/components/action';
import {
  ContactDetailProfileModal,
  type ContactDetailProfileSeed,
} from '@renderer/features/contacts/contact-detail-profile-modal.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatContactsSidebarProps = {
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
// Hover card
// ---------------------------------------------------------------------------

type ContactHoverCardPosition = {
  top: number;
  right: number;
};

function clampHoverCardTop(top: number): number {
  const minTop = 78;
  const maxTop = Math.max(minTop, window.innerHeight - 78);
  return Math.min(Math.max(top, minTop), maxTop);
}

function getSourceLabel(source: ConversationTargetSummary['source'], t: TFunction): string {
  switch (source) {
    case 'ai':
      return t('Chat.hoverCardAi', { defaultValue: 'AI' });
    case 'agent':
      return t('Chat.hoverCardAgent', { defaultValue: 'Agent' });
    case 'group':
      return t('Chat.hoverCardGroup', { defaultValue: 'Group' });
    case 'human':
    default:
      return t('Chat.hoverCardHuman', { defaultValue: 'Human' });
  }
}

function getIdentityLabel(target: ConversationTargetSummary, sourceLabel: string): string {
  if (target.handle) {
    return target.handle.replace(/^@+/, '');
  }
  if (target.source === 'ai') {
    return 'nimi';
  }
  const fallbackId = String(target.canonicalSessionId || target.id || '').trim();
  if (fallbackId) {
    return fallbackId;
  }
  return sourceLabel;
}

function getProfileOpenLabel(source: ConversationTargetSummary['source'], title: string, t: TFunction): string {
  const action = source === 'agent'
    ? t('Chat.composerAvatarOpenAgent', { defaultValue: 'Open agent profile' })
    : t('Chat.composerAvatarOpenContact', { defaultValue: 'Open profile' });
  return `${action}: ${title}`;
}

function getMetadataText(target: ConversationTargetSummary, key: string): string {
  const value = target.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parseRealmAgentIdFromLocalRef(localAgentRef: string): string {
  const parts = localAgentRef.split(':');
  return parts.length >= 3 && parts[0] === 'local-agent' ? parts.slice(2).join(':').trim() : '';
}

function resolveProfileTargetId(target: ConversationTargetSummary): string {
  if (target.source === 'human') {
    return getMetadataText(target, 'otherUserId') || target.id;
  }
  if (target.source !== 'agent') {
    return '';
  }
  return getMetadataText(target, 'realmAgentId')
    || parseRealmAgentIdFromLocalRef(target.id)
    || target.handle?.replace(/^@/, '').trim()
    || '';
}

function buildContactProfileSeed(target: ConversationTargetSummary): { profileId: string; seed: ContactDetailProfileSeed } | null {
  if (target.source !== 'human' && target.source !== 'agent') {
    return null;
  }
  const profileId = resolveProfileTargetId(target).trim();
  if (!profileId) {
    return null;
  }
  const ownershipType = getMetadataText(target, 'ownershipType');
  return {
    profileId,
    seed: {
      id: profileId,
      displayName: target.title,
      handle: target.handle?.replace(/^@/, '').trim() || '',
      avatarUrl: target.avatarUrl || null,
      bio: target.bio || null,
      isAgent: target.source === 'agent',
      isOnline: target.isOnline ?? undefined,
      worldName: getMetadataText(target, 'worldName') || null,
      agentOwnershipType: ownershipType || null,
    },
  };
}

function getSourceIcon(source: ConversationTargetSummary['source']) {
  switch (source) {
    case 'agent':
      return {
        className: 'border-emerald-200/80 bg-emerald-50/70 text-emerald-500 shadow-[0_8px_20px_rgba(16,185,129,0.14)]',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.5l1.45 4.05L17.5 9l-4.05 1.45L12 14.5l-1.45-4.05L6.5 9l4.05-1.45L12 3.5z" />
            <path d="M18.5 13.5l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75.75-2.25z" />
          </svg>
        ),
      };
    case 'group':
      return {
        className: 'border-rose-200/80 bg-rose-50/70 text-rose-500 shadow-[0_8px_20px_rgba(244,63,94,0.12)]',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 20a4 4 0 0 0-8 0" />
            <circle cx="12" cy="10" r="3" />
            <path d="M4 18a3 3 0 0 1 4-2.83" />
            <path d="M20 18a3 3 0 0 0-4-2.83" />
            <path d="M6.5 11.5a2 2 0 1 1 1.8-2.87" />
            <path d="M17.5 11.5a2 2 0 1 0-1.8-2.87" />
          </svg>
        ),
      };
    case 'ai':
      return {
        className: 'border-sky-200/80 bg-sky-50/70 text-sky-500 shadow-[0_8px_20px_rgba(14,165,233,0.14)]',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M4.93 4.93l2.83 2.83" />
            <path d="M16.24 16.24l2.83 2.83" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
            <path d="M4.93 19.07l2.83-2.83" />
            <path d="M16.24 7.76l2.83-2.83" />
          </svg>
        ),
      };
    case 'human':
    default:
      return {
        className: 'border-violet-200/80 bg-violet-50/70 text-violet-500 shadow-[0_8px_20px_rgba(139,92,246,0.14)]',
        icon: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21a8 8 0 0 0-16 0" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ),
      };
  }
}

function ContactHoverCard({
  target,
  selected,
  pos,
  onMouseEnter,
  onMouseLeave,
  onSelect,
  onOpenProfile,
}: {
  target: ConversationTargetSummary;
  selected: boolean;
  pos: ContactHoverCardPosition;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelect: () => void;
  onOpenProfile?: () => void;
}) {
  const { t } = useTranslation();
  const sourceLabel = getSourceLabel(target.source, t);
  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const identity = getIdentityLabel(target, sourceLabel);
  const sourceIcon = getSourceIcon(target.source);
  const preview = target.previewText || target.bio || t('Chat.hoverCardNoPreview', { defaultValue: 'No recent message' });
  const avatarClassName = 'h-[74px] w-[74px] shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-slate-100 to-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.85),0_12px_28px_rgba(15,23,42,0.13)]';
  const avatarContent = target.avatarUrl ? (
    <img src={target.avatarUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <div
      className={`flex h-full w-full items-center justify-center text-xl font-semibold text-white ${
        target.source === 'ai'
          ? 'bg-gradient-to-br from-sky-400 to-teal-500'
          : target.source === 'agent'
            ? 'bg-gradient-to-br from-emerald-400 to-teal-600'
            : target.source === 'group'
              ? 'bg-gradient-to-br from-pink-400 to-rose-500'
              : 'bg-gradient-to-br from-violet-400 to-indigo-500'
      }`}
    >
      {initial}
    </div>
  );

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      data-chat-contact-hover-card="true"
      role="button"
      tabIndex={0}
      aria-label={`${t('Chat.hoverCardOpenChat', { defaultValue: 'Open chat' })}: ${target.title}`}
      className="nimi-material-glass-chrome group fixed z-[9999] w-[min(430px,calc(100vw-96px))] overflow-hidden rounded-[22px] border border-white/75 bg-white/82 px-5 py-4 text-left shadow-[0_22px_70px_rgba(80,95,130,0.2)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] transition duration-200 hover:border-white hover:bg-white/88 hover:shadow-[0_24px_76px_rgba(80,95,130,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
      style={{ top: pos.top, right: pos.right, transform: 'translateY(-50%)' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onSelect}
      onKeyDown={handleCardKeyDown}
    >
      <span
        aria-hidden="true"
        className={`absolute right-1.5 top-1/2 w-1 rounded-full bg-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.36)] transition-all duration-200 ${
          selected ? 'h-[92px] -translate-y-1/2 opacity-100' : 'h-0 -translate-y-1/2 opacity-0'
        }`}
      />
      <div className="flex min-w-0 items-center gap-4 pr-14">
        {onOpenProfile ? (
          <button
            type="button"
            aria-label={getProfileOpenLabel(target.source, target.title, t)}
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile();
            }}
            className={`${avatarClassName} transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80`}
          >
            {avatarContent}
          </button>
        ) : (
          <div className={avatarClassName}>
            {avatarContent}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 truncate text-[23px] font-semibold leading-7 tracking-normal text-slate-950">
            {target.title}
          </h3>
          <div className="mt-1 truncate text-[15px] font-medium leading-5 text-slate-500">
            {identity}
          </div>
          <div className="mt-4 flex min-w-0 items-center gap-2 text-[15px] leading-5 text-slate-500">
            <span className="shrink-0 font-semibold text-slate-600">
              {t('Chat.hoverCardLast', { defaultValue: 'Last:' })}
            </span>
            <span className="min-w-0 flex-1 truncate">{preview}</span>
          </div>
        </div>
        <span
          role="img"
          aria-label={sourceLabel}
          title={sourceLabel}
          className={`absolute right-8 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-2xl border ${sourceIcon.className}`}
        >
          {sourceIcon.icon}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single contact avatar button
// ---------------------------------------------------------------------------

function ContactAvatar({
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
  const [hoverCardPos, setHoverCardPos] = useState<ContactHoverCardPosition | null>(null);
  const [profileTarget, setProfileTarget] = useState<ReturnType<typeof buildContactProfileSeed>>(null);

  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const unread = target.unreadCount && target.unreadCount > 0 ? target.unreadCount : null;
  const profileSeed = buildContactProfileSeed(target);
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
        <ContactHoverCard
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
        <ContactDetailProfileModal
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

export function ChatContactsSidebar({
  targets,
  selectedTargetId,
  activeMode,
  onSelectTarget,
  onCreateGroup,
  settingsOpen,
  onToggleSettings,
  nimiThreadListOpen,
  onToggleNimiThreadList,
}: ChatContactsSidebarProps) {
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
      data-chat-contacts-sidebar-chrome="transparent"
      className="ml-4 mr-1 flex h-full w-14 shrink-0 flex-col items-center bg-transparent py-2"
    >
      <ScrollArea
        className="w-full flex-1 px-1 py-1"
        viewportClassName="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        contentClassName="flex flex-col items-center gap-1.5"
      >
        {/* AI targets (always visible) */}
        {aiTargets.map((target) => (
          <ContactAvatar
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
              <ContactAvatar
                key={target.id}
                target={target}
                selected={selectedTargetId === target.id}
                onSelect={() => onSelectTarget(target.id)}
              />
            ))}
          </>
        ) : null}

        {/* Agent friends */}
        {agentTargets.length > 0 ? (
          <>
            <SidebarSeparator />
            {agentTargets.map((target) => (
              <ContactAvatar
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
              <ContactAvatar
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
          <DesktopIconToggleAction
            icon={(
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M8 8h8M8 12h8M8 16h5" />
              </svg>
            )}
            active={nimiThreadListOpen}
            aria-label={t('Chat.toggleNimiThreadList', { defaultValue: 'Toggle Nimi conversations' })}
            title={t('Chat.toggleNimiThreadList', { defaultValue: 'Toggle Nimi conversations' })}
            onClick={onToggleNimiThreadList}
            data-chat-nimi-thread-toggle="true"
            className="h-10 w-10 rounded-2xl"
          />
        ) : null}
        <DesktopIconToggleAction
          icon={(
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
          active={settingsOpen}
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
