// Wave 2 chunk 2-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Pure (non-React) VRM lifecycle state machine. The carrier surface
// subscribes to state transitions and forwards lifecycle evidence via the
// BackendSurfaceProps onLifecycleEvidence callback. Owning the state
// machine here (instead of inside the React component) keeps the
// context-lost retry timing testable without R3F / WebGL and keeps the
// 1500ms single-retry contract enforceable as a unit test (acceptance
// invariant: vrm-backend-contract.md §2.3 + packet wave-2 invariant
// "1500ms single retry then fail-close on second loss").
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
// Evidence kind strings match the contract callback surface; the
// `avatar.carrier.lifecycle.` prefix is added at the embodiment-stage
// layer when forwarding to recordAvatarEvidenceEventually.

import type { VRM } from '@pixiv/three-vrm';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { loadVrmFromManifest } from './vrm-loader.js';

/** WebGL context-lost retry window in ms (vrm-backend-contract.md §2.3). */
export const VRM_CONTEXT_LOST_RETRY_MS = 1500;

export type VrmLifecycleState =
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

export type VrmLifecycleEvidenceCallback = (
  kind: string,
  detail: Record<string, unknown>,
) => void;

export type VrmRuntimeOptions = {
  manifest: VrmAvatarModelManifest;
  onEvidence?: VrmLifecycleEvidenceCallback;
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
  getState(): VrmLifecycleState;
  /** Surface callback when canvas fires `webglcontextlost`. Triggers the
   *  1500ms single-retry timer; a second loss before the timer fires
   *  promotes to fail-close (context_lost_twice). */
  notifyContextLost(): void;
  /** Surface callback when canvas fires `webglcontextrestored`. Browser
   *  auto-recovery does not prove the admitted reload path, so this must not
   *  cancel the 1500ms retry or promote the stale VRM back to ready. */
  notifyContextRestored(): void;
  subscribe(listener: (state: VrmLifecycleState) => void): () => void;
};

export function createVrmRuntime(opts: VrmRuntimeOptions): VrmRuntime {
  const onEvidence = opts.onEvidence ?? (() => {});
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

  let state: VrmLifecycleState = { kind: 'idle' };
  let retryHandle: unknown = null;
  let shutdownRequested = false;
  const listeners = new Set<(s: VrmLifecycleState) => void>();

  function setState(next: VrmLifecycleState): void {
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
      onEvidence('load_failed', { reason });
      onEvidence('failed_closed', { reason: 'load_failed', cause: reason });
      setState({ kind: 'failed_closed', reason: 'load_failed', manifest: opts.manifest });
    }
  }

  async function runRetry(prior: { manifest: VrmAvatarModelManifest; lostAt: number }): Promise<void> {
    try {
      const vrm = await loader(prior.manifest);
      if (shutdownRequested) return;
      const restoreDurationMs = now() - prior.lostAt;
      onEvidence('context_restored', { restoreDurationMs });
      setState({ kind: 'ready', manifest: prior.manifest, vrm });
    } catch (err) {
      if (shutdownRequested) return;
      const reason = err instanceof Error ? err.message : String(err);
      onEvidence('failed_closed', { reason: 'context_lost_recovery_failed', cause: reason });
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
    getState(): VrmLifecycleState {
      return state;
    },
    notifyContextLost(): void {
      if (state.kind === 'ready') {
        const lostAt = now();
        onEvidence('context_lost', { lostAt });
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
        onEvidence('failed_closed', { reason: 'context_lost_twice' });
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
      // Contract authority requires context_restored evidence only after the
      // 1500ms single retry reloads the VRM scene/textures/animations. A
      // browser-level restored event can arrive earlier, but it is not
      // sufficient recovery proof and therefore cannot change lifecycle state.
      return;
    },
    subscribe(listener: (s: VrmLifecycleState) => void): () => void {
      listeners.add(listener);
      // Push current state on subscribe so consumers don't race the first transition.
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
