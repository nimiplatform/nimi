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
const NOOP_SUBSCRIBE = () => () => {};
const GET_IDLE_ATTENTION = () => IDLE_ATTENTION;
const AppAttentionSourceContext = createContext<AppAttentionSource | null>(null);

export function AppAttentionProvider({
  children,
  source,
}: PropsWithChildren<{ readonly source: AppAttentionSource }>) {
  return (
    <AppAttentionSourceContext.Provider value={source}>
      {children}
    </AppAttentionSourceContext.Provider>
  );
}

export function useAppAttention(): AppAttentionState {
  const source = useContext(AppAttentionSourceContext);
  return useSyncExternalStore(
    source ? source.subscribe : NOOP_SUBSCRIBE,
    source ? source.getSnapshot : GET_IDLE_ATTENTION,
    GET_IDLE_ATTENTION,
  );
}
