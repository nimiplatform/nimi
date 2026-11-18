import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import nimiGrayLogo from '../../assets/logo-gray.png';
import { useAppStoreApi, useHomeDestination, useHomeEntryKey, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useDesktopReducedMotion } from '../../ui/motion/desktop-motion.js';
import { PartnerDirectory } from '../agents/partner-directory.js';
import { resolvePartnerForHandle } from '../agents/partner-directory-model.js';
import { PartnersPanel } from '../agents/partners-panel.js';
import { useReceivedFriendRequests } from '../relationship/human-contact-data.js';
import { ProfilePanel } from '../profile/profile-panel.js';
import { HumanContactsPanel } from '../relationship/human-contacts-panel.js';
import { useSystemEntry } from '../system-entry/system-entry-context.js';
import { ChatHumanModeContent } from './chat-human-mode-content.js';
import { ContactsAvatarRail, type ContactsMorphTab } from './chat-relationship-rail.js';
import { useHumanChatList } from './use-human-chat-list.js';
import { toRecentAgentTargets, useChatSidebarData } from './chat-sidebar-targets.js';
import { HomePartnerConversation } from './home-partner-conversation.js';
import { useContactsScope } from './contacts-scope.js';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';

const EASE_STAGE = [0.05, 0.7, 0.1, 1] as const;

function NimiLogoWatermark() {
  return (
    <img
      src={nimiGrayLogo}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="pointer-events-none h-24 w-24 select-none object-contain opacity-20 contrast-75"
    />
  );
}

