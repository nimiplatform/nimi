import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChatHumanAvatarCard } from './chat-human-avatar-card.js';
import { RealmHumanAvatar } from './realm-human-avatar.js';
import { ChatPartnerAvatarCard } from './chat-partner-avatar-card.js';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import './chat-relationship-rail.css';
import { ChevronsRight, ContactRound, History, Rotate3d, Settings2 } from 'lucide-react';
import { AppCardSurface, IconButton, IconToggleAction, NimiTabs, ScrollArea, Tooltip } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion.js';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function ChatRelationshipRail({ settingsOpen, nimiThreadListOpen, onToggleSettings, onToggleNimiThreadList }: {
  settingsOpen: boolean;
  nimiThreadListOpen: boolean;
  onToggleSettings: () => void;
  onToggleNimiThreadList: () => void;
}) {
  const { t } = useTranslation();
  return <aside data-testid={E2E_IDS.chatList} data-chat-relationship-rail-chrome="transparent"
    className="absolute right-4 top-0 z-10 flex h-full w-14 flex-col justify-end bg-transparent pb-4 pt-5">
    <div className="flex w-full flex-col items-center gap-1 border-t border-[var(--nimi-border-subtle)] pt-3" data-chat-rail-footer="true">
      <IconToggleAction icon={<History size={18} />} active={nimiThreadListOpen} aria-pressed={nimiThreadListOpen}
        aria-label={t('Chat.toggleNimiThreadList')} title={t('Chat.toggleNimiThreadList')} onClick={onToggleNimiThreadList}
        data-chat-nimi-thread-toggle="true" className="h-10 w-10 rounded-xl" />
      <IconToggleAction icon={<Settings2 size={18} />} active={settingsOpen} aria-pressed={settingsOpen}
        aria-label={t('Chat.toggleSettings')} title={t('Chat.toggleSettings')} onClick={onToggleSettings}
        data-testid={E2E_IDS.chatSettingsToggle} className="h-10 w-10 rounded-xl" />
    </div>
  </aside>;
}

function normalizeText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function PartnerRelationshipAvatar({ target, selected, onSelect }: { target: ConversationTargetSummary; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const label = `${t('Chat.hoverCardOpenChat')}: ${target.title}`;
  return <div className="group relative flex h-11 w-full items-center justify-center">
    <div aria-hidden className={`absolute right-0 w-[3px] rounded-l-full bg-[var(--nimi-action-primary-bg)] transition-all ${selected ? 'h-8' : 'h-0 group-hover:h-4'}`} />
    <ChatPartnerAvatarCard agentHandle={normalizeText(target.metadata?.agentHandle)} name={target.title} avatarUrl={target.avatarUrl} placement="rail"
      onSelect={onSelect}>
      <button type="button" data-testid={E2E_IDS.chatTarget(String(target.id))} aria-label={label} aria-pressed={selected} aria-current={selected ? 'page' : undefined}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
        <span className={`flex h-10 w-10 items-center justify-center overflow-hidden bg-[var(--nimi-surface-panel)] transition-all duration-200 ${selected ? 'rounded-2xl' : 'rounded-full'}`}>
          {target.avatarUrl ? <img src={target.avatarUrl} alt="" className="h-full w-full object-cover" /> : <span>{(target.avatarFallback || target.title || '?').charAt(0)}</span>}
        </span>
        {target.unreadCount ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--nimi-status-danger)] px-1 text-[10px] text-white">{target.unreadCount > 99 ? '99+' : target.unreadCount}</span> : null}
      </button>
    </ChatPartnerAvatarCard>
  </div>;
}

