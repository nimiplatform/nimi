import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
// @nimi-authority: rule.nimi.desktop.product-surfaces.connections
export function useHomeRemoteAccessQuery() {
  const sdk = useDesktopRendererSdk();
  const auth = useAppStore(state => state.auth);
  const account = String(auth.user?.id ?? '');
  const realm = String(auth.user?.realmEnvironmentId ?? '');
  return useQuery({ queryKey: ['home-remote-access', realm, account, auth.authorizationRevision],
    enabled: auth.status === 'authenticated' && Boolean(account && realm), retry: false,
    queryFn: () => sdk.accountProduct().remoteAccess.getRemoteAccessState({}), refetchInterval: 2500 });
}

export function useHomePrimaryRuntimeQuery() {
  const sdk = useDesktopRendererSdk();
  const auth = useAppStore(state => state.auth);
  const account = String(auth.user?.id ?? '');
  const realm = String(auth.user?.realmEnvironmentId ?? '');
  return useQuery({ queryKey: ['primary-runtime-binding', realm, account],
    enabled: auth.status === 'authenticated' && Boolean(account && realm), retry: false,
    queryFn: () => sdk.accountProduct().primaryRuntime.getPrimaryRuntimeState({}) });
}
