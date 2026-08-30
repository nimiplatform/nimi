import { useEffect, useRef, useState } from 'react';
import type { Live2DBackendSession } from './backend-session.js';
import {
  createLive2DCarrierVisualHost,
  type Live2DCarrierVisualHost,
} from './carrier-visual-host.js';
import type { BackendAudioConsumer } from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DLipsyncDriver } from './live2d-lipsync-driver.js';
import { PresentationUnavailableSurface } from '../presentation-unavailable/presentation-unavailable-surface.js';
import type { BackendPresentationState } from '../carrier/backend-branch.js';

type Live2DCarrierVisualSurfaceProps = {
  session: Live2DBackendSession | null;
  audioConsumer: BackendAudioConsumer;
  paramMouthFormSupported: boolean;
  reducedMotion?: boolean;
  onPresentationStateChange?: (state: BackendPresentationState) => void;
};

type Live2DVisualSurfaceStatus = 'idle' | 'loading' | 'recovering' | 'ready' | 'error';
const LIVE2D_CONTEXT_RECOVERY_ATTEMPTS = 1;
// Conservative local watchdogs prevent a missing browser restore event or a
// hung local resource read from retaining loading/recovering forever. These
// are runtime safety bounds, not release or performance evidence.
export const LIVE2D_VISUAL_LOAD_TIMEOUT_MS = 45_000;
export const LIVE2D_CONTEXT_RESTORE_TIMEOUT_MS = 15_000;

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error || 'Live2D carrier visual failed');
}

function measureHost(host: HTMLDivElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(host.clientWidth || host.getBoundingClientRect().width || 240)),
    height: Math.max(1, Math.round(host.clientHeight || host.getBoundingClientRect().height || 260)),
  };
}

function hasObservedCarrierOutput(stats: ReturnType<Live2DCarrierVisualHost['drawFrame']>): boolean {
  return stats.textureBindingCount > 0
    && stats.visibleNonZeroOpacityDrawableCount > 0;
}

