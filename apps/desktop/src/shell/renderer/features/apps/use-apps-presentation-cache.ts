import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { AppsPresentationCache, createAppsPresentationStorage } from './apps-presentation-cache.js';

export function useAppsPresentationCache(): AppsPresentationCache {
  const client = useQueryClient();
  const accountId = useAppStore(state => String(state.auth.user?.id ?? ''));
  const key = ['desktop', 'apps-presentation-cache', accountId] as const;
  let cache = client.getQueryData<AppsPresentationCache>(key);
  if (!cache) {
    cache = new AppsPresentationCache({ scope: accountId, storage: accountId ? createAppsPresentationStorage() : undefined });
    client.setQueryDefaults(key, { gcTime: Infinity });
    client.setQueryData(key, cache);
  }
  return cache;
}
