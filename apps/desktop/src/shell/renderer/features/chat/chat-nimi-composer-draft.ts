import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { ChatAiThreadRecord } from '../../bridge/runtime-bridge/types.js';

type ComposerMemory = { generation: number; text: Map<string, string>; ephemeralThread: ChatAiThreadRecord | null };
const drafts = new WeakMap<HomeNavigation, ComposerMemory>();

export function nimiComposerMemory(navigation: HomeNavigation): ComposerMemory {
  const generation = navigation.getSnapshot().generation;
  let cache = drafts.get(navigation);
  if (!cache || cache.generation !== generation) {
    cache = { generation, text: new Map(), ephemeralThread: null }; drafts.set(navigation, cache);
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