function ContactsEmptyStage({
  side,
  contactsOpen,
  canShowRail,
  hasVisibleConversations,
  suppressZeroPrompt,
  onOpenContacts,
}: {
  side: 'human' | 'companion';
  contactsOpen: boolean;
  canShowRail: boolean;
  hasVisibleConversations: boolean;
  suppressZeroPrompt: boolean;
  onOpenContacts: () => void;
}) {
  const { t } = useTranslation();

  if (contactsOpen) {
    return (
      <div
        data-testid="contacts-empty-stage"
        data-empty-stage-mode="contacts-open"
        className="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-2.5 p-6 text-center"
      >
        <NimiLogoWatermark />
        <p className="max-w-xs text-xs leading-5 text-[var(--nimi-text-muted)] opacity-75">
          {t('Chat.contactsSelectPromptHint')}
        </p>
      </div>
    );
  }

  if (!canShowRail || hasVisibleConversations || suppressZeroPrompt) {
    const showConversationPill = canShowRail && hasVisibleConversations;
    return (
      <div
        data-testid="contacts-empty-stage"
        data-empty-stage-mode={showConversationPill ? 'has-conversations' : 'quiet'}
        className="flex min-h-0 flex-1 select-none flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <NimiLogoWatermark />
        {showConversationPill ? (
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_8%,transparent)] px-3.5 py-1 text-xs leading-5 text-[var(--nimi-text-muted)]">
            {t(side === 'companion' ? 'Chat.contactsPickRightPartnerHint' : 'Chat.contactsPickRightAvatarHint')}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-testid="contacts-empty-stage"
      data-empty-stage-mode="zero-conversations"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <NimiLogoWatermark />
      <p className="max-w-xs text-sm leading-6 text-[var(--nimi-text-muted)]">
        {t(side === 'companion' ? 'Chat.contactsEmptyPartnerConversationsHint' : 'Chat.contactsEmptyConversationsHint')}
      </p>
      <Button
        size="sm"
        tone="secondary"
        className="rounded-full px-4 font-medium"
        trailingIcon={<ArrowRight size={14} aria-hidden="true" />}
        onClick={onOpenContacts}
      >
        {t('Chat.contactsOpenContactsAction')}
      </Button>
    </div>
  );
}

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function ContactsPage() {
  const { t } = useTranslation();
  const reducedMotion = useDesktopReducedMotion();
  const destination = useHomeDestination();
  const entryKey = useHomeEntryKey();
  const navigation = useHomeNavigation();
  const store = useAppStoreApi();
  const sdk = useDesktopRendererSdk();
  const { auth, accountId, scope } = useContactsScope();
  const { appActivity, recentPartners } = useSystemEntry();
  const { targets } = useChatSidebarData(auth.status);
  const humans = useHumanChatList(auth.status);
  const requests = useReceivedFriendRequests().data?.pages[0]?.total ?? 0;

  const hasPartnerProfile = Boolean(destination.partnerManagerAnchorId || destination.partner);
  const hasUserProfile = Boolean(destination.profileId);
  const hasProfile = hasPartnerProfile || hasUserProfile;
  const hasHuman = Boolean(destination.chat?.targetId || destination.chat?.threadId);
  const isContactsRoute = destination.contactView === 'partners'
    || hasUserProfile
    || Boolean(destination.chat?.contactsSection && destination.chat.contactsSection !== 'conversations');
  const side = destination.partnerChat || destination.conversationFilter === 'partner' || destination.contactView === 'partners'
    ? 'companion'
    : 'human';
  const defaultTab: ContactsMorphTab = destination.contactView === 'partners' || (!isContactsRoute && side === 'companion')
    ? 'partners'
    : 'friends';

  const [drawerState, setDrawerState] = useState<{ entryKey: string; open: boolean; tab: ContactsMorphTab } | null>(null);
  const canShowRail = auth.status === 'authenticated' || auth.status === 'refresh-pending';
  const hasExplicitDrawer = drawerState?.entryKey === entryKey;
  const contactsOpen = canShowRail && (hasExplicitDrawer ? drawerState.open : isContactsRoute);
  const contactsTab: ContactsMorphTab = hasExplicitDrawer ? drawerState.tab : defaultTab;
  const mobileFocusList = contactsOpen && ((hasExplicitDrawer && drawerState.open) || (!hasProfile && !destination.partnerChat && !hasHuman));

  const [failedScope, setFailedScope] = useState<string | null>(null);
  const openingPartner = useRef(0);
  const references = useQuery({
    queryKey: ['home-rail-agent-references', scope],
    queryFn: () => sdk.appProduct().agents.listReferences(),
    enabled: auth.status === 'authenticated',
    staleTime: 15_000,
    retry: false,
  });
  const selectedPartner = destination.partnerChat?.localAgentRef;
  const selectedReference = useQuery({
    queryKey: ['home-rail-selected-reference', scope, selectedPartner],
    queryFn: () => sdk.resolveDesktopAgentReference({ localAgentRef: selectedPartner! }),
    enabled: auth.status === 'authenticated' && Boolean(selectedPartner),
    staleTime: 15_000,
    retry: false,
  });

  const humanTargets = useMemo(() => targets.filter(target => target.source === 'human'), [targets]);
  const humanSessionTargets = useMemo(
    () => humanTargets.filter(target => Boolean(target.canonicalSessionId)),
    [humanTargets],
  );
  const partnerTargets = useMemo(
    () => toRecentAgentTargets(references.data ?? [], appActivity.recent.records),
    [references.data, appActivity.recent.records],
  );
  const visibleRailTargets = side === 'companion' ? partnerTargets : humanSessionTargets;
  const loadingSideTargets = auth.status === 'refresh-pending'
    || (side === 'companion' ? references.isLoading : humans.isLoading);
  const sideTargetsFailed = side === 'companion' ? references.isError : humans.isError;
  const unreadByUserId = useMemo(() => {
    const map = new Map<string, number>();
    for (const target of humanTargets) {
      const count = target.unreadCount || 0;
      if (!count) continue;
      const userId = typeof target.metadata?.otherUserId === 'string' && target.metadata.otherUserId.trim()
        ? target.metadata.otherUserId.trim()
        : target.id;
      if (userId) map.set(userId, (map.get(userId) ?? 0) + count);
    }
    return map;
  }, [humanTargets]);

  const selectedId = selectedPartner
    ? selectedReference.data?.reference?.agentHandle ?? null
    : destination.chat?.targetId ?? humanTargets.find(target => target.canonicalSessionId === destination.chat?.threadId)?.id ?? null;

  const openContactsDrawer = (tab: ContactsMorphTab = defaultTab) => {
    setDrawerState({ entryKey, open: true, tab });
  };

  const toggleContactsDrawer = () => {
    if (contactsOpen) {
      setDrawerState({ entryKey, open: false, tab: contactsTab });
    } else {
      openContactsDrawer(side === 'companion' ? 'partners' : 'friends');
    }
  };

  const selectTarget = (target: ConversationTargetSummary) => {
    if (target.source === 'human' && target.canonicalSessionId) {
      setDrawerState(null);
      void navigation.push({ id: 'contacts', chat: { mode: 'human', targetId: target.id, threadId: target.canonicalSessionId } });
      return;
    }
    if (target.source !== 'agent') return;
    const account = captureAccountActionScope(store);
    if (!account) return;
    const position = captureHomeNavigationScope(navigation);
    const request = ++openingPartner.current;
    const current = () => account.isCurrent() && position.isCurrent() && request === openingPartner.current;
    setFailedScope(null);
    void (async () => {
      const known = recentPartners?.find(partner => partner.activityAgentRef === target.metadata?.activityAgentRef);
      const localAgentRef = known?.localAgentRef ??
        (await resolvePartnerForHandle(sdk, accountId, target.id)).partner.localAgentRef;
      if (current()) {
        setDrawerState(null);
        await navigation.push({ id: 'contacts', partnerChat: { localAgentRef } });
      }
    })().catch(() => { if (current()) setFailedScope(scope); }).finally(() => { position.dispose(); account.dispose(); });
  };

  const stageKey = hasPartnerProfile
    ? `partner-profile:${destination.partner?.localAgentRef ?? destination.partnerManagerAnchorId ?? ''}`
    : hasUserProfile
      ? `user-profile:${destination.profileId ?? ''}`
      : destination.partnerChat
        ? `partner-chat:${scope}:${destination.partnerChat.localAgentRef}`
        : hasHuman
          ? `human-chat:${destination.chat?.threadId ?? destination.chat?.targetId ?? ''}`
          : 'empty';

  const stageTransition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: EASE_STAGE };

  return (
    <div data-testid="contacts-page" className="relative flex h-full min-h-0 min-w-0 flex-1">
      <div className={`${mobileFocusList ? 'hidden min-[960px]:flex' : 'flex'} relative min-h-0 min-w-0 flex-1 flex-col overflow-hidden`}>
        <motion.div
          key={stageKey}
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={stageTransition}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {hasPartnerProfile ? (
            <PartnersPanel onBackToContacts={() => openContactsDrawer('partners')} />
          ) : hasUserProfile ? (
            <ProfilePanel onBackToContacts={() => openContactsDrawer('friends')} />
          ) : destination.partnerChat ? (
            <HomePartnerConversation
              key={scope + ':' + destination.partnerChat.localAgentRef}
              target={destination.partnerChat}
              railReserved={false}
            />
          ) : hasHuman ? (
            <ChatHumanModeContent
              railReserved={false}
              allTargets={humanTargets}
              settingsOpen={false}
              onCloseSettings={() => {}}
              onSelectTarget={id => {
                const target = humanTargets.find(item => item.id === id);
                if (target) selectTarget(target);
              }}
              onSetupAction={() => {}}
            />
          ) : canShowRail && !contactsOpen && side === 'human' && humans.isError && humanSessionTargets.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <InlineAlert tone="warning" action={<Button size="sm" onClick={() => void humans.refetch()}>{t('Common.retry')}</Button>}>
                {t('Chat.contactsConversationsUnavailable')}
              </InlineAlert>
            </div>
          ) : (
            <ContactsEmptyStage
              side={side}
              contactsOpen={contactsOpen}
              canShowRail={canShowRail}
              hasVisibleConversations={visibleRailTargets.length > 0}
              suppressZeroPrompt={loadingSideTargets || sideTargetsFailed}
              onOpenContacts={() => openContactsDrawer(side === 'companion' ? 'partners' : 'friends')}
            />
          )}
        </motion.div>

        {failedScope === scope || (side === 'companion' && references.isError) ? (
          <InlineAlert
            tone="warning"
            className="absolute right-4 top-3 z-10"
            action={references.isError ? <Button size="sm" onClick={() => { void references.refetch(); }}>{t('Common.retry')}</Button> : undefined}
          >
            {t('runtimeConfig.partners.unavailable')}
          </InlineAlert>
        ) : null}
      </div>

      {canShowRail ? (
        <ContactsAvatarRail
          targets={[...humanSessionTargets, ...partnerTargets]}
          selectedId={selectedId}
          side={side}
          contactsOpen={contactsOpen}
          contactsTab={contactsTab}
          mobileFocusList={mobileFocusList}
          pendingRequests={requests}
          expandedContent={
            contactsTab === 'partners' ? (
              <PartnerDirectory onOpenConversation={() => setDrawerState(null)} />
            ) : (
              <HumanContactsPanel unreadByUserId={unreadByUserId} onOpenConversation={() => setDrawerState(null)} />
            )
          }
          onSelect={selectTarget}
          onSwitch={() => { void navigation.push({ id: 'contacts', conversationFilter: side === 'human' ? 'partner' : 'human' }); }}
          onToggleContacts={toggleContactsDrawer}
          onTabChange={tab => setDrawerState({ entryKey, open: true, tab })}
          onMore={side === 'human' && humans.hasNextPage && !humans.isFetchingNextPage ? () => { void humans.fetchNextPage(); } : undefined}
        />
      ) : null}
    </div>
  );
}
