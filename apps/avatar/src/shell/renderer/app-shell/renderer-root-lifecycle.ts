// @nimi-authority: rule.nimi.avatar.embodiment.r009
// Closing notifications and page unload retire the React tree when delivered.
// Delivery may race stream replies; this advisory cleanup never delays Host
// revocation or bounded close.
export function bindAvatarRendererRootLifecycle(input: {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  unmount: () => void;
  listenClosing?: (handler: () => void) => Promise<() => void>;
}): { ready: Promise<boolean>; dispose: () => void } {
  let closed = false;
  let unlisten: (() => void) | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    input.target.removeEventListener('beforeunload', dispose);
    input.target.removeEventListener('pagehide', dispose);
    unlisten?.();
    unlisten = undefined;
    input.unmount();
  };
  input.target.addEventListener('beforeunload', dispose);
  input.target.addEventListener('pagehide', dispose);
  const ready = (async () => {
    try {
      const release = await input.listenClosing?.(dispose);
      if (closed) { release?.(); return false; }
      unlisten = release;
      return true;
    } catch (error) {
      dispose();
      throw error;
    }
  })();
  return { ready, dispose };
}
