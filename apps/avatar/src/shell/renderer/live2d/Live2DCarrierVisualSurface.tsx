import { useEffect, useRef, useState } from 'react';
import type { Live2DBackendSession } from './backend-session.js';
import {
  createLive2DCarrierVisualHost,
  Live2DCarrierVisualFrameError,
  type Live2DCarrierVisualFrameStats,
  type Live2DCarrierVisualHost,
} from './carrier-visual-host.js';
import { recordAvatarEvidenceEventually, writeAvatarEvidenceArtifact } from '../app-shell/avatar-evidence.js';
import type { BackendAudioConsumer } from '../carrier/backend-branch.js';
import { createLive2DLipsyncDriver } from './live2d-lipsync-driver.js';

type Live2DCarrierVisualSurfaceProps = {
  session: Live2DBackendSession | null;
  audioConsumer: BackendAudioConsumer;
  paramMouthFormSupported: boolean;
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

function visualArtifactId(stats: Live2DCarrierVisualFrameStats): string {
  return `live2d-visible-frame-${stats.width}x${stats.height}-${stats.sampledPixelChecksum}`;
}

async function writeVisibleFrameArtifact(input: {
  visualHost: Live2DCarrierVisualHost;
  stats: Live2DCarrierVisualFrameStats;
}) {
  const dataUrl = input.visualHost.canvas.toDataURL('image/png');
  return writeAvatarEvidenceArtifact({
    artifactId: visualArtifactId(input.stats),
    dataUrl,
  });
}

export function Live2DCarrierVisualSurface({
  session,
  audioConsumer,
  paramMouthFormSupported,
}: Live2DCarrierVisualSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lipsyncDriverRef = useRef(createLive2DLipsyncDriver());
  const lastFrameTimeRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [proofStats, setProofStats] = useState<Live2DCarrierVisualFrameStats | null>(null);
  const statusRef = useRef<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const recordedVisualRef = useRef(false);
  const recordedInteractionRef = useRef(false);
  const artifactWritePendingRef = useRef(false);
  const artifactFailureRecordedRef = useRef(false);

  const setSurfaceStatus = (nextStatus: 'idle' | 'loading' | 'ready' | 'error'): void => {
    if (statusRef.current === nextStatus) return;
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !session?.execution.loaded) {
      recordedVisualRef.current = false;
      recordedInteractionRef.current = false;
      artifactWritePendingRef.current = false;
      artifactFailureRecordedRef.current = false;
      lastFrameTimeRef.current = null;
      setSurfaceStatus('idle');
      setError(null);
      setProofStats(null);
      host?.replaceChildren();
      return;
    }

    let cancelled = false;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let visualHost: Live2DCarrierVisualHost | null = null;
    let visualProofAttempts = 0;
    lastFrameTimeRef.current = null;
    setSurfaceStatus('loading');
    setError(null);
    setProofStats(null);
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: {
        status: 'loading',
        source: 'avatar-live2d-carrier-surface',
        model_kind: 'live2d',
      },
    });

    const renderLoop = () => {
      if (cancelled || !visualHost) {
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
        };
        const shouldProbeVisualFrame =
          !recordedVisualRef.current &&
          !artifactWritePendingRef.current &&
          visualProofAttempts < 90;
        if (shouldProbeVisualFrame) {
          visualProofAttempts += 1;
        }
        const nextStats = shouldProbeVisualFrame
          ? visualHost.probeVisibleFrame(frameInput)
          : null;
        if (!nextStats) {
          visualHost.drawFrame(frameInput);
        }
        setSurfaceStatus('ready');
        if (nextStats && !recordedVisualRef.current) {
          setProofStats(nextStats);
        }
        if (
          nextStats &&
          !recordedInteractionRef.current
          && nextStats.visiblePixels > 0
          && nextStats.activeMotionGroup
          && nextStats.activeExpressionId
          && nextStats.motionFrameApplied
          && nextStats.expressionFrameApplied
        ) {
          recordedInteractionRef.current = true;
          recordAvatarEvidenceEventually({
            kind: 'avatar.carrier.interaction',
            detail: {
              status: 'ready',
              source: 'live2d-carrier-surface',
              model_kind: 'live2d',
              active_motion_group: nextStats.activeMotionGroup,
              active_expression_id: nextStats.activeExpressionId,
              motion_frame_applied: nextStats.motionFrameApplied,
              expression_frame_applied: nextStats.expressionFrameApplied,
              visible_pixels: nextStats.visiblePixels,
              visible_drawable_count: nextStats.visibleDrawableCount,
              texture_binding_count: nextStats.textureBindingCount,
              sampled_pixels: nextStats.sampledPixels,
              sampled_pixel_checksum: nextStats.sampledPixelChecksum,
              canvas_width: nextStats.width,
              canvas_height: nextStats.height,
            },
          });
        }
        if (nextStats && !recordedVisualRef.current && !artifactWritePendingRef.current && nextStats.visiblePixels > 0) {
          recordedVisualRef.current = true;
          artifactWritePendingRef.current = true;
          void writeVisibleFrameArtifact({ visualHost, stats: nextStats })
            .then((artifact) => {
              if (cancelled) {
                return;
              }
              artifactWritePendingRef.current = false;
              recordAvatarEvidenceEventually({
                kind: 'avatar.carrier.visual',
                detail: {
                  status: 'ready',
                  source: 'live2d-carrier-surface',
                  model_kind: 'live2d',
                  visible_pixels: nextStats.visiblePixels,
                  visible_drawable_count: nextStats.visibleDrawableCount,
                  texture_binding_count: nextStats.textureBindingCount,
                  sampled_pixels: nextStats.sampledPixels,
                  sampled_pixel_checksum: nextStats.sampledPixelChecksum,
                  canvas_width: nextStats.width,
                  canvas_height: nextStats.height,
                  human_visible_artifact_path: artifact.artifactPath,
                  artifact_mime_type: artifact.artifactMimeType,
                  artifact_byte_length: artifact.artifactByteLength,
                },
              });
            })
            .catch((artifactError: unknown) => {
              if (cancelled) {
                return;
              }
              artifactWritePendingRef.current = false;
              if (!artifactFailureRecordedRef.current) {
                artifactFailureRecordedRef.current = true;
                recordAvatarEvidenceEventually({
                  kind: 'avatar.carrier.visual',
                  detail: {
                    status: 'error',
                    source: 'live2d-carrier-surface',
                    model_kind: 'live2d',
                    reason: 'human_visible_artifact_write_failed',
                    error: describeError(artifactError),
                    visible_pixels: nextStats.visiblePixels,
                    canvas_width: nextStats.width,
                    canvas_height: nextStats.height,
                  },
                });
              }
            });
        }
      } catch (renderError) {
        const message = describeError(renderError);
        if (
          renderError instanceof Live2DCarrierVisualFrameError
          && !recordedVisualRef.current
          && visualProofAttempts < 90
        ) {
          setSurfaceStatus('loading');
          animationFrame = requestAnimationFrame(renderLoop);
          return;
        }
        setSurfaceStatus('error');
        setError(message);
        recordAvatarEvidenceEventually({
          kind: 'avatar.carrier.visual',
          detail: {
            status: 'error',
            model_kind: 'live2d',
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
        setSurfaceStatus('error');
        const message = describeError(loadError);
        setError(message);
        recordAvatarEvidenceEventually({
          kind: 'avatar.carrier.visual',
          detail: {
            status: 'error',
            model_kind: 'live2d',
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
  }, [audioConsumer, paramMouthFormSupported, session]);

  return (
    <div
      ref={hostRef}
      className="avatar-live2d-carrier"
      data-testid="avatar-live2d-carrier-visual"
      data-avatar-owned-live2d-status={status}
      data-avatar-live2d-carrier-status={status}
      data-avatar-live2d-carrier-visible-pixels={proofStats?.visiblePixels ?? 0}
      data-avatar-live2d-carrier-drawables={proofStats?.visibleDrawableCount ?? 0}
      data-avatar-live2d-carrier-error={error ?? undefined}
    />
  );
}
