import { describe, expect, it, vi } from 'vitest';
import { bindAvatarRendererRootLifecycle } from './renderer-root-lifecycle.js';

describe('Avatar renderer root lifecycle', () => {
  it('unmounts once on Host close, unregisters, and ignores duplicate close/unload', async () => {
    const target = new EventTarget();
    const unmount = vi.fn();
    const release = vi.fn();
    let onClose!: () => void;
    const lifetime = bindAvatarRendererRootLifecycle({ target, unmount,
      listenClosing: async handler => { onClose = handler; return release; } });
    expect(await lifetime.ready).toBe(true);
    target.dispatchEvent(new Event('visibilitychange'));
    expect(unmount).not.toHaveBeenCalled();
    onClose(); onClose();
    target.dispatchEvent(new Event('beforeunload'));
    target.dispatchEvent(new Event('pagehide'));
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('retires pending registration without allowing a late root mount', async () => {
    const target = new EventTarget();
    const unmount = vi.fn();
    const release = vi.fn();
    let resolve!: (release: () => void) => void;
    const lifetime = bindAvatarRendererRootLifecycle({ target, unmount,
      listenClosing: () => new Promise(done => { resolve = done; }) });
    target.dispatchEvent(new Event('beforeunload'));
    expect(unmount).toHaveBeenCalledTimes(1);
    resolve(release);
    expect(await lifetime.ready).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('closes on pagehide without requiring Host registration in a fixture', async () => {
    const target = new EventTarget();
    const unmount = vi.fn();
    const lifetime = bindAvatarRendererRootLifecycle({ target, unmount });
    expect(await lifetime.ready).toBe(true);
    target.dispatchEvent(new Event('pagehide'));
    lifetime.dispose();
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('does not mount if the required Host event cannot be registered', async () => {
    const unmount = vi.fn();
    const lifetime = bindAvatarRendererRootLifecycle({ target: new EventTarget(), unmount,
      listenClosing: async () => { throw new Error('host listener rejected'); } });
    await expect(lifetime.ready).rejects.toThrow('host listener rejected');
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});
