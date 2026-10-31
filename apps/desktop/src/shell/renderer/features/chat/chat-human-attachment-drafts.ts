import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { PendingAttachment } from '../turns/turn-input-attachments.js';

const drafts = new WeakMap<HomeNavigation, ReturnType<typeof createHumanAttachmentDrafts>>();

/** Live Files survive leaving Chat; disk drafts still keep only attachment names. */
export function createHumanAttachmentDrafts(navigation: HomeNavigation, revoke = URL.revokeObjectURL) {
  const generation = navigation.getSnapshot().generation;
  const peers = new Map<string, readonly PendingAttachment[]>();
  const current = () => navigation.getSnapshot().generation === generation;
  const unsubscribe = navigation.subscribe(() => {
    if (current()) return;
    for (const items of peers.values()) for (const item of items) revoke(item.previewUrl);
    peers.clear(); unsubscribe();
  });
  return {
    current,
    get: (peer: string) => peers.get(peer) ?? [],
    set(peer: string, items: readonly PendingAttachment[]) {
      if (!current()) return;
      if (items.length) peers.set(peer, [...items]); else peers.delete(peer);
    },
  };
}

export function humanAttachmentDrafts(navigation: HomeNavigation) {
  let cache = drafts.get(navigation);
  if (!cache?.current()) { cache = createHumanAttachmentDrafts(navigation); drafts.set(navigation, cache); }
  return cache;
}
