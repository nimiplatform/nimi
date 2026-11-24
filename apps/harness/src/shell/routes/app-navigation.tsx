import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createNimiNavigation } from '@nimiplatform/kit/core/navigation';
import { NimiNavigationProvider } from '@nimiplatform/kit/ui/app-chrome';

export type Destination = { id: 'conversations' | 'models' };
export function createAppNavigation() {
  return createNimiNavigation<Destination>({
    initial: { id: 'conversations' },
    validate(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 1 || !('id' in value)
        || (value.id !== 'conversations' && value.id !== 'models')) throw new Error('Unknown App destination.');
      return { id: value.id };
    },
  });
}
type Owner = { navigation: ReturnType<typeof createAppNavigation>; ready: boolean; setReady(value: boolean): void;
  sidebarVisible: boolean; setSidebarVisible(value: boolean): void };
const Context = createContext<Owner | null>(null);
export function useAppNavigation() {
  const owner = useContext(Context);
  if (!owner) throw new Error('App navigation owner is missing.');
  return owner;
}
export function AppNavigationProvider({ children }: { children: ReactNode }) {
  const [navigation] = useState(createAppNavigation);
  const [ready, updateReady] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const lifetime = useRef(0);
  useEffect(() => {
    const generation = ++lifetime.current;
    return () => {
      navigation.reset({ id: 'conversations' });
      queueMicrotask(() => { if (lifetime.current === generation) navigation.dispose(); });
    };
  }, [navigation]);
  const setReady = useCallback((value: boolean) => { if (!value) navigation.reset({ id: 'conversations' }); updateReady(value); }, [navigation]);
  return <Context.Provider value={{ navigation, ready, setReady, sidebarVisible, setSidebarVisible }}><NimiNavigationProvider controller={navigation}>{children}</NimiNavigationProvider></Context.Provider>;
}
