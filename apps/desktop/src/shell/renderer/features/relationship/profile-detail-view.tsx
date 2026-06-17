import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  ProfileDetailViewContent,
} from './profile-detail-view-content.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from './profile-detail-view-content-shell.js';
import { type ProfileDetailViewProps, useProfileDetailViewController } from './profile-detail-view-controller.js';

export type { EditableProfileDraft } from './profile-detail-view-parts.js';

export function ProfileDetailView(props: ProfileDetailViewProps) {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const setSelectedProfileIsSource = useAppStore((state) => state.setSelectedProfileIsSource);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const controller = useProfileDetailViewController(props, realmBaseUrl);

  if (props.loading) {
    return <ProfileDetailLoadingState label={t('ProfileView.loading')} />;
  }

  if (props.error) {
    return (
      <ProfileDetailErrorState
        backLabel={t('Common.back')}
        label={t('ProfileView.error')}
        onClose={props.onClose}
      />
    );
  }

  return (
    <ProfileDetailViewContent
      {...props}
      controller={controller}
      onVisitWorld={(worldNavigationId) => {
        setSelectedProfileId(props.profile.id);
        setSelectedProfileIsSource(props.profile.isSource);
        navigateToWorld(worldNavigationId);
      }}
    />
  );
}
