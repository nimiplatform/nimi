import { useEffect, useRef } from 'react';
import { selectMediaImage } from '@nimiplatform/kit/features/media/headless';
import { uploadNimiRealmResourceFile } from '@nimiplatform/sdk/realm';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useCurrentUserProfileProjection } from '../profile/current-user-profile.js';
import { toHumanProfileData } from '../profile/profile-model.js';
import { PublicProfileEditor } from '../profile/public-profile-editor.js';
import { ProfileHandleEditor } from '../profile/profile-handle-editor.js';
import { Card, PageShell } from './settings-layout-components.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
export function ProfilePage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const social = useRealmSocialData();
  const store = useAppStoreApi();
  const applyCurrentUserProfile = useAppStore(state => state.applyCurrentUserProfile);
  const environment = useAppStore(state => String(state.auth.user?.realmEnvironmentId || ''));
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const { query, queryKey } = useCurrentUserProfileProjection();
  const queryClient = useQueryClient();
  const operations = useRef(new Set<NonNullable<ReturnType<typeof captureAccountActionScope>>>());
  useEffect(() => () => { for (const scope of operations.current) scope.dispose(); operations.current.clear(); }, []);
  const begin = () => {
    const scope = captureAccountActionScope(store);
    if (!scope || scope.accountId !== accountId) throw new Error(t('Profile.accountUnavailable'));
    operations.current.add(scope);
    return scope;
  };
  const finish = (scope: NonNullable<ReturnType<typeof captureAccountActionScope>>) => { operations.current.delete(scope); scope.dispose(); };

  if (!query.data || query.data.id !== accountId) return <PageShell title={t('Profile.pageTitle')} description={t('Profile.pageDescription')}>
    <Card>{query.isError ? <><InlineAlert tone="danger">{t('Profile.profileLoadFailed')}</InlineAlert><Button tone="secondary" onClick={() => { void query.refetch(); }}>{t('Common.retry')}</Button></> : <p role="status">{t('Common.loading')}</p>}</Card>
  </PageShell>;

  const profile = toHumanProfileData(query.data);
  return <PublicProfileEditor key={queryKey.slice(0, 4).join('|')} profile={profile} usernameAction={<ProfileHandleEditor />}
    onSave={async patch => {
      const scope = begin();
      try {
        const updated = await social.updateUserProfile(patch);
        if (!scope.isCurrent()) return null;
        queryClient.setQueryData(queryKey, updated);
        applyCurrentUserProfile({ ...updated }, environment);
        void queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        void queryClient.invalidateQueries({ queryKey: ['human-profile-detail'] });
        void queryClient.invalidateQueries({ queryKey: ['contacts'] });
        return toHumanProfileData(updated);
      } finally { finish(scope); }
    }}
    onUploadAvatar={async file => {
      const scope = begin();
      try {
        const uploaded = await uploadNimiRealmResourceFile(bindings.sdk.realm(), {
          kind: 'image', file, failureMessage: t('Profile.avatarUploadFailed'),
          options: { signal: scope.signal }, cancelOnAbort: false,
        });
        if (!scope.isCurrent()) return null;
        const avatarMedia = uploaded.resource.delivery;
        const avatarUrl = selectMediaImage(avatarMedia, 'avatar')?.src;
        if (!avatarUrl) throw new Error(t('Profile.avatarUploadFailed'));
        return { avatarUrl, avatarMedia, avatarResourceId: uploaded.resourceId };
      } finally { finish(scope); }
    }}
  />;
}
