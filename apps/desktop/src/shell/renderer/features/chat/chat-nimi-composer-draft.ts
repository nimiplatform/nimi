import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { ChatAiThreadRecord } from '../../bridge/runtime-bridge/types.js';

type NimiChatPendingTurn = { threadId: string; phase: 'generating' | 'saving' | 'unconfirmed'; text?: string; stop?: () => void; retrySave?: () => void };
export type ComposerMemory = ReturnType<typeof createComposerMemory>;

function createComposerMemory(generation: number) {
  let state = { pending: null as NimiChatPendingTurn | null, ephemeralThread: null as ChatAiThreadRecord | null };
  const listeners = new Set<() => void>();
  const update = (next: typeof state) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    generation,
    text: new Map<string, string>(),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    setPending(pending: NimiChatPendingTurn | null) { update({ ...state, pending }); },
    setEphemeralThread(ephemeralThread: ChatAiThreadRecord | null) { update({ ...state, ephemeralThread }); },
  };
}
const drafts = new WeakMap<HomeNavigation, ComposerMemory>();

export function nimiComposerMemory(navigation: HomeNavigation): ComposerMemory {
  const generation = navigation.getSnapshot().generation;
  let cache = drafts.get(navigation);
  if (!cache || cache.generation !== generation) {
    cache = createComposerMemory(generation); drafts.set(navigation, cache);
  }
  return cache;
}

/** Keep unsent Nimi input, including the landing composer, across Home visits. */
export function nimiComposerDraftRef(navigation: HomeNavigation, threadId: string | null, savedText: string) {
  const generation = navigation.getSnapshot().generation;
  const cache = nimiComposerMemory(navigation);
  const values = cache.text;
  const key = threadId ?? '';
  return {
    get current() { return navigation.getSnapshot().generation === generation ? values.get(key) ?? savedText : ''; },
    set current(text: string) { if (navigation.getSnapshot().generation === generation) values.set(key, text); },
  };
}
