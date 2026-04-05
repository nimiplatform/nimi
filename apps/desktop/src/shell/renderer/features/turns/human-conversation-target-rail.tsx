import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { HumanChatViewDto } from '@renderer/features/chat/chat-human-thread-model';
import { toProfileData } from '@renderer/features/profile/profile-model';
import { ChatProfileCard } from './message-timeline-profile-card.js';
import { toChatProfileSummary } from './message-timeline-utils.js';

type HumanConversationTargetRailProps = {
  selectedChat: HumanChatViewDto | null;
  onOpenGift?: () => void;
};

export function HumanConversationTargetRail({
  selectedChat,
  onOpenGift,
}: HumanConversationTargetRailProps) {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const otherUser = selectedChat?.otherUser;
  const otherUserId = String(otherUser?.id || '').trim();
  const currentUserFallback = currentUser && typeof currentUser === 'object'
    ? (currentUser as unknown as Record<string, unknown>)
    : null;
  const otherUserFallback = (otherUser as unknown as Record<string, unknown>) || null;
  const profileTargetId = profilePanelTarget === 'self' ? currentUserId : otherUserId;

  const profileQuery = useQuery({
    queryKey: ['chat-contact-profile', profilePanelTarget, profileTargetId],
    queryFn: async () => {
      if (!profileTargetId) {
        return null;
      }
      const result = await dataSync.loadUserProfile(profileTargetId);
      return result as Record<string, unknown>;
    },
    enabled: authStatus === 'authenticated' && profilePanelTarget !== null && Boolean(profileTargetId),
  });

  const profileSummary = useMemo(() => {
    const fallback = profilePanelTarget === 'self' ? currentUserFallback : otherUserFallback;
    return toChatProfileSummary({
      fallback,
      profile: (profileQuery.data as Record<string, unknown> | undefined) || null,
    });
  }, [currentUserFallback, otherUserFallback, profilePanelTarget, profileQuery.data]);

  const profileActionLabel = profilePanelTarget === 'self'
    ? t('ChatTimeline.openMyProfile')
    : t('ChatTimeline.openUserProfile');

  if (profilePanelTarget === null) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1" contentClassName="px-4 py-4">
        <ChatProfileCard
          profileData={toProfileData(profileQuery.data || profileSummary)}
          onClose={() => setProfilePanelTarget(null)}
          onViewFullProfile={() => {
            if (!profileSummary.id) {
              return;
            }
            navigateToProfile(profileSummary.id, 'profile');
          }}
          viewFullProfileLabel={profileActionLabel}
          onOpenGift={profilePanelTarget === 'other' && profileSummary.id ? onOpenGift : undefined}
        />
      </ScrollArea>
    </div>
  );
}
