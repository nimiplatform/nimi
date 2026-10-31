import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DialogDescription, DialogTitle, OverlayShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { requireHumanAccountId, type HumanProfileSource } from '../profile/profile-model.js';
import { loadContextualHumanProfile } from '../profile/profile-loader.js';
import { E2E_IDS } from '../../testability/e2e-ids.js';
import { ProfileDetailView } from './profile-detail-view.js';
import { ProfileDetailErrorState, ProfileDetailLoadingState } from './profile-detail-view-content-shell.js';
import { isPrivateProfileAccessError } from './profile-private-state.js';
import { useHumanProfileActions } from './use-human-profile-actions.js';

export type HumanProfileDetailSeed = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isOnline?: boolean;
  createdAt?: string;
  friendsSince?: string | null;
  tags?: string[];
  city?: string | null;
  countryCode?: string | null;
  gender?: string | null;
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  isFriend?: boolean;
  isPendingFriendRequest?: boolean;
};

type ProfileDetailModalProps = { open: boolean; profileId: string; profileSeed: HumanProfileDetailSeed | null; onClose: () => void };

export function ProfileDetailModal(props: ProfileDetailModalProps) {
  const { t } = useTranslation();
  const social = useRealmSocialData();
  const sdk = useDesktopRendererBindings().sdk;
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realmBaseUrl = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  const setProfileDetailOverlayOpen = useAppStore(state => state.setProfileDetailOverlayOpen);
  useEffect(() => {
    if (!props.open) return;
    setProfileDetailOverlayOpen(true);
    return () => setProfileDetailOverlayOpen(false);
  }, [props.open, setProfileDetailOverlayOpen]);
  const query = useQuery({
    queryKey: ['human-profile-detail', realmBaseUrl, accountId, props.profileId],
    queryFn: () => {
      const profileId = requireHumanAccountId(props.profileId);
      if (props.profileSeed && props.profileSeed.id !== profileId) throw new Error('Profile identity does not match the selected account.');
      return loadContextualHumanProfile(profileId, {
        loadUserProfile: id => social.loadUserProfile(id) as Promise<HumanProfileSource>,
        loadRelationship: id => sdk.realm().social.getMyRelationshipWithUser({ path: { id } }),
      }, props.profileSeed);
    },
    enabled: props.open && Boolean(props.profileId && accountId),
    retry: (count, error) => !isPrivateProfileAccessError(error) && count < 1,
  });
  const profile = query.data ?? null;
  const actions = useHumanProfileActions(profile, props.onClose);
  if (!props.open) return null;
  const name = profile?.displayName || props.profileSeed?.displayName || t('Relationship.profileDetailDialogTitleFallback');
  return <>
    <OverlayShell open kind="dialog" onClose={props.onClose} dataTestId={E2E_IDS.profileDetailModal}
      panelClassName="max-w-none overflow-hidden rounded-[var(--nimi-radius-xl)] bg-[var(--nimi-surface-canvas)]"
      panelStyle={{ width: 'min(1000px, calc(100cqw - 48px))', height: 'min(900px, calc(100cqh - 64px))' }}
      contentClassName="relative flex h-full min-h-0 flex-col p-0">
      <DialogTitle className="sr-only">{t('Relationship.profileDetailDialogTitle', { name })}</DialogTitle>
      <DialogDescription className="sr-only">{t('Relationship.profileDetailDialogDescription')}</DialogDescription>
      <button type="button" data-testid={E2E_IDS.profileDetailModalClose} onClick={props.onClose} aria-label={t('Common.close')}
        className="absolute right-4 top-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      {profile ? <ProfileDetailView profile={profile} loading={false} error={false} hideBackButton onClose={props.onClose} {...actions.props} />
        : query.isError ? <ProfileDetailErrorState backLabel={t('Common.back')} label={t('ProfileView.error')} onClose={props.onClose} retryLabel={t('Common.retry')} onRetry={() => { void query.refetch(); }} />
          : <ProfileDetailLoadingState label={t('ProfileView.loading')} />}
    </OverlayShell>
    {actions.dialog}
  </>;
}
