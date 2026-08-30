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
import { VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { loadVrmFromManifest } from './vrm-loader.js';

/** Avatar-local WebGL context-lost recovery window in milliseconds. */
export const VRM_CONTEXT_LOST_RETRY_MS = 1500;
/** Shared conservative bound for model loading and the first visible frame. */
export const VRM_PRESENTATION_WATCHDOG_TIMEOUT_MS = 45_000;

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
  /** Test seam; production deeply disposes the retired scene resources. */
  disposeVrm?: (vrm: VRM) => void;
  /** Detach projection/mixer consumers before a VRM becomes stale or is disposed. */
  beforeDisposeVrm?: (vrm: VRM) => void;
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
  /** Fail closed when the exact current VRM cannot produce a visible frame
   *  within the shared presentation watchdog. */
  notifyFirstFrameTimedOut(vrm: VRM): void;
  subscribe(listener: (state: VrmRenderState) => void): () => void;
};

type VrmLoadOutcome =
  | { kind: 'loaded'; vrm: VRM }
  | { kind: 'rejected'; error: unknown }
  | { kind: 'timed_out' }
  | { kind: 'cancelled' };

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
  const disposeVrm = opts.disposeVrm ?? ((vrm: VRM) => {
    if (vrm.scene) VRMUtils.deepDispose(vrm.scene);
  });
  const beforeDisposeVrm = opts.beforeDisposeVrm ?? (() => {});

  let state: VrmRenderState = { kind: 'idle' };
  let retryHandle: unknown = null;
  let cancelPendingLoad: (() => void) | null = null;
  let shutdownRequested = false;
  let attemptGeneration = 0;
  const disposedVrms = new Set<VRM>();
  const detachedVrms = new Set<VRM>();
  const listeners = new Set<(s: VrmRenderState) => void>();

  function detachOnce(vrm: VRM): void {
    if (detachedVrms.has(vrm)) return;
    detachedVrms.add(vrm);
    try {
      beforeDisposeVrm(vrm);
    } catch (error) {
      console.warn(`[avatar:vrm] failed to detach retired VRM consumers: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function disposeOnce(vrm: VRM): void {
    if (disposedVrms.has(vrm)) return;
    detachOnce(vrm);
    disposedVrms.add(vrm);
    disposeVrm(vrm);
  }

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

  function waitForLoadOutcome(): Promise<VrmLoadOutcome> {
    let load: Promise<VRM>;
    try {
      load = loader(opts.manifest);
    } catch (error) {
      load = Promise.reject(error);
    }
    return new Promise((resolve) => {
      let settled = false;
      let watchdogHandle: unknown = null;
      let cancel = (): void => {};
      const finish = (outcome: VrmLoadOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(watchdogHandle);
        if (cancelPendingLoad === cancel) cancelPendingLoad = null;
        resolve(outcome);
      };
      watchdogHandle = setTimeoutImpl(() => {
        finish({ kind: 'timed_out' });
      }, VRM_PRESENTATION_WATCHDOG_TIMEOUT_MS);
      cancel = (): void => finish({ kind: 'cancelled' });
      cancelPendingLoad = cancel;
      void load.then(
        (vrm) => {
          if (settled) {
            disposeOnce(vrm);
            return;
          }
          finish({ kind: 'loaded', vrm });
        },
        (error) => {
          if (!settled) finish({ kind: 'rejected', error });
        },
      );
    });
  }

  async function runLoad(): Promise<void> {
    const attempt = ++attemptGeneration;
    setState({ kind: 'loading', manifest: opts.manifest });
    const outcome = await waitForLoadOutcome();
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'loaded') {
      if (shutdownRequested || attempt !== attemptGeneration || state.kind !== 'loading') {
        disposeOnce(outcome.vrm);
        return;
      }
      detachedVrms.delete(outcome.vrm);
      setState({ kind: 'ready', manifest: opts.manifest, vrm: outcome.vrm });
      return;
    }
    if (shutdownRequested || attempt !== attemptGeneration || state.kind !== 'loading') return;
    attemptGeneration += 1;
    if (outcome.kind === 'timed_out') {
      setState({ kind: 'failed_closed', reason: 'load_timed_out', manifest: opts.manifest });
      return;
    }
    const reason = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    console.warn(`[avatar:vrm] model load failed: ${reason}`);
    setState({ kind: 'failed_closed', reason: 'load_failed', manifest: opts.manifest });
  }

  async function runRetry(
    prior: { manifest: VrmAvatarModelManifest; lostAt: number },
    attempt: number,
  ): Promise<void> {
    const staleVrm = state.kind === 'context_lost' ? state.vrm : null;
    const outcome = await waitForLoadOutcome();
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'loaded') {
      if (shutdownRequested
        || attempt !== attemptGeneration
        || state.kind !== 'context_lost'
        || state.lostAt !== prior.lostAt
        || !state.retried) {
        disposeOnce(outcome.vrm);
        return;
      }
      if (staleVrm && staleVrm !== outcome.vrm) disposeOnce(staleVrm);
      detachedVrms.delete(outcome.vrm);
      setState({ kind: 'ready', manifest: prior.manifest, vrm: outcome.vrm });
      return;
    }
    if (shutdownRequested
      || attempt !== attemptGeneration
      || state.kind !== 'context_lost'
      || state.lostAt !== prior.lostAt
      || !state.retried) return;
    attemptGeneration += 1;
    if (staleVrm) disposeOnce(staleVrm);
    if (outcome.kind === 'timed_out') {
      setState({
        kind: 'failed_closed',
        reason: 'context_lost_recovery_timed_out',
        manifest: prior.manifest,
      });
      return;
    }
    const reason = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    console.warn(`[avatar:vrm] context-loss recovery failed: ${reason}`);
    setState({
      kind: 'failed_closed',
      reason: 'context_lost_recovery_failed',
      manifest: prior.manifest,
    });
  }

  return {
    async start(): Promise<void> {
      if (state.kind !== 'idle') return;
      await runLoad();
    },
    shutdown(): void {
      shutdownRequested = true;
      attemptGeneration += 1;
      clearRetry();
      cancelPendingLoad?.();
      if (state.kind === 'ready' || state.kind === 'context_lost') {
        disposeOnce(state.vrm);
      }
      state = { kind: 'idle' };
      listeners.clear();
    },
    getState(): VrmRenderState {
      return state;
    },
    notifyContextLost(): void {
      if (state.kind === 'ready') {
        const lostAt = now();
        detachOnce(state.vrm);
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
            const attempt = ++attemptGeneration;
            void runRetry(captured, attempt);
          }
        }, VRM_CONTEXT_LOST_RETRY_MS);
        return;
      }
      if (state.kind === 'context_lost') {
        // Second loss before/around the retry — fail-close immediately.
        clearRetry();
        attemptGeneration += 1;
        cancelPendingLoad?.();
        const staleVrm = state.vrm;
        setState({
          kind: 'failed_closed',
          reason: 'context_lost_twice',
          manifest: state.manifest,
        });
        disposeOnce(staleVrm);
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
    notifyFirstFrameTimedOut(vrm): void {
      if (state.kind !== 'ready' || state.vrm !== vrm) return;
      attemptGeneration += 1;
      setState({
        kind: 'failed_closed',
        reason: 'visible_first_frame_timed_out',
        manifest: state.manifest,
      });
      disposeOnce(vrm);
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
