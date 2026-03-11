import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { i18n } from '@renderer/i18n';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { openDefaultPrivateExecutionMod } from '@renderer/mod-ui/lifecycle/default-private-execution';
import { SendGiftModal } from '@renderer/features/economy/send-gift-modal.js';
import { toProfileData, type ProfileData } from '@renderer/features/profile/profile-model';
import { ContactDetailView } from './contact-detail-view.js';

export type ContactDetailProfileSeed = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isAgent: boolean;
  isOnline?: boolean;
  createdAt?: string;
  tags?: string[];
  city?: string | null;
  countryCode?: string | null;
  gender?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  giftStats?: Record<string, number>;
  agentState?: string | null;
  agentCategory?: string | null;
  agentOrigin?: string | null;
  agentTier?: string | null;
  agentWakeStrategy?: string | null;
  agentOwnershipType?: string | null;
  agentWorldId?: string | null;
  agentOwnerWorldId?: string | null;
};

type ContactDetailProfileModalProps = {
  open: boolean;
  profileId: string;
  profileSeed: ContactDetailProfileSeed | null;
  onClose: () => void;
};

const INTERNAL_OPEN_CHAT_ERROR_CODE = 'CONTACTS_OPEN_CHAT_FAILED';

function toSeedProfileData(seed: ContactDetailProfileSeed | null): ProfileData | null {
  if (!seed?.id) {
    return null;
  }
  return toProfileData({
    id: seed.id,
    displayName: seed.displayName,
    handle: seed.handle,
    avatarUrl: seed.avatarUrl,
    bio: seed.bio,
    isAgent: seed.isAgent,
    isOnline: seed.isOnline,
    createdAt: seed.createdAt,
    tags: seed.tags || [],
    city: seed.city,
    countryCode: seed.countryCode,
    gender: seed.gender,
    worldName: seed.worldName,
    worldBannerUrl: seed.worldBannerUrl,
    giftStats: seed.giftStats || {},
    stats: {
      friendsCount: seed.friendsCount ?? 0,
      postsCount: seed.postsCount ?? 0,
      likesCount: seed.likesCount ?? 0,
    },
    agent: seed.isAgent ? {
      state: seed.agentState,
      category: seed.agentCategory,
      origin: seed.agentOrigin,
      tier: seed.agentTier,
      wakeStrategy: seed.agentWakeStrategy,
      ownershipType: seed.agentOwnershipType,
      worldId: seed.agentWorldId,
      ownerWorldId: seed.agentOwnerWorldId,
    } : undefined,
  } as Record<string, unknown>);
}

function extractAgentWorldId(profile: unknown): string {
  if (!profile || typeof profile !== 'object') {
    return '';
  }
  const payload = profile as Record<string, unknown>;
  const direct = String(payload.worldId || '').trim();
  if (direct) {
    return direct;
  }
  const agent = payload.agent && typeof payload.agent === 'object'
    ? (payload.agent as Record<string, unknown>)
    : null;
  const fromAgent = String(agent?.worldId || '').trim();
  if (fromAgent) {
    return fromAgent;
  }
  const agentProfile = payload.agentProfile && typeof payload.agentProfile === 'object'
    ? (payload.agentProfile as Record<string, unknown>)
    : null;
  return String(agentProfile?.worldId || '').trim();
}

export function ContactDetailProfileModal(props: ContactDetailProfileModalProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [giftModalOpen, setGiftModalOpen] = useState(false);

  const fallbackProfile = useMemo(
    () => toSeedProfileData(props.profileSeed),
    [props.profileSeed],
  );

  const toChatErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error) {
      const next = error.message.trim();
      if (next && next !== INTERNAL_OPEN_CHAT_ERROR_CODE) {
        return next;
      }
    }
    return t('Contacts.openChatFailed', { defaultValue: 'Failed to open chat' });
  }, [t]);

  const profileQuery = useQuery({
    queryKey: ['contact-detail-modal-profile', props.profileId, props.profileSeed?.handle, props.profileSeed?.isAgent],
    queryFn: async () => {
      if (!props.profileId) {
        return null;
      }
      try {
        const result = props.profileSeed?.isAgent
          ? await dataSync.loadAgentDetails(props.profileSeed.handle || props.profileId)
          : await dataSync.loadUserProfile(props.profileId);
        return toProfileData(result as Record<string, unknown>);
      } catch {
        return fallbackProfile;
      }
    },
    enabled: props.open && Boolean(props.profileId),
    retry: 1,
  });

  const profile = profileQuery.data || fallbackProfile;

  const handleMessage = useCallback(async () => {
    if (!profile) {
      return;
    }
    if (profile.isAgent) {
      let worldId = profile.agentWorldId || profile.agentOwnerWorldId || '';
      if (!worldId) {
        try {
          const rawProfile = await dataSync.loadUserProfile(profile.id);
          worldId = extractAgentWorldId(rawProfile);
        } catch {
          worldId = '';
        }
      }
      setRuntimeFields({
        targetType: 'AGENT',
        targetAccountId: profile.id,
        agentId: profile.id,
        targetId: profile.id,
        worldId,
      });
      openDefaultPrivateExecutionMod();
      props.onClose();
      return;
    }

    try {
      const result = await dataSync.startChat(profile.id);
      if (!result?.chatId) {
        throw new Error(INTERNAL_OPEN_CHAT_ERROR_CODE);
      }
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: profile.id,
        agentId: '',
        worldId: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      setActiveTab('chat');
      props.onClose();
      setTimeout(() => {
        setSelectedChatId(String(result.chatId));
      }, 100);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toChatErrorMessage(error),
      });
    }
  }, [
    profile,
    props,
    queryClient,
    setRuntimeFields,
    setSelectedChatId,
    setStatusBanner,
    t,
    toChatErrorMessage,
  ]);

  if (!props.open || !profile) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[120] bg-black/42 backdrop-blur-sm"
        onClick={props.onClose}
      />
      <div className="fixed inset-0 z-[121]">
        <div
          className="relative flex h-full w-full overflow-hidden bg-white"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={props.onClose}
            className="absolute left-6 top-6 z-[130] flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-black/50 text-[#4ECCA3] transition-all hover:border-[#4ECCA3]/40 hover:bg-black/70"
            aria-label={i18n.t('Contacts.goBack', { defaultValue: 'Go Back' })}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="h-full min-h-0 flex-1 overflow-hidden">
            <ContactDetailView
              profile={profile}
              loading={profileQuery.isPending && !fallbackProfile}
              error={Boolean(profileQuery.isError && !fallbackProfile)}
              onClose={props.onClose}
              onMessage={() => {
                void handleMessage();
              }}
              onSendGift={() => setGiftModalOpen(true)}
              showMessageButton
              fullBleed
            />
          </div>
        </div>
      </div>

      <SendGiftModal
        open={giftModalOpen}
        receiverId={profile.id}
        receiverName={profile.displayName}
        receiverHandle={profile.handle}
        receiverAvatarUrl={profile.avatarUrl}
        onClose={() => setGiftModalOpen(false)}
        onSent={() => {
          setStatusBanner({
            kind: 'success',
            message: t('Contacts.giftSentTo', {
              name: profile.displayName || profile.handle || t('Contacts.human', { defaultValue: 'Human' }).toLowerCase(),
              defaultValue: 'Gift sent to {{name}}',
            }),
          });
          setGiftModalOpen(false);
        }}
      />
    </>
  );
}
