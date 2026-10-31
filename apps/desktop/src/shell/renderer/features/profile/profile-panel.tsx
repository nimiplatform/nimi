import { useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollArea } from '@nimiplatform/kit/ui';
import { useCurrentUserProfileProjection } from './current-user-profile.js';
import { useHomeNavigation, useHomeDestination, useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { loadContextualHumanProfile } from './profile-loader.js';
import { ProfileDetailView } from '../relationship/profile-detail-view.js';
import { ProfileDetailErrorState, ProfileDetailLoadingState } from '../relationship/profile-detail-view-content-shell.js';
import { E2E_IDS } from '../../testability/e2e-ids.js';
import { requireHumanAccountId, toHumanProfileData, type HumanProfileSource } from './profile-model.js';
import { openHomeSettings } from '../settings/settings-entry.js';
import { useHumanProfileActions } from '../relationship/use-human-profile-actions.js';

export function ProfilePanel() {
  const navigation = useHomeNavigation();
  const social = useRealmSocialData();
  const queryClient = useQueryClient();
  const sdk = useDesktopRendererBindings().sdk;
  const i18n = useDesktopI18nResource().instance;
  const auth = useAppStore(state => state.auth);
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  useCurrentUserProfileProjection();
  const selectedProfileId = useHomeDestination().profileId ?? null;
  const isOwnProfile = !selectedProfileId || selectedProfileId === auth.user?.id;
  const scroll = useRef<HTMLDivElement>(null);
  const profileQuery = useQuery({
    queryKey: ['user-profile', realmBaseUrl, auth.user?.id, selectedProfileId],
    queryFn: () => {
      const id = requireHumanAccountId(selectedProfileId);
      const known = social.contacts().friends.find(item => item.id === id);
      const contactPages = queryClient.getQueriesData<{ pages: { items: { id: string; displayName: string | null; handle: string | null; avatarUrl: string | null }[] }[] }>({ queryKey: ['human-contacts', realmBaseUrl, auth.user?.id] });
      const listed = contactPages.flatMap(([, data]) => data?.pages.flatMap(page => page.items) || []).find(item => item.id === id);
      const chatPeer = queryClient.getQueryData<{ id: string; displayName: string; handle: string; avatarUrl: string | null }>(
        ['chat-peer-identity', auth.user?.realmEnvironmentId, auth.user?.id, id]);
      const identity = chatPeer || listed || known;
      return loadContextualHumanProfile(id, {
        loadUserProfile: value => social.loadUserProfile(value) as Promise<HumanProfileSource>,
        loadRelationship: value => sdk.realm().social.getMyRelationshipWithUser({ path: { id: value } }),
      }, identity ? { id, displayName: String(identity.displayName || identity.handle || ''), handle: String(identity.handle || ''), avatarUrl: typeof identity.avatarUrl === 'string' ? identity.avatarUrl : null } : null);
    },
    enabled: auth.status === 'authenticated' && !isOwnProfile,
    retry: 1,
  });
  const profile = useMemo(() => isOwnProfile && auth.user ? toHumanProfileData(auth.user) : profileQuery.data ?? null,
    [isOwnProfile, auth.user, profileQuery.data]);
  const actions = useHumanProfileActions(isOwnProfile ? null : profile);
  const loading = !isOwnProfile && profileQuery.isPending;
  const error = !isOwnProfile && profileQuery.isError;
  return <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
    {loading ? <ProfileDetailLoadingState label={i18n.t('ProfileView.loading')} /> : error ? <ProfileDetailErrorState
      backLabel={i18n.t('Common.back')} label={i18n.t('ProfileView.error')} onClose={navigation.back}
      retryLabel={i18n.t('Common.retry')} onRetry={() => { void profileQuery.refetch(); }} /> : profile ? <ScrollArea className="min-h-0 flex-1"
        viewportClassName="bg-transparent px-5 pb-5 pt-8" contentClassName="mx-auto flex w-full max-w-[960px] flex-col" viewportRef={scroll}>
        <section className="overflow-hidden rounded-2xl bg-[var(--nimi-surface-card)] py-5">
          <ProfileDetailView profile={profile} isOwnProfile={isOwnProfile} loading={false} error={false}
            hideBackButton externalScrollContainerRef={scroll} onClose={navigation.back} {...actions.props}
            onEditProfile={isOwnProfile ? () => { void openHomeSettings(navigation, 'profile'); } : undefined}
            onOpenFriends={isOwnProfile ? () => { void navigation.push({ id: 'chat', chat: { mode: 'human' } }); } : undefined}
            onOpenPrivacy={isOwnProfile ? () => { void openHomeSettings(navigation, 'privacy'); } : undefined} />
        </section>
      </ScrollArea> : <p className="p-5 text-sm text-[var(--nimi-text-secondary)]">{i18n.t('Profile.noProfileDataAvailable')}</p>}
    {actions.dialog}
  </div>;
}
