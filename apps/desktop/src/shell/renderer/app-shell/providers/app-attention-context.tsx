import {
  createContext,
  useContext,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';

import {
  createIdleAppAttentionState,
  type AppAttentionState,
} from './app-attention-state.js';
import type { AppAttentionSource } from './app-attention-source.js';

const IDLE_ATTENTION = createIdleAppAttentionState();
const AppAttentionContext = createContext<AppAttentionState>(IDLE_ATTENTION);

export function AppAttentionProvider({
  children,
  source,
}: PropsWithChildren<{ readonly source: AppAttentionSource }>) {
  const attention = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    () => IDLE_ATTENTION,
  );
  return (
    <AppAttentionContext.Provider value={attention}>
      {children}
    </AppAttentionContext.Provider>
  );
}

export function useAppAttention(): AppAttentionState {
  return useContext(AppAttentionContext);
}
