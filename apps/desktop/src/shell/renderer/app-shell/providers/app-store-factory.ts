import { createStore, type StoreApi } from 'zustand/vanilla';

import { createAuthSlice } from './auth-slice.js';
import { createRuntimeSlice } from './runtime-slice.js';
import { createHomeNavigation, type HomeNavigation } from './home-navigation.js';
import type { AppStoreState } from './store-types.js';
import {
  createUiSlice,
  type UiSliceDependencies,
} from './ui-slice.js';

export type AppStoreDependencies = UiSliceDependencies;
export type AppStoreApi = StoreApi<AppStoreState> & { readonly navigation: HomeNavigation };

export function createAppStore(dependencies: AppStoreDependencies): AppStoreApi {
  const navigation = createHomeNavigation();
  const store = createStore<AppStoreState>((set) => ({
    ...createAuthSlice(set),
    ...createRuntimeSlice(set),
    ...createUiSlice(set, dependencies),
  }));
  const scopeOf = (state: AppStoreState) => [state.auth.status, state.auth.user?.id ?? '',
    state.auth.user?.realmEnvironmentId ?? '', state.runtimeDefaults?.realm.realmBaseUrl ?? ''] as const;
  let previousScope = scopeOf(store.getState());
  store.subscribe(state => {
    const scope = scopeOf(state);
    if (scope.every((value, index) => value === previousScope[index])) {
      const current = navigation.getSnapshot().current.destination.chat;
      if (current?.mode === 'agent' && current.conversationAnchorId && state.auth.status === 'authenticated') {
        const refreshed = Object.values(state.agentConversationTargetByHandle).find(target => target.conversationAnchorId === current.conversationAnchorId);
        if (refreshed?.agentHandle && refreshed.agentHandle !== current.agentHandle) void navigation.replace({ id: 'chat', chat: { ...current, agentHandle: refreshed.agentHandle, targetId: refreshed.agentHandle } });
      }
      return;
    }
    const previous = previousScope; previousScope = scope;
    // Token refresh is one account; loss/change of proven identity fences old page callbacks.
    const stable = (value: string) => value === 'authenticated' || value === 'refresh-pending';
    if (stable(previous[0]) && stable(scope[0]) && scope.slice(1).every((value, index) => value === previous[index + 1])) return;
    navigation.reset({ id: 'home' });
  });
  return Object.assign(store, { navigation });
}