// @nimi-authority: rule.nimi.avatar.embodiment.r035
// @nimi-authority: rule.nimi.avatar.embodiment.r076
export function Live2DCarrierVisualSurface({
  session,
  audioConsumer,
  paramMouthFormSupported,
  reducedMotion,
  onPresentationStateChange,
}: Live2DCarrierVisualSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lipsyncDriverRef = useRef(createLive2DLipsyncDriver());
  const lastFrameTimeRef = useRef<number | null>(null);
  const [status, setStatus] = useState<Live2DVisualSurfaceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<Live2DVisualSurfaceStatus>('idle');
  const presentationCallbackRef = useRef(onPresentationStateChange);
  presentationCallbackRef.current = onPresentationStateChange;
  const reducedMotionRef = useRef(reducedMotion === true);
  reducedMotionRef.current = reducedMotion === true;

  const setSurfaceStatus = (
    nextStatus: Live2DVisualSurfaceStatus,
    reason?: string,
  ): void => {
    if (statusRef.current === nextStatus && nextStatus !== 'error') return;
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    if (nextStatus === 'loading') presentationCallbackRef.current?.({ kind: 'loading' });
    if (nextStatus === 'recovering') presentationCallbackRef.current?.({ kind: 'recovering' });
    if (nextStatus === 'ready') presentationCallbackRef.current?.({ kind: 'ready' });
    if (nextStatus === 'error') {
      presentationCallbackRef.current?.({
        kind: 'unavailable',
        reason: reason?.trim() || 'live2d_presentation_unavailable',
      });
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !session?.execution.loaded) {
      lastFrameTimeRef.current = null;
      setSurfaceStatus('idle');
      setError(null);
      host?.replaceChildren();
      return;
    }

    let cancelled = false;
    let attemptGeneration = 0;
    let recoveryAttempts = 0;
    let animationFrame = 0;
    let reducedMotionTimer: number | null = null;
    let attemptWatchdog: number | null = null;
    let contextRestoreWatchdog: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let visualHost: Live2DCarrierVisualHost | null = null;
    let activeCanvas: HTMLCanvasElement | null = null;
    let removeCanvasListeners: () => void = () => {};
    lastFrameTimeRef.current = null;
    setError(null);

    const stopFrameScheduling = (): void => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
      if (reducedMotionTimer !== null) {
        window.clearTimeout(reducedMotionTimer);
        reducedMotionTimer = null;
      }
    };

    const clearAttemptWatchdog = (): void => {
      if (attemptWatchdog === null) return;
      window.clearTimeout(attemptWatchdog);
      attemptWatchdog = null;
    };

    const clearContextRestoreWatchdog = (): void => {
      if (contextRestoreWatchdog === null) return;
      window.clearTimeout(contextRestoreWatchdog);
      contextRestoreWatchdog = null;
    };

    const clearWatchdogs = (): void => {
      clearAttemptWatchdog();
      clearContextRestoreWatchdog();
    };

    const releaseVisualHost = (): void => {
      const retiring = visualHost;
      visualHost = null;
      if (!retiring) return;
      try {
        retiring.unload();
      } catch (releaseError) {
        console.warn(`[avatar:live2d] visual host release failed: ${describeError(releaseError)}`);
      }
    };

    const silenceBackend = (): void => {
      try {
        audioConsumer.silent();
        lipsyncDriverRef.current.silent((id, value) => {
          session.applyCommand({
            kind: 'parameter',
            id,
            value,
            weight: 1,
            source: 'speech_lipsync',
          });
        });
      } catch (silenceError) {
        console.warn(`[avatar:live2d] recovery silence failed: ${describeError(silenceError)}`);
      }
    };

    const failSurface = (reason: unknown): void => {
      if (cancelled) return;
      attemptGeneration += 1;
      stopFrameScheduling();
      clearWatchdogs();
      resizeObserver?.disconnect();
      resizeObserver = null;
      releaseVisualHost();
      removeCanvasListeners();
      removeCanvasListeners = () => {};
      activeCanvas = null;
      silenceBackend();
      const message = describeError(reason);
      setSurfaceStatus('error', message);
      setError(message);
      console.warn(`[avatar:live2d] visual presentation failed: ${message}`);
      host.replaceChildren();
    };

    const scheduleNextFrame = (attempt: number): void => {
      if (cancelled || attempt !== attemptGeneration || !visualHost) return;
      if (reducedMotionRef.current) {
        reducedMotionTimer = window.setTimeout(() => {
          reducedMotionTimer = null;
          animationFrame = requestAnimationFrame(() => renderLoop(attempt));
        }, 100);
        return;
      }
      animationFrame = requestAnimationFrame(() => renderLoop(attempt));
    };

    const renderLoop = (attempt: number): void => {
      if (cancelled || attempt !== attemptGeneration || !visualHost) {
        return;
      }
      try {
        const now = performance.now();
        const previous = lastFrameTimeRef.current ?? now;
        lastFrameTimeRef.current = now;
        const deltaTimeSeconds = Math.max(1 / 120, Math.min(0.1, (now - previous) / 1000));
        lipsyncDriverRef.current.tick({
          deltaSec: deltaTimeSeconds,
          lipsyncSnapshot: audioConsumer.snapshot(),
          paramMouthFormSupported,
          setParameter: (id, value) => {
            session.applyCommand({
              kind: 'parameter',
              id,
              value,
              weight: 1,
              source: 'speech_lipsync',
            });
          },
        });
        const frameInput = {
          deltaTimeSeconds,
          seconds: now / 1000,
          reducedMotion: reducedMotionRef.current,
        };
        const stats = visualHost.drawFrame(frameInput);
        if (statusRef.current !== 'ready' && hasObservedCarrierOutput(stats)) {
          clearAttemptWatchdog();
          setSurfaceStatus('ready');
        }
      } catch (renderError) {
        failSurface(renderError);
        return;
      }
      scheduleNextFrame(attempt);
    };

    const startAttempt = async (posture: 'loading' | 'recovering'): Promise<void> => {
      if (cancelled) return;
      const attempt = ++attemptGeneration;
      stopFrameScheduling();
      clearWatchdogs();
      resizeObserver?.disconnect();
      resizeObserver = null;
      releaseVisualHost();
      removeCanvasListeners();
      removeCanvasListeners = () => {};
      lastFrameTimeRef.current = null;
      setSurfaceStatus(posture);
      setError(null);

      const canvas = document.createElement('canvas');
      canvas.className = 'avatar-live2d-carrier__canvas';
      canvas.setAttribute('aria-hidden', 'true');
      activeCanvas = canvas;
      host.replaceChildren(canvas);
      let contextLost = false;
      const onContextLost = (event: Event): void => {
        event.preventDefault();
        if (cancelled || activeCanvas !== canvas || attempt !== attemptGeneration) return;
        if (recoveryAttempts >= LIVE2D_CONTEXT_RECOVERY_ATTEMPTS) {
          failSurface('live2d_webgl_context_recovery_exhausted');
          return;
        }
        recoveryAttempts += 1;
        contextLost = true;
        attemptGeneration += 1;
        stopFrameScheduling();
        clearAttemptWatchdog();
        resizeObserver?.disconnect();
        resizeObserver = null;
        releaseVisualHost();
        silenceBackend();
        setSurfaceStatus('recovering');
        setError(null);
        contextRestoreWatchdog = window.setTimeout(() => {
          contextRestoreWatchdog = null;
          if (cancelled || activeCanvas !== canvas || !contextLost) return;
          failSurface('live2d_webgl_context_restore_timed_out');
        }, LIVE2D_CONTEXT_RESTORE_TIMEOUT_MS);
      };
      const onContextRestored = (): void => {
        if (cancelled || !contextLost || activeCanvas !== canvas) return;
        contextLost = false;
        clearContextRestoreWatchdog();
        void startAttempt('recovering');
      };
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
      removeCanvasListeners = () => {
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
      };

      try {
        attemptWatchdog = window.setTimeout(() => {
          attemptWatchdog = null;
          if (cancelled || attempt !== attemptGeneration || activeCanvas !== canvas) return;
          failSurface(posture === 'loading'
            ? 'live2d_visual_load_timed_out'
            : 'live2d_visual_recovery_reload_timed_out');
        }, LIVE2D_VISUAL_LOAD_TIMEOUT_MS);
        const size = measureHost(host);
        const created = await createLive2DCarrierVisualHost({
          canvas,
          session,
          width: size.width,
          height: size.height,
        });
        if (cancelled || attempt !== attemptGeneration || activeCanvas !== canvas) {
          created.unload();
          return;
        }
        visualHost = created;
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (!visualHost || attempt !== attemptGeneration) {
              return;
            }
            const nextSize = measureHost(host);
            visualHost.resize(nextSize.width, nextSize.height);
          });
          resizeObserver.observe(host);
        }
        renderLoop(attempt);
      } catch (loadError) {
        if (cancelled || attempt !== attemptGeneration || activeCanvas !== canvas) return;
        failSurface(loadError);
      }
    };

    void startAttempt('loading');

    return () => {
      cancelled = true;
      attemptGeneration += 1;
      stopFrameScheduling();
      clearWatchdogs();
      resizeObserver?.disconnect();
      resizeObserver = null;
      releaseVisualHost();
      removeCanvasListeners();
      removeCanvasListeners = () => {};
      activeCanvas = null;
      host.replaceChildren();
    };
  }, [audioConsumer, paramMouthFormSupported, session]);

  return (
    <>
      <div
        ref={hostRef}
        className="avatar-live2d-carrier"
        data-testid="avatar-live2d-carrier-visual"
        data-avatar-owned-live2d-status={status}
        data-avatar-live2d-carrier-status={status}
        data-avatar-live2d-carrier-error={error ?? undefined}
      />
      {status === 'error' ? <PresentationUnavailableSurface reason={error} /> : null}
    </>
  );
}
