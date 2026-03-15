import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  ContactDetailViewContent,
} from './contact-detail-view-content.js';
import {
  ContactDetailErrorState,
  ContactDetailLoadingState,
} from './contact-detail-view-content-shell.js';
import { type ContactDetailViewProps, useContactDetailViewController } from './contact-detail-view-controller.js';

export type { EditableProfileDraft } from './contact-detail-view-parts.js';

export function ContactDetailView(props: ContactDetailViewProps) {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const controller = useContactDetailViewController(props, realmBaseUrl);

  if (props.loading) {
    return <ContactDetailLoadingState label={t('ProfileView.loading')} />;
  }

  if (props.error) {
    return (
      <ContactDetailErrorState
        backLabel={t('Common.back')}
        label={t('ProfileView.error')}
        onClose={props.onClose}
      />
    );
  }

  return (
    <ContactDetailViewContent
      {...props}
      controller={controller}
      onVisitWorld={(worldNavigationId) => {
        setSelectedProfileId(props.profile.id);
        setSelectedProfileIsAgent(props.profile.isAgent);
        navigateToWorld(worldNavigationId);
      }}
    />
  );
}
