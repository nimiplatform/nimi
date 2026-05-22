import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { DesktopIconToggleAction } from '@renderer/components/action';
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

function formatRelativeShort(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return 'now';
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) {
    return `${deltaDays}d`;
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

function ContactHoverCard({
  target,
  pos,
  onMouseEnter,
  onMouseLeave,
  onSelect,
}: {
  target: ConversationTargetSummary;
  pos: ContactHoverCardPosition;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const sourceLabel = getSourceLabel(target.source, t);
  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const handle = target.handle || (target.source === 'ai' ? '@nimi' : sourceLabel);
  const preview = target.previewText || target.bio || t('Chat.hoverCardNoPreview', { defaultValue: 'No recent message' });
  const relativeTime = formatRelativeShort(target.updatedAt);

  return (
    <div
      data-chat-contact-hover-card="true"
      className="fixed z-[9999] w-[min(420px,calc(100vw-96px))] rounded-[22px] border border-white/70 bg-white/78 p-4 text-left shadow-[0_22px_70px_rgba(80,95,130,0.22)] backdrop-blur-2xl"
      style={{ top: pos.top, right: pos.right, transform: 'translateY(-50%)' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-slate-100 to-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8),0_10px_24px_rgba(15,23,42,0.12)]">
          {target.avatarUrl ? (
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
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-[22px] font-semibold leading-7 text-slate-950">
              {target.title}
            </h3>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50/90 px-2.5 py-1 text-sm font-medium leading-none text-slate-500">
              {sourceLabel}
            </span>
          </div>
          <div className="mt-1 truncate text-[15px] font-medium text-slate-500">
            {handle}
          </div>
          <div className="mt-5 flex min-w-0 items-center gap-2 text-[15px] leading-5 text-slate-500">
            <span className="shrink-0 font-semibold text-slate-600">
              {t('Chat.hoverCardLast', { defaultValue: 'Last:' })}
            </span>
            <span className="min-w-0 flex-1 truncate">{preview}</span>
            {relativeTime ? <span className="shrink-0 pl-2 text-slate-500">{relativeTime}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 self-start pt-1">
          <button
            type="button"
            aria-label={t('Chat.hoverCardOpenChat', { defaultValue: 'Open chat' })}
            onClick={onSelect}
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.07)] transition-colors hover:border-emerald-200 hover:text-emerald-600"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={t('Chat.hoverCardOpenProfile', { defaultValue: 'Open profile' })}
            onClick={onSelect}
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/80 text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.07)] transition-colors hover:border-emerald-200 hover:text-emerald-600"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21a8 8 0 0 0-16 0" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>
        </div>
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
  const ref = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [hoverCardPos, setHoverCardPos] = useState<ContactHoverCardPosition | null>(null);

  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const unread = target.unreadCount && target.unreadCount > 0 ? target.unreadCount : null;
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
          aria-label={target.title}
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

      {hoverCardPos ? (
        <ContactHoverCard
          target={target}
          pos={hoverCardPos}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onSelect={onSelect}
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
