import { useQuery } from '@tanstack/react-query';
import { loadNimiRealmUserNotificationSettings } from '@nimiplatform/sdk/realm';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export const realmNotificationSettingsKey = (realm: string, account: string, revision: string) =>
  ['settings-notification', realm, account, revision] as const;

export function useRealmNotificationSettings() {
  const auth = useAppStore(state => state.auth);
  const sdk = useDesktopRendererSdk();
  return useQuery({
    queryKey: realmNotificationSettingsKey(String(auth.user?.realmEnvironmentId ?? ''), String(auth.user?.id ?? ''), auth.authorizationRevision),
    queryFn: () => loadNimiRealmUserNotificationSettings(sdk.realm()),
    enabled: Boolean(auth.user?.id) && (auth.status === 'authenticated' || auth.status === 'refresh-pending'),
  });
}
