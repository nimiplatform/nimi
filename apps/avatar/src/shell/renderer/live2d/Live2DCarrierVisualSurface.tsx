import { useEffect, useRef, useState } from 'react';
import type { Live2DBackendSession } from './backend-session.js';
import {
  createLive2DCarrierVisualHost,
  type Live2DCarrierVisualFrameStats,
  type Live2DCarrierVisualHost,
} from './carrier-visual-host.js';

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

export function Live2DCarrierVisualSurface({ session }: Live2DCarrierVisualSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Live2DCarrierVisualFrameStats | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !session?.execution.loaded) {
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
    setStatus('loading');
    setError(null);
    setStats(null);

    const renderLoop = () => {
      if (cancelled || !visualHost) {
        return;
      }
      try {
        const nextStats = visualHost.renderFrame();
        setStats(nextStats);
        setStatus('ready');
      } catch (renderError) {
        setStatus('error');
        setError(describeError(renderError));
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
        visualHost = await createLive2DCarrierVisualHost({
          canvas,
          session,
          width: size.width,
          height: size.height,
        });
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
        setError(describeError(loadError));
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
      data-avatar-live2d-carrier-status={status}
      data-avatar-live2d-carrier-visible-pixels={stats?.visiblePixels ?? 0}
      data-avatar-live2d-carrier-drawables={stats?.visibleDrawableCount ?? 0}
      data-avatar-live2d-carrier-error={error ?? undefined}
    />
  );
}
