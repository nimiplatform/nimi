import { useCallback, useEffect, useRef } from 'react';
import { selectMediaImage } from '@nimiplatform/kit/features/media/headless';
import { loadNimiRealmUserSettings, uploadNimiRealmResourceFile } from '@nimiplatform/sdk/realm';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore, useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useCurrentUserProfileProjection } from '../profile/current-user-profile.js';
import { toHumanProfileData } from '../profile/profile-model.js';
import { PublicProfileEditor, type ProfileVisibilitySummary } from '../profile/public-profile-editor.js';
import { openHomeSettings } from './settings-entry.js';
import { Card, PageShell } from './settings-layout-components.js';

function readProfileVisibility(value: unknown): ProfileVisibilitySummary | null {
  if (value === 'PUBLIC' || value === 'FRIENDS' || value === 'PRIVATE') return value;
  return null;
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
export function ProfilePage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const navigation = useHomeNavigation();
  const social = useRealmSocialData();
  const store = useAppStoreApi();
  const applyCurrentUserProfile = useAppStore((state) => state.applyCurrentUserProfile);
  const environment = useAppStore((state) => String(state.auth.user?.realmEnvironmentId || ''));
  const accountId = useAppStore((state) => String(state.auth.user?.id || ''));
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl || ''));
  const { query, queryKey } = useCurrentUserProfileProjection();
  const queryClient = useQueryClient();
  const operations = useRef(new Set<NonNullable<ReturnType<typeof captureAccountActionScope>>>());
  const pendingWebHandleSync = useRef(false);

  useEffect(() => () => {
    for (const scope of operations.current) scope.dispose();
    operations.current.clear();
  }, []);

  const refreshProfileAfterWebHandoff = useCallback(() => {
    if (!pendingWebHandleSync.current) return;
    pendingWebHandleSync.current = false;
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    void queryClient.invalidateQueries({ queryKey: ['human-profile-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
  }, [queryClient, queryKey]);

  useEffect(() => {
    const events = bindings.app?.events;
    if (!events) return undefined;
    const stopFocus = events.subscribeWindowFocus?.((focused) => {
      if (focused) refreshProfileAfterWebHandoff();
    });
    const stopVisibility = events.subscribeDocumentVisibility?.((visible) => {
      if (visible) refreshProfileAfterWebHandoff();
    });
    return () => {
      stopFocus?.();
      stopVisibility?.();
    };
  }, [bindings, refreshProfileAfterWebHandoff]);

  const privacyQuery = useQuery({
    queryKey: ['settings-privacy-summary', realmBaseUrl, accountId],
    queryFn: async () => {
      const realm = bindings.sdk.realm();
      if (typeof realm.account?.getMySettings !== 'function') return null;
      const settings = await loadNimiRealmUserSettings(realm);
      return readProfileVisibility(settings.profileVisibility);
    },
    enabled: Boolean(accountId),
    staleTime: 60_000,
    retry: false,
  });

  const begin = () => {
    const scope = captureAccountActionScope(store);
    if (!scope || scope.accountId !== accountId) throw new Error(t('Profile.accountUnavailable'));
    operations.current.add(scope);
    return scope;
  };
  const finish = (scope: NonNullable<ReturnType<typeof captureAccountActionScope>>) => {
    operations.current.delete(scope);
    scope.dispose();
  };

  if (!query.data || query.data.id !== accountId) {
    return (
      <PageShell title={t('Profile.pageTitle')} description={t('Profile.pageDescription')}>
        <Card>
          {query.isError ? (
            <>
              <InlineAlert tone="danger">{t('Profile.profileLoadFailed')}</InlineAlert>
              <Button tone="secondary" onClick={() => { void query.refetch(); }}>{t('Common.retry')}</Button>
            </>
          ) : (
            <p role="status">{t('Common.loading')}</p>
          )}
        </Card>
      </PageShell>
    );
  }

  const profile = toHumanProfileData(query.data);
  return (
    <PublicProfileEditor
      key={queryKey.slice(0, 4).join('|')}
      profile={profile}
      profileVisibility={privacyQuery.data ?? null}
      onCopyHandle={bindings.app?.commands?.writeClipboardText
        ? (handle) => bindings.app.commands.writeClipboardText(handle)
        : undefined}
      onManageUsernameInWeb={bindings.app?.commands?.openAccountManagement
        ? async () => {
          await bindings.app.commands.openAccountManagement('profile');
          pendingWebHandleSync.current = true;
        }
        : undefined}
      onOpenPrivacy={() => { void openHomeSettings(navigation, 'privacy'); }}
      onOpenFullProfile={() => { void navigation.push({ id: 'profile', profileId: accountId }); }}
      onSave={async (patch) => {
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
        } finally {
          finish(scope);
        }
      }}
      onUploadAvatar={async (file) => {
        const scope = begin();
        try {
          const uploaded = await uploadNimiRealmResourceFile(bindings.sdk.realm(), {
            kind: 'image',
            file,
            failureMessage: t('Profile.avatarUploadFailed'),
            options: { signal: scope.signal },
            cancelOnAbort: false,
          });
          if (!scope.isCurrent()) return null;
          const avatarMedia = uploaded.resource.delivery;
          const avatarUrl = selectMediaImage(avatarMedia, 'avatar')?.src;
          if (!avatarUrl) throw new Error(t('Profile.avatarUploadFailed'));
          return { avatarUrl, avatarMedia, avatarResourceId: uploaded.resourceId };
        } finally {
          finish(scope);
        }
      }}
    />
  );
}
