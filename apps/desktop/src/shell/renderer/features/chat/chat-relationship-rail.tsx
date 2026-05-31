import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { parseRuntimeLocalAgentIdentity } from '@nimiplatform/sdk/runtime';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import {
  ProfileDetailModal,
  type ProfileDetailSeed,
} from '@renderer/features/relationship/profile-detail-modal.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

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
// Hover card
// ---------------------------------------------------------------------------

type RelationshipHoverCardPosition = {
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
  try {
    return parseRuntimeLocalAgentIdentity(localAgentRef).realmAgentId;
  } catch {
    return '';
  }
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

function buildRelationshipProfileSeed(target: ConversationTargetSummary): { profileId: string; seed: ProfileDetailSeed } | null {
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

function AgentSparkleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l1.45 4.05L17.5 9l-4.05 1.45L12 14.5l-1.45-4.05L6.5 9l4.05-1.45L12 3.5z" />
      <path d="M18.5 13.5l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75.75-2.25z" />
    </svg>
  );
}

function RelationshipHoverCard({
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
  pos: RelationshipHoverCardPosition;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelect: () => void;
  onOpenProfile?: () => void;
}) {
  const { t } = useTranslation();
  const sourceLabel = getSourceLabel(target.source, t);
  const identity = getIdentityLabel(target, sourceLabel);
  const preview = target.previewText || target.bio || t('Chat.hoverCardNoPreview', { defaultValue: 'No recent message' });
  const isAgent = target.source === 'agent';
  const agentPillLabel = t('Chat.hoverCardAgent', { defaultValue: 'Agent' });

  const avatarVisual = isAgent ? (
    <EntityAvatar
      imageUrl={target.avatarUrl || null}
      name={target.avatarFallback || target.title || '?'}
      kind="agent"
      sizeClassName="h-[74px] w-[74px]"
      textClassName="text-xl font-semibold"
    />
  ) : (
    <EntityAvatar
      imageUrl={target.avatarUrl || null}
      name={target.avatarFallback || target.title || '?'}
      kind="human"
      sizeClassName="h-[74px] w-[74px]"
      textClassName="text-xl font-semibold"
    />
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
      <div className="flex min-w-0 items-center gap-4">
        {onOpenProfile ? (
          <button
            type="button"
            aria-label={getProfileOpenLabel(target.source, target.title, t)}
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile();
            }}
            className="shrink-0 rounded-[12px] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
          >
            {avatarVisual}
          </button>
        ) : (
          <div className="shrink-0">
            {avatarVisual}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-[23px] font-semibold leading-7 tracking-normal text-slate-950">
              {target.title}
            </h3>
            {isAgent ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-violet-700"
                aria-label={agentPillLabel}
                title={agentPillLabel}
              >
                <AgentSparkleIcon className="h-3 w-3" />
                {agentPillLabel}
              </span>
            ) : null}
          </div>
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
      </div>
    </div>
  );
}

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

        {/* Agent friends */}
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
