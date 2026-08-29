type AvatarLocalQuietListener = (quiet: boolean) => void;

// @nimi-authority: rule.nimi.avatar.embodiment.r025

let quiet = false;
const listeners = new Set<AvatarLocalQuietListener>();

export function isAvatarLocalQuiet(): boolean {
  return quiet;
}

export function setAvatarLocalQuiet(next: boolean): void {
  if (quiet === next) return;
  quiet = next;
  for (const listener of listeners) listener(quiet);
}

export function subscribeAvatarLocalQuiet(listener: AvatarLocalQuietListener): () => void {
  listeners.add(listener);
  listener(quiet);
  return () => listeners.delete(listener);
}
