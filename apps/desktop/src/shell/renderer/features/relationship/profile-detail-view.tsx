import { useTranslation } from 'react-i18next';
import {
  ProfileDetailViewContent,
} from './profile-detail-view-content.js';
import {
  ProfileDetailErrorState,
  ProfileDetailLoadingState,
} from './profile-detail-view-content-shell.js';
import { type ProfileDetailViewProps, useProfileDetailViewController } from './profile-detail-view-controller.js';

export function ProfileDetailView(props: ProfileDetailViewProps) {
  const { t } = useTranslation();
  const controller = useProfileDetailViewController(props);

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

  return <ProfileDetailViewContent {...props} controller={controller} />;
}
