// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Pure (non-React) VRM render and recovery state. Owning this internal state
// here (instead of inside the React component) keeps the
// context-lost retry timing testable without R3F / WebGL and keeps the
// bounded 1500ms single recovery attempt testable without R3F / WebGL
// (rule.nimi.avatar.embodiment.r057).
//
// State diagram:
//
//     idle  ──start()──▶  loading  ──loader resolves──▶  ready
//                                 ╲
//                                  ╲──loader rejects──▶  failed_closed
//                                                         (load_failed)
//
//     ready  ──notifyContextLost()──▶  context_lost (retried=false)
//
//     context_lost  ──1500ms timer──▶  loader resolves──▶  ready
//                                  ╲
//                                   ╲──loader rejects──▶  failed_closed
//                                                          (context_lost_recovery_failed)
//
//     context_lost  ──notifyContextLost() (second loss)──▶ failed_closed
//                                                          (context_lost_twice)
//
import type { VRM } from '@pixiv/three-vrm';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { loadVrmFromManifest } from './vrm-loader.js';

/** Avatar-local WebGL context-lost recovery window in milliseconds. */
export const VRM_CONTEXT_LOST_RETRY_MS = 1500;

export type VrmRenderState =
  | { kind: 'idle' }
  | { kind: 'loading'; manifest: VrmAvatarModelManifest }
  | { kind: 'ready'; manifest: VrmAvatarModelManifest; vrm: VRM }
  | {
      kind: 'context_lost';
      manifest: VrmAvatarModelManifest;
      vrm: VRM;
      lostAt: number;
      retried: boolean;
    }
  | { kind: 'failed_closed'; reason: string; manifest?: VrmAvatarModelManifest };

export type VrmRuntimeOptions = {
  manifest: VrmAvatarModelManifest;
  /** Test seam: override the loader (default: real loadVrmFromManifest). */
  loaderOverride?: (manifest: VrmAvatarModelManifest) => Promise<VRM>;
  /** Test seam: override timer (default: globalThis.setTimeout). */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  /** Test seam: override timer cancel (default: globalThis.clearTimeout). */
  clearTimeoutFn?: (handle: unknown) => void;
  /** Test seam: override Date.now (default: real Date.now). */
  nowFn?: () => number;
};

export type VrmRuntime = {
  start(): Promise<void>;
  shutdown(): void;
  getState(): VrmRenderState;
  /** Surface callback when canvas fires `webglcontextlost`. Triggers the
   *  1500ms single-retry timer; a second loss before the timer fires
   *  promotes to fail-close (context_lost_twice). */
  notifyContextLost(): void;
  /** Surface callback when canvas fires `webglcontextrestored`. Browser
   *  auto-recovery does not prove the admitted reload path, so this must not
   *  cancel the 1500ms retry or promote the stale VRM back to ready. */
  notifyContextRestored(): void;
  subscribe(listener: (state: VrmRenderState) => void): () => void;
};

// @nimi-authority: rule.nimi.avatar.embodiment.r057
export function createVrmRuntime(opts: VrmRuntimeOptions): VrmRuntime {
  const loader = opts.loaderOverride ?? loadVrmFromManifest;
  const setTimeoutImpl: (handler: () => void, ms: number) => unknown =
    opts.setTimeoutFn ??
    ((handler, ms) => globalThis.setTimeout(handler, ms) as unknown);
  const clearTimeoutImpl: (handle: unknown) => void =
    opts.clearTimeoutFn ??
    ((handle) => {
      if (handle !== null && handle !== undefined) {
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    });
  const now = opts.nowFn ?? (() => Date.now());

  let state: VrmRenderState = { kind: 'idle' };
  let retryHandle: unknown = null;
  let shutdownRequested = false;
  const listeners = new Set<(s: VrmRenderState) => void>();

  function setState(next: VrmRenderState): void {
    state = next;
    for (const l of listeners) l(state);
  }

  function clearRetry(): void {
    if (retryHandle !== null && retryHandle !== undefined) {
      clearTimeoutImpl(retryHandle);
      retryHandle = null;
    }
  }

  async function runLoad(): Promise<void> {
    setState({ kind: 'loading', manifest: opts.manifest });
    try {
      const vrm = await loader(opts.manifest);
      if (shutdownRequested) return;
      setState({ kind: 'ready', manifest: opts.manifest, vrm });
    } catch (err) {
      if (shutdownRequested) return;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[avatar:vrm] model load failed: ${reason}`);
      setState({ kind: 'failed_closed', reason: 'load_failed', manifest: opts.manifest });
    }
  }

  async function runRetry(prior: { manifest: VrmAvatarModelManifest; lostAt: number }): Promise<void> {
    try {
      const vrm = await loader(prior.manifest);
      if (shutdownRequested) return;
      setState({ kind: 'ready', manifest: prior.manifest, vrm });
    } catch (err) {
      if (shutdownRequested) return;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[avatar:vrm] context-loss recovery failed: ${reason}`);
      setState({
        kind: 'failed_closed',
        reason: 'context_lost_recovery_failed',
        manifest: prior.manifest,
      });
    }
  }

  return {
    async start(): Promise<void> {
      if (state.kind !== 'idle') return;
      await runLoad();
    },
    shutdown(): void {
      shutdownRequested = true;
      clearRetry();
      listeners.clear();
    },
    getState(): VrmRenderState {
      return state;
    },
    notifyContextLost(): void {
      if (state.kind === 'ready') {
        const lostAt = now();
        setState({
          kind: 'context_lost',
          manifest: state.manifest,
          vrm: state.vrm,
          lostAt,
          retried: false,
        });
        const captured = { manifest: state.manifest, lostAt };
        retryHandle = setTimeoutImpl(() => {
          retryHandle = null;
          // Mark retried before invoking loader so a concurrent
          // notifyContextLost during the load still counts as a second loss.
          if (state.kind === 'context_lost') {
            setState({ ...state, retried: true });
          }
          void runRetry(captured);
        }, VRM_CONTEXT_LOST_RETRY_MS);
        return;
      }
      if (state.kind === 'context_lost') {
        // Second loss before/around the retry — fail-close immediately.
        clearRetry();
        setState({
          kind: 'failed_closed',
          reason: 'context_lost_twice',
          manifest: state.manifest,
        });
        return;
      }
      // idle / loading / failed_closed: no-op (the surface mounts
      // the canvas listener after first ready, but a stray event from a
      // late-bound listener should not reset the machine).
    },
    notifyContextRestored(): void {
      // A browser-level restored event can arrive before the runtime reloads
      // scene/textures/animations, so it cannot change render state.
      return;
    },
    subscribe(listener: (s: VrmRenderState) => void): () => void {
      listeners.add(listener);
      // Push current state on subscribe so consumers don't race the first transition.
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