function RelationshipAvatar({ target, selected, onSelect }: { target: ConversationTargetSummary; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const id = normalizeText(target.metadata?.otherUserId) || target.id;
  const unread = target.unreadCount || 0;
  const label = `${t('Chat.hoverCardOpenChat')}: ${target.title}${unread ? ` · ${t('Relationship.contacts.unreadMessages', { count: unread })}` : ''}`;
  return <div className="group relative flex h-11 w-full items-center justify-center">
    <div aria-hidden className={`absolute right-0 w-[3px] rounded-l-full bg-[var(--nimi-action-primary-bg)] transition-all ${selected ? 'h-8' : 'h-0 group-hover:h-4'}`} />
    <ChatHumanAvatarCard person={{ id, name: target.title, handle: target.handle, avatarUrl: target.avatarUrl, avatarMedia: target.avatarMedia, avatarResourceId: target.avatarResourceId, deleted: target.metadata?.isDeleted === true }} placement="rail" onSelect={onSelect}>
      <button type="button" data-testid={E2E_IDS.chatRow(String(target.canonicalSessionId || target.id))} aria-label={label} aria-current={selected ? 'page' : undefined}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
        <span className={`flex h-10 w-10 items-center justify-center overflow-hidden bg-[var(--nimi-surface-active)] text-[var(--nimi-action-primary-bg)] transition-all duration-200 ${selected ? 'rounded-2xl' : 'rounded-full'}`}>
          <RealmHumanAvatar accountId={id} name={target.title} imageUrl={target.avatarUrl} media={target.avatarMedia} resourceId={target.avatarResourceId} className="h-full w-full" />
        </span>
        {unread ? <span aria-hidden className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--nimi-status-danger)] px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
    </ChatHumanAvatarCard>
  </div>;
}

