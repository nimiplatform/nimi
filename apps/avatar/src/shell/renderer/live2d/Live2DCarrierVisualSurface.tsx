import { useEffect, useRef, useState } from 'react';
import type { Live2DBackendSession } from './backend-session.js';
import {
  createLive2DCarrierVisualHost,
  Live2DCarrierVisualFrameError,
  type Live2DCarrierVisualFrameStats,
  type Live2DCarrierVisualHost,
} from './carrier-visual-host.js';
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';

type Live2DCarrierVisualSurfaceProps = {
  session: Live2DBackendSession | null;
};

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

function timeoutAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

export function Live2DCarrierVisualSurface({ session }: Live2DCarrierVisualSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Live2DCarrierVisualFrameStats | null>(null);
  const recordedVisualRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !session?.execution.loaded) {
      recordedVisualRef.current = false;
      setStatus('idle');
      setError(null);
      setStats(null);
      host?.replaceChildren();
      return;
    }

    let cancelled = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let visualHost: Live2DCarrierVisualHost | null = null;
    let visualProofAttempts = 0;
    setStatus('loading');
    setError(null);
    setStats(null);
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: {
        status: 'loading',
        source: 'avatar-live2d-carrier-surface',
      },
    });

    const renderLoop = () => {
      if (cancelled || !visualHost) {
        return;
      }
      try {
        visualProofAttempts += 1;
        const nextStats = visualHost.renderFrame();
        setStats(nextStats);
        setStatus('ready');
        if (!recordedVisualRef.current && nextStats.visiblePixels > 0) {
          recordedVisualRef.current = true;
          recordAvatarEvidenceEventually({
            kind: 'avatar.carrier.visual',
            detail: {
              status: 'ready',
              visible_pixels: nextStats.visiblePixels,
              visible_drawable_count: nextStats.visibleDrawableCount,
              canvas_width: nextStats.width,
              canvas_height: nextStats.height,
            },
          });
        }
      } catch (renderError) {
        const message = describeError(renderError);
        if (
          renderError instanceof Live2DCarrierVisualFrameError
          && visualProofAttempts < 90
        ) {
          setStatus('loading');
          animationFrame = requestAnimationFrame(renderLoop);
          return;
        }
        setStatus('error');
        setError(message);
        recordAvatarEvidenceEventually({
          kind: 'avatar.carrier.visual',
          detail: {
            status: 'error',
            error: message,
          },
        });
        return;
      }
      animationFrame = requestAnimationFrame(renderLoop);
    };

    void (async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.className = 'avatar-live2d-carrier__canvas';
        canvas.setAttribute('aria-hidden', 'true');
        host.replaceChildren(canvas);
        const size = measureHost(host);
        visualHost = await Promise.race([
          createLive2DCarrierVisualHost({
            canvas,
            session,
            width: size.width,
            height: size.height,
          }),
          timeoutAfter<Live2DCarrierVisualHost>(8_000, 'Live2D carrier visual host initialization timed out'),
        ]);
        if (cancelled) {
          visualHost.unload();
          visualHost = null;
          return;
        }
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (!visualHost) {
              return;
            }
            const nextSize = measureHost(host);
            visualHost.resize(nextSize.width, nextSize.height);
          });
          resizeObserver.observe(host);
        }
        renderLoop();
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setStatus('error');
        const message = describeError(loadError);
        setError(message);
        recordAvatarEvidenceEventually({
          kind: 'avatar.carrier.visual',
          detail: {
            status: 'error',
            error: message,
          },
        });
        host.replaceChildren();
      }
    })();

    return () => {
      cancelled = true;
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      resizeObserver?.disconnect();
      visualHost?.unload();
      visualHost = null;
      host.replaceChildren();
    };
  }, [session]);

  return (
    <div
      ref={hostRef}
      className="avatar-live2d-carrier"
      data-testid="avatar-live2d-carrier-visual"
      data-avatar-owned-live2d-status={status}
      data-avatar-live2d-carrier-status={status}
      data-avatar-live2d-carrier-visible-pixels={stats?.visiblePixels ?? 0}
      data-avatar-live2d-carrier-drawables={stats?.visibleDrawableCount ?? 0}
      data-avatar-live2d-carrier-error={error ?? undefined}
    />
  );
}
