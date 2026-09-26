import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useNimiTheme } from '@nimiplatform/kit/ui';
import type { Language } from '../domain/types.js';
import { copyFor, resolveLanguage, type Copy } from '../i18n/index.js';
import { createActivityBridge } from '../platform/activity-bridge.js';
import { createAgentDesk, type DeskState } from '../platform/agent-desk.js';
import { createDayEngine, type EngineState, type NavTarget } from '../platform/engine.js';
import { NimiDayContext, type NimiDayContextValue, type Services } from './context-object.js';
import { dayActions } from '../store/actions.js';
import { createDayStore, type StoreSnapshot } from '../store/day-store.js';
import { runtimeDocumentStore } from '../store/persistence.js';
import { getNimiLocalAppClient } from '../../shell/auth/local-app-client.js';

const NAV_STORAGE_KEY = 'nimiday.view.v1';

function initialNav(): NavTarget {
  try {
    const stored = globalThis.localStorage?.getItem(NAV_STORAGE_KEY);
    if (stored === 'care' || stored === 'items' || stored === 'routines' || stored === 'assistant' || stored === 'settings' || stored === 'followups') return { view: stored };
  } catch {
    // Remembering the last page is a convenience only.
  }
  return { view: 'today' };
}

function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function NimiDayProvider({ children }: { readonly children: ReactNode }) {
  const [nav, setNav] = useState<NavTarget>(initialNav);
  const navigate = useCallback((target: NavTarget) => {
    setNav(target);
    try {
      globalThis.localStorage?.setItem(NAV_STORAGE_KEY, target.view);
    } catch {
      // Ignore: the page choice is not business state.
    }
  }, []);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const services = useMemo<Services>(() => {
    const client = getNimiLocalAppClient();
    let languageRef: Language = resolveLanguage('auto');
    const store = createDayStore(runtimeDocumentStore(client.storage), { language: () => languageRef });
    const actions = dayActions(store);
    const desk = createAgentDesk(client, { history: () => store.getSnapshot().state.runs });
    const activity = createActivityBridge(client.activity);
    const engine = createDayEngine({
      store,
      actions,
      desk,
      activity,
      language: () => languageRef,
      copy: () => copyFor(languageRef),
      navigate: (target) => navigateRef.current(target),
    });
    store.subscribe(() => {
      languageRef = resolveLanguage(store.getSnapshot().state.profile.language);
    });
    return { store, actions, desk, activity, engine };
  }, []);

  const snapshot = useSyncExternalStore(services.store.subscribe, services.store.getSnapshot);
  const language = resolveLanguage(snapshot.state.profile.language);
  const copy = copyFor(language);

  useEffect(() => {
    globalThis.document?.documentElement.setAttribute('lang', language === 'zh' ? 'zh-CN' : 'en');
  }, [language]);

  useEffect(() => {
    void services.store.load();
    const navigationTimer = setInterval(() => { void invoke('nimiday.navigation.take').then(value => { if (value) navigateRef.current(value as NavTarget); }).catch(() => {}); }, 1000);
    const flush = () => { void services.store.flush(); };
    globalThis.addEventListener?.('pagehide', flush);
    return () => {
      globalThis.removeEventListener?.('pagehide', flush);
      clearInterval(navigationTimer);
    };
  }, [services]);

  const loaded = snapshot.status === 'ready';
  const closed = snapshot.status === 'closed';
  useEffect(() => {
    // Once the session is over, everything is reloaded from the one now in place:
    // the old store, engine and conversation are discarded with this page.
    if (!closed) return;
    const timer = setTimeout(() => globalThis.location?.reload(), 1_500);
    return () => clearTimeout(timer);
  }, [closed]);
  useEffect(() => {
    if (!loaded) return;
    void services.desk.start(services.store.getSnapshot().state.profile.appointment);
    services.engine.start();
    return () => {
      void services.engine.stop();
      void services.desk.dispose();
    };
  }, [loaded, services]);

  const theme = useNimiTheme();
  const themePreference = snapshot.state.profile.theme;
  useEffect(() => {
    const apply = () => theme.setScheme(themePreference === 'system' ? (prefersDark() ? 'dark' : 'light') : themePreference);
    apply();
    if (themePreference !== 'system') return;
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themePreference]);

  const value = useMemo<NimiDayContextValue>(() => ({ ...services, nav, navigate, language, copy }), [services, nav, navigate, language, copy]);
  return <NimiDayContext.Provider value={value}>{children}</NimiDayContext.Provider>;
}

export function useNimiDay(): NimiDayContextValue {
  const value = useContext(NimiDayContext);
  if (!value) throw new Error('NimiDay context is missing.');
  return value;
}

export function useDayStore(): StoreSnapshot {
  const { store } = useNimiDay();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useDesk(): DeskState {
  const { desk } = useNimiDay();
  return useSyncExternalStore(desk.subscribe, desk.getState);
}

export function useEngine(): EngineState {
  const { engine } = useNimiDay();
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

export function useCopy(): Copy {
  return useNimiDay().copy;
}