function useIsDesktopContactsSplit(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(min-width: 960px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(min-width: 960px)');
    const onChange = () => setWide(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return wide;
}

export type ContactsMorphTab = 'friends' | 'partners';

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function ContactsAvatarRail({
  targets,
  selectedId,
  side,
  contactsOpen,
  contactsTab = 'friends',
  mobileFocusList = false,
  pendingRequests,
  expandedContent,
  onSelect,
  onSwitch,
  onToggleContacts,
  onTabChange,
  onMore,
}: {
  targets: readonly ConversationTargetSummary[];
  selectedId: string | null;
  side: 'human' | 'companion';
  contactsOpen: boolean;
  contactsTab?: ContactsMorphTab;
  mobileFocusList?: boolean;
  pendingRequests: number;
  expandedContent?: ReactNode;
  onSelect: (target: ConversationTargetSummary) => void;
  onSwitch: () => void;
  onToggleContacts: () => void;
  onTabChange?: (tab: ContactsMorphTab) => void;
  onMore?: () => void;
}) {
  const { t } = useTranslation();
  const reducedMotion = useDesktopReducedMotion();
  const isDesktopSplit = useIsDesktopContactsSplit();
  const listRef = useRef<HTMLDivElement>(null);
  const human = side === 'human';
  const visible = targets.filter(target => human ? target.source === 'human' : target.source === 'agent');
  const otherUnread = (!human && pendingRequests > 0) || targets.some(target =>
    target.source === (human ? 'agent' : 'human') && Boolean(target.unreadCount));
  const flipLabel = t(human ? 'Chat.rail.switchToCompanions' : 'Chat.rail.switchToPeople');
  const toggleLabel = contactsOpen ? t('Chat.closePanel') : t('Relationship.contacts.title');

  useEffect(() => {
    if (!contactsOpen) {
      listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId, side, contactsOpen]);

  const shellSpring = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 36, mass: 0.85 };
  const glassTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: EASE_OUT_EXPO };
  const contentTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: EASE_OUT_EXPO };
  const tabTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: EASE_OUT_EXPO };
  const iconTransition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 460, damping: 30, mass: 0.7 };

  const targetWidth = isDesktopSplit
    ? (contactsOpen ? 372 : 84)
    : (contactsOpen && mobileFocusList ? '100%' : 84);

  const hiddenOnMobile = !isDesktopSplit && contactsOpen && !mobileFocusList;

  return (
    <motion.aside
      initial={false}
      animate={{ width: targetWidth }}
      transition={shellSpring}
      aria-label={t('Relationship.contacts.title')}
      data-contacts-rail-state={contactsOpen ? 'expanded' : 'compact'}
      data-chat-relationship-rail-chrome={contactsOpen ? 'glass' : 'transparent'}
      data-chat-side={side}
      onKeyDown={event => {
        if (
          contactsOpen
          && event.key === 'Escape'
          && !event.defaultPrevented
          && !(event.target instanceof HTMLInputElement && event.target.value)
        ) {
          event.stopPropagation();
          onToggleContacts();
        }
      }}
      className={`${hiddenOnMobile ? 'hidden min-[960px]:flex' : 'flex'} relative h-full min-h-0 shrink-0 overflow-hidden py-3 pr-3 ${contactsOpen && !isDesktopSplit ? 'pl-3' : 'pl-0'}`}
    >
      {/* Unified morphing glass backdrop: invisible in compact rail form, blooms from the bottom-right Contacts hinge when expanded */}
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{
          opacity: contactsOpen ? 1 : 0,
          scale: reducedMotion ? 1 : contactsOpen ? 1 : 0.96,
        }}
        transition={glassTransition}
        className={`pointer-events-none absolute inset-y-3 right-3 origin-bottom-right ${contactsOpen && !isDesktopSplit ? 'left-3' : 'left-1'}`}
      >
        <AppCardSurface
          kind="promoted-glass"
          as="div"
          className="desktop-module-panel h-full w-full shadow-[var(--nimi-elevation-base)]"
        >
          {null}
        </AppCardSurface>
      </motion.div>

      <div className="relative z-10 flex h-full min-h-0 flex-1 flex-col items-end overflow-hidden">
        {contactsOpen ? (
          <motion.div
            key="expanded-body"
            data-testid="contacts-right-panel"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={contentTransition}
            className="flex min-h-0 w-full flex-1 flex-col self-start overflow-hidden pl-1 min-[960px]:w-[360px]"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--nimi-border-subtle)] px-3 pt-1.5">
              <NimiTabs
                className="min-w-0 flex-1 border-b-0"
                ariaLabel={t('Relationship.contacts.title')}
                value={contactsTab}
                onValueChange={value => onTabChange?.(value as ContactsMorphTab)}
                items={[
                  {
                    value: 'friends',
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{t('Relationship.contacts.tabs.friends')}</span>
                        {pendingRequests > 0 && contactsTab !== 'friends' ? (
                          <span className="rounded-full bg-[var(--nimi-status-danger)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-white">
                            {pendingRequests > 99 ? '99+' : pendingRequests}
                          </span>
                        ) : null}
                      </span>
                    ),
                  },
                  { value: 'partners', label: t('Chat.contactsPartners') },
                ]}
              />
            </div>

            <motion.div
              key={contactsTab}
              initial={reducedMotion ? false : { opacity: 0, x: contactsTab === 'partners' ? 14 : -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={tabTransition}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {expandedContent}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="compact-body"
            data-testid={E2E_IDS.chatList}
            initial={reducedMotion ? false : { opacity: 0, x: -8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={contentTransition}
            className="flex min-h-0 w-[72px] flex-1 flex-col items-center pb-[76px] pt-2"
          >
            <div className="relative flex shrink-0 flex-col items-center gap-1 pb-3">
              <Tooltip content={flipLabel} placement="right">
                <IconButton
                  tone="ghost"
                  icon={(
                    <span className="chat-side-flip" data-side={side} aria-hidden="true">
                      <Rotate3d size={29} strokeWidth={1.55} />
                    </span>
                  )}
                  aria-label={flipLabel}
                  data-testid="chat-side-flip"
                  onClick={onSwitch}
                  className="chat-side-toggle h-11 w-11 rounded-full"
                />
              </Tooltip>
              {otherUnread ? (
                <span
                  className="absolute -right-1 top-6 h-2.5 w-2.5 rounded-full bg-[var(--nimi-status-danger)] ring-2 ring-[var(--nimi-surface-canvas)]"
                  role="status"
                  aria-label={t(human ? 'Chat.rail.companionUnread' : 'Chat.rail.otherUnread')}
                />
              ) : null}
              <span className="whitespace-nowrap text-[10px] font-medium text-[var(--nimi-text-secondary)]">
                {t(human ? 'Chat.rail.people' : 'Chat.rail.companions')}
              </span>
            </div>

            <ScrollArea
              viewportRef={listRef}
              className="mt-2 min-h-0 w-full flex-1"
              contentClassName="py-1"
            >
              <div key={side} className="chat-side-entry flex flex-col items-center gap-2" data-side={side}>
                {visible.map(target => target.source === 'agent'
                  ? <PartnerRelationshipAvatar key={target.id} target={target} selected={selectedId === target.id} onSelect={() => onSelect(target)} />
                  : <RelationshipAvatar key={target.id} target={target} selected={selectedId === target.id} onSelect={() => onSelect(target)} />)}
                {onMore ? (
                  <Tooltip content={t('Relationship.contacts.loadMore')} placement="right">
                    <IconButton
                      size="sm"
                      tone="ghost"
                      icon={<span aria-hidden="true">…</span>}
                      aria-label={t('Relationship.contacts.loadMore')}
                      onClick={onMore}
                    />
                  </Tooltip>
                ) : null}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </div>

      {/* Persistent bottom-right Contacts hinge: icon itself morphs between ContactRound (closed) and ChevronsRight (open) */}
      <div
        data-chat-rail-footer="true"
        className={`absolute bottom-3 right-3 z-20 flex w-[72px] flex-col items-center gap-1 border-t pb-1.5 pt-2.5 transition-colors duration-200 ${
          contactsOpen ? 'border-transparent' : 'border-[var(--nimi-border-subtle)]'
        }`}
      >
        <motion.div
          whileHover={reducedMotion ? undefined : { scale: 1.05 }}
          whileTap={reducedMotion ? undefined : { scale: 0.93 }}
          animate={{ scale: !reducedMotion && contactsOpen ? 1.03 : 1 }}
          transition={shellSpring}
          className="relative"
        >
          <IconToggleAction
            icon={(
              <span className="relative grid h-5 w-5 place-items-center" aria-hidden="true">
                <motion.span
                  initial={false}
                  animate={{
                    opacity: contactsOpen ? 0 : 1,
                    scale: reducedMotion ? 1 : contactsOpen ? 0.72 : 1,
                    x: reducedMotion ? 0 : contactsOpen ? -4 : 0,
                  }}
                  transition={iconTransition}
                  className="col-start-1 row-start-1 grid place-items-center"
                >
                  <ContactRound size={20} strokeWidth={1.75} />
                </motion.span>
                <motion.span
                  initial={false}
                  animate={{
                    opacity: contactsOpen ? 1 : 0,
                    scale: reducedMotion ? 1 : contactsOpen ? 1 : 0.72,
                    x: reducedMotion ? 0 : contactsOpen ? 0 : -4,
                  }}
                  transition={iconTransition}
                  className="col-start-1 row-start-1 grid place-items-center"
                >
                  <ChevronsRight size={20} strokeWidth={1.75} />
                </motion.span>
              </span>
            )}
            active={contactsOpen}
            aria-expanded={contactsOpen}
            aria-pressed={contactsOpen}
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggleContacts}
            data-testid="human-contacts-entry"
            className="h-11 w-11 rounded-2xl"
          />
          {pendingRequests && !contactsOpen ? (
            <span className="pointer-events-none absolute -right-1 -top-1 rounded-full bg-[var(--nimi-status-danger)] px-1.5 text-[10px] font-semibold tabular-nums text-white">
              {pendingRequests > 99 ? '99+' : pendingRequests}
            </span>
          ) : null}
        </motion.div>
        <span
          className={`whitespace-nowrap text-[10px] transition-colors duration-200 ${
            contactsOpen
              ? 'font-semibold text-[var(--nimi-action-primary-bg)]'
              : 'font-medium text-[var(--nimi-text-secondary)]'
          }`}
        >
          {t('Relationship.contacts.title')}
        </span>
      </div>
    </motion.aside>
  );
}
