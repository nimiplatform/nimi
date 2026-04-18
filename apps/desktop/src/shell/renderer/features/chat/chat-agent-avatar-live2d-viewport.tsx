import { useEffect, useMemo, useRef, useState } from 'react';
import type { AvatarLive2dViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/live2d';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { createOfficialLive2dCubismModel } from './chat-agent-avatar-live2d-cubism-runtime';
import type { ChatAgentAvatarLive2dFramingIntent } from './chat-agent-avatar-live2d-framing';
import {
  loadChatAgentAvatarLive2dModelSource,
  resolveChatAgentAvatarLive2dViewportState,
  type ChatAgentAvatarLive2dModelSource,
} from './chat-agent-avatar-live2d-viewport-state';
import {
  createLive2dDiagnostic,
  describeLive2dLoadError,
  hasLive2dCubismCore,
  probeLive2dAssetUrls,
  resizeCanvasToHost,
  resolveLive2dRuntimeUrls,
  type ChatAgentAvatarLive2dDiagnostic,
  type ChatAgentAvatarLive2dViewportLoadState,
  type Live2dRuntimeError,
  type Live2dViewportStatus,
} from './chat-agent-avatar-live2d-diagnostics';
import { Live2dErrorShell, Live2dLoadingShell } from './chat-agent-avatar-live2d-shells';

type ChatAgentAvatarLive2dViewportProps = AvatarLive2dViewportComponentProps & {
  onLoadStateChange?: (status: Live2dViewportStatus) => void;
  onLoadErrorChange?: (error: string | null) => void;
  onDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
  framingIntent?: ChatAgentAvatarLive2dFramingIntent;
};

const MINIMAL_CHAT_AGENT_LIVE2D_VERTICAL_OFFSET_Y = -0.08;

export default function ChatAgentAvatarLive2dViewport({
  input,
  chrome = 'default',
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
  framingIntent = 'chat-focus',
}: ChatAgentAvatarLive2dViewportProps) {
  const modelVerticalOffsetY = chrome === 'minimal' ? MINIMAL_CHAT_AGENT_LIVE2D_VERTICAL_OFFSET_Y : 0;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<Awaited<ReturnType<typeof createOfficialLive2dCubismModel>> | null>(null);
  const animationStateRef = useRef(resolveChatAgentAvatarLive2dViewportState(input));
  const contextRecoveryRetryBudgetRef = useRef(0);
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  const [loadState, setLoadState] = useState<ChatAgentAvatarLive2dViewportLoadState>({
    status: 'loading',
    source: null,
    error: null,
  });
  const [diagnostic, setDiagnostic] = useState<ChatAgentAvatarLive2dDiagnostic>(() => (
    createLive2dDiagnostic({
      assetRef: input.assetRef,
      stage: 'runtime-load',
      status: 'loading',
    })
  ));
  const viewportState = useMemo(
    () => resolveChatAgentAvatarLive2dViewportState(input, loadState.source),
    [input, loadState.source],
  );

  animationStateRef.current = viewportState;

  useEffect(() => {
    onLoadStateChange?.(loadState.status);
  }, [loadState.status, onLoadStateChange]);

  useEffect(() => {
    onLoadErrorChange?.(loadState.error);
  }, [loadState.error, onLoadErrorChange]);

  useEffect(() => {
    onDiagnosticChange?.(diagnostic);
  }, [diagnostic, onDiagnosticChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    if (!hasLive2dCubismCore()) {
      const error = 'Live2D Cubism Core is not available in the desktop shell.';
      setDiagnostic(createLive2dDiagnostic({
        assetRef: input.assetRef,
        stage: 'core-check',
        status: 'error',
        error,
      }));
      setLoadState({
        status: 'error',
        source: null,
        error,
      });
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let frameHandle = 0;
    let sourceForCleanup: ChatAgentAvatarLive2dModelSource | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let currentSource: ChatAgentAvatarLive2dModelSource | null = null;
    let currentRuntimeUrls: string[] = [];
    let currentFailureStage: ChatAgentAvatarLive2dDiagnostic['stage'] = 'runtime-load';
    let handleContextLost: ((event: Event) => void) | null = null;
    let handleContextRestored: ((event: Event) => void) | null = null;
    let resizeRebuildTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let contextRestoreTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let contextRestartTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let resizeRebuildRequestId = 0;
    let recoveryAttemptCount = 0;
    let recoveryReason: string | null = null;
    let beginRecovery: ((reason: string) => void) | null = null;

    const consumeContextRecoveryRetry = (reason: string): boolean => {
      if (contextRecoveryRetryBudgetRef.current <= 0 || !beginRecovery) {
        return false;
      }
      contextRecoveryRetryBudgetRef.current -= 1;
      beginRecovery(reason);
      resizeRebuildRequestId += 1;
      if (frameHandle) {
        globalThis.cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
      if (resizeRebuildTimer) {
        globalThis.clearTimeout(resizeRebuildTimer);
        resizeRebuildTimer = null;
      }
      if (contextRestartTimer) {
        globalThis.clearTimeout(contextRestartTimer);
      }
      contextRestartTimer = globalThis.setTimeout(() => {
        contextRestartTimer = null;
        setRuntimeEpoch((value) => value + 1);
      }, 120);
      return true;
    };

    setLoadState({
      status: 'loading',
      source: null,
      error: null,
    });
    setDiagnostic(createLive2dDiagnostic({
      assetRef: input.assetRef,
      stage: 'runtime-load',
      status: 'loading',
    }));

    void (async () => {
      let source: ChatAgentAvatarLive2dModelSource | null = null;
      let runtimeUrls: string[] = [];
      let failClosed: ((inputFailure: {
        error: string;
        cause?: unknown;
        stage?: ChatAgentAvatarLive2dDiagnostic['stage'];
        source?: ChatAgentAvatarLive2dModelSource | null;
        runtimeUrls?: string[];
        assetProbeFailures?: string[];
      }) => void) | null = null;
      try {
        canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'none';

        const gl = (canvas.getContext('webgl2', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
        }) || canvas.getContext('webgl', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
        })) as WebGLRenderingContext | WebGL2RenderingContext | null;
        if (!gl) {
          throw new Error('Desktop Live2D viewport could not acquire a WebGL context.');
        }

        host.replaceChildren(canvas);

        failClosed = (inputFailure: {
          error: string;
          cause?: unknown;
          stage?: ChatAgentAvatarLive2dDiagnostic['stage'];
          source?: ChatAgentAvatarLive2dModelSource | null;
          runtimeUrls?: string[];
          assetProbeFailures?: string[];
        }) => {
          if (cancelled) {
            return;
          }
          const failedSource = inputFailure.source ?? source ?? currentSource;
          const failureRuntimeUrls = inputFailure.runtimeUrls ?? runtimeUrls ?? currentRuntimeUrls;
          const failureStage = inputFailure.stage ?? currentFailureStage;
          const assetProbeFailures = inputFailure.assetProbeFailures ?? [];

          if (frameHandle) {
            globalThis.cancelAnimationFrame(frameHandle);
            frameHandle = 0;
          }
          if (resizeRebuildTimer) {
            globalThis.clearTimeout(resizeRebuildTimer);
            resizeRebuildTimer = null;
          }
          if (contextRestoreTimer) {
            globalThis.clearTimeout(contextRestoreTimer);
            contextRestoreTimer = null;
          }
          if (contextRestartTimer) {
            globalThis.clearTimeout(contextRestartTimer);
            contextRestartTimer = null;
          }
          resizeObserver?.disconnect();
          resizeObserver = null;
          if (canvas && handleContextLost) {
            canvas.removeEventListener('webglcontextlost', handleContextLost);
          }
          if (canvas && handleContextRestored) {
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);
          }
          modelRef.current?.release();
          modelRef.current = null;
          sourceForCleanup?.cleanup?.();
          sourceForCleanup = null;
          currentSource = null;
          currentRuntimeUrls = [];
          if (hostRef.current) {
            hostRef.current.replaceChildren();
          }

          setLoadState({
            status: 'error',
            source: null,
            error: inputFailure.error,
          });
          setDiagnostic({
            ...createLive2dDiagnostic({
              assetRef: input.assetRef,
              source: failedSource,
              stage: failureStage,
              status: 'error',
              error: inputFailure.error,
              cause: inputFailure.cause,
              recoveryAttemptCount,
              recoveryReason,
            }),
            runtimeUrls: failureRuntimeUrls,
            assetProbeFailures,
          });
          logRendererEvent({
            level: 'error',
            area: 'chat-live2d',
            message: 'action:live2d-viewport-load-failed',
            details: {
              assetRef: input.assetRef,
              stage: failureStage,
              resourceId: failedSource?.resourceId || null,
              fileUrl: failedSource?.fileUrl || null,
              modelUrl: failedSource?.modelUrl || null,
              mocVersion: failedSource?.mocVersion ?? null,
              error: inputFailure.error,
              errorUrl: typeof (inputFailure.cause as Live2dRuntimeError | null | undefined)?.url === 'string'
                ? (inputFailure.cause as Live2dRuntimeError).url || null
                : null,
              errorStatus: typeof (inputFailure.cause as Live2dRuntimeError | null | undefined)?.status === 'number'
                ? (inputFailure.cause as Live2dRuntimeError).status || null
                : null,
              runtimeUrls: failureRuntimeUrls,
              assetProbeFailures,
            },
          });
        };

        currentFailureStage = 'source-resolve';
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          stage: 'source-resolve',
          status: 'loading',
        }));
        source = await loadChatAgentAvatarLive2dModelSource(input.assetRef);
        sourceForCleanup = source;
        currentSource = source;
        runtimeUrls = resolveLive2dRuntimeUrls(source);
        currentRuntimeUrls = runtimeUrls;
        if (cancelled) {
          source.cleanup?.();
          return;
        }

        currentFailureStage = 'model-load';
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          source,
          stage: 'model-load',
          status: 'loading',
        }));

        const initialSize = resizeCanvasToHost(canvas, host);
        let lastRenderableSize = {
          width: initialSize.width,
          height: initialSize.height,
        };

        const rebuildModel = async (inputRebuild: {
          width: number;
          height: number;
          updateLoadState: boolean;
          logReason: 'initial' | 'resize';
        }): Promise<boolean> => {
          const rebuildSource = currentSource;
          if (!rebuildSource) {
            return false;
          }
          const rebuildId = ++resizeRebuildRequestId;
          const nextModel = await createOfficialLive2dCubismModel({
            gl,
            source: rebuildSource,
            width: inputRebuild.width,
            height: inputRebuild.height,
            verticalOffsetY: modelVerticalOffsetY,
            framingIntent,
          });
          if (cancelled || rebuildId !== resizeRebuildRequestId) {
            nextModel.release();
            return false;
          }
          const previousModel = modelRef.current;
          modelRef.current = nextModel;
          if (previousModel && previousModel !== nextModel) {
            previousModel.release();
          }
          if (inputRebuild.updateLoadState) {
            recoveryReason = null;
            setLoadState({
              status: 'ready',
              source: rebuildSource,
              error: null,
            });
            setDiagnostic({
              ...createLive2dDiagnostic({
                assetRef: input.assetRef,
                source: rebuildSource,
                stage: 'ready',
                status: 'ready',
                recoveryAttemptCount,
              }),
              runtimeUrls: currentRuntimeUrls,
            });
          }
          logRendererEvent({
            area: 'chat-live2d',
            message: 'action:live2d-model-rebuilt',
            details: {
              assetRef: input.assetRef,
              reason: inputRebuild.logReason,
              width: inputRebuild.width,
              height: inputRebuild.height,
              resourceId: rebuildSource.resourceId || null,
              mocVersion: rebuildSource.mocVersion ?? null,
            },
          });
          return true;
        };

        beginRecovery = (reason: string) => {
          if (!currentSource) {
            return;
          }
          recoveryAttemptCount += 1;
          recoveryReason = reason;
          setLoadState({
            status: 'loading',
            source: currentSource,
            error: null,
          });
          setDiagnostic(createLive2dDiagnostic({
            assetRef: input.assetRef,
            source: currentSource,
            stage: 'ready',
            status: 'loading',
            runtimeUrls: currentRuntimeUrls,
            assetProbeFailures: [reason],
            recoveryAttemptCount,
            recoveryReason,
          }));
        };

        handleContextLost = (event: Event) => {
          event.preventDefault();
          resizeRebuildRequestId += 1;
          if (frameHandle) {
            globalThis.cancelAnimationFrame(frameHandle);
            frameHandle = 0;
          }
          if (resizeRebuildTimer) {
            globalThis.clearTimeout(resizeRebuildTimer);
            resizeRebuildTimer = null;
          }
          modelRef.current?.release();
          modelRef.current = null;
          beginRecovery?.('webgl-context-lost');
          if (contextRestoreTimer) {
            globalThis.clearTimeout(contextRestoreTimer);
          }
          contextRestoreTimer = globalThis.setTimeout(() => {
            contextRestoreTimer = null;
            failClosed?.({
              error: 'Live2D WebGL context was lost and did not recover. The desktop rail failed closed to fallback.',
              stage: 'ready',
              source: currentSource,
              runtimeUrls: currentRuntimeUrls,
            });
          }, 1500);
        };

        canvas.addEventListener('webglcontextlost', handleContextLost, { passive: false });

        const initialized = await rebuildModel({
          width: initialSize.width,
          height: initialSize.height,
          updateLoadState: false,
          logReason: 'initial',
        });
        if (!initialized) {
          source.cleanup?.();
          return;
        }

        const scheduleResizeRebuild = (targetWidth: number, targetHeight: number) => {
          if (!currentSource) {
            return;
          }
          if (resizeRebuildTimer) {
            globalThis.clearTimeout(resizeRebuildTimer);
          }
          resizeRebuildTimer = globalThis.setTimeout(() => {
            resizeRebuildTimer = null;
            void rebuildModel({
              width: targetWidth,
              height: targetHeight,
              updateLoadState: false,
              logReason: 'resize',
            }).catch((error) => {
              failClosed?.({
                error: describeLive2dLoadError(error),
                cause: error,
                stage: 'ready',
                source: currentSource,
                runtimeUrls: currentRuntimeUrls,
              });
            });
          }, 140);
        };

        const syncCanvasSize = () => {
          if (!canvas || !host || !modelRef.current) {
            return {
              width: lastRenderableSize.width,
              height: lastRenderableSize.height,
              changed: false,
              renderable: true,
            };
          }
          const nextSize = resizeCanvasToHost(canvas, host);
          if (!nextSize.renderable) {
            return {
              width: lastRenderableSize.width,
              height: lastRenderableSize.height,
              changed: false,
              renderable: false,
            };
          }
          lastRenderableSize = {
            width: nextSize.width,
            height: nextSize.height,
          };
          if (nextSize.changed) {
            modelRef.current.resize(nextSize.width, nextSize.height);
            scheduleResizeRebuild(nextSize.width, nextSize.height);
          }
          return nextSize;
        };

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            syncCanvasSize();
          });
          resizeObserver.observe(host);
        }

        let lastFrameTime = performance.now();
        let successfulFrameCount = 0;
        let renderFrame: ((now: number) => void) | null = null;
        const startRenderLoop = () => {
          if (!renderFrame || frameHandle || cancelled || !modelRef.current) {
            return;
          }
          lastFrameTime = performance.now();
          frameHandle = globalThis.requestAnimationFrame(renderFrame);
        };

        renderFrame = (now: number) => {
          if (cancelled || !modelRef.current) {
            return;
          }
          const size = syncCanvasSize();
          if (!size.renderable) {
            const nextRenderFrame = renderFrame;
            if (nextRenderFrame) {
              frameHandle = globalThis.requestAnimationFrame(nextRenderFrame);
            }
            return;
          }
          const { width, height } = size;
          const deltaTimeSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
          lastFrameTime = now;
          try {
            modelRef.current.renderFrame({
              width,
              height,
              deltaTimeSeconds,
              seconds: now / 1000,
              state: animationStateRef.current,
            });
            successfulFrameCount += 1;
            if (successfulFrameCount >= 3 && contextRecoveryRetryBudgetRef.current > 0) {
              contextRecoveryRetryBudgetRef.current = 0;
            }
          } catch (error) {
            if (consumeContextRecoveryRetry('render-exception-after-context-restore')) {
              return;
            }
            failClosed?.({
              error: describeLive2dLoadError(error),
              cause: error,
              stage: 'ready',
              source: currentSource,
              runtimeUrls: currentRuntimeUrls,
            });
            return;
          }
          const nextRenderFrame = renderFrame;
          if (nextRenderFrame) {
            frameHandle = globalThis.requestAnimationFrame(nextRenderFrame);
          }
        };

        handleContextRestored = () => {
          if (cancelled) {
            return;
          }
          if (contextRestoreTimer) {
            globalThis.clearTimeout(contextRestoreTimer);
            contextRestoreTimer = null;
          }
          if (contextRestartTimer) {
            globalThis.clearTimeout(contextRestartTimer);
            contextRestartTimer = null;
          }
          beginRecovery?.('webgl-context-restored');
          contextRecoveryRetryBudgetRef.current = 1;
          resizeRebuildRequestId += 1;
          if (frameHandle) {
            globalThis.cancelAnimationFrame(frameHandle);
            frameHandle = 0;
          }
          if (resizeRebuildTimer) {
            globalThis.clearTimeout(resizeRebuildTimer);
            resizeRebuildTimer = null;
          }
          contextRestartTimer = globalThis.setTimeout(() => {
            contextRestartTimer = null;
            setRuntimeEpoch((value) => value + 1);
          }, 80);
        };
        if (canvas && handleContextRestored) {
          canvas.addEventListener('webglcontextrestored', handleContextRestored);
        }

        startRenderLoop();

        setLoadState({
          status: 'ready',
          source,
          error: null,
        });
        setDiagnostic(createLive2dDiagnostic({
          assetRef: input.assetRef,
          source,
          stage: 'ready',
          status: 'ready',
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (consumeContextRecoveryRetry('bootstrap-exception-after-context-restore')) {
          return;
        }
        const errorMessage = describeLive2dLoadError(error);
        const assetProbeFailures = currentFailureStage === 'model-load' && runtimeUrls.length > 0
          ? await probeLive2dAssetUrls(runtimeUrls)
          : [];
        failClosed?.({
          error: errorMessage,
          cause: error,
          stage: currentFailureStage,
          source,
          runtimeUrls,
          assetProbeFailures,
        });
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (frameHandle) {
        globalThis.cancelAnimationFrame(frameHandle);
      }
      if (resizeRebuildTimer) {
        globalThis.clearTimeout(resizeRebuildTimer);
      }
      if (contextRestoreTimer) {
        globalThis.clearTimeout(contextRestoreTimer);
      }
      if (contextRestartTimer) {
        globalThis.clearTimeout(contextRestartTimer);
      }
      if (canvas && handleContextLost) {
        canvas.removeEventListener('webglcontextlost', handleContextLost);
      }
      if (canvas && handleContextRestored) {
        canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      }
      modelRef.current?.release();
      modelRef.current = null;
      sourceForCleanup?.cleanup?.();
      host.replaceChildren();
    };
  }, [input.assetRef, modelVerticalOffsetY, runtimeEpoch, framingIntent]);

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden',
        chrome === 'minimal' ? 'bg-transparent' : 'rounded-[28px]',
      )}
      data-avatar-live2d-status={loadState.status}
      data-avatar-live2d-phase={viewportState.phase}
      data-avatar-live2d-emotion={viewportState.emotion}
      data-avatar-live2d-asset={viewportState.assetLabel}
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-[-10%] top-[-12%] h-44 w-44 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${viewportState.glowColor}, transparent 70%)` }}
        />
        <div
          className="absolute bottom-[-10%] right-[-6%] h-52 w-52 rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${viewportState.accentColor}33, transparent 72%)` }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),transparent_22%,transparent_80%,rgba(255,255,255,0.16))]" />
      </div>
      <div ref={hostRef} className="relative z-[1] h-full w-full" />
      {loadState.status === 'loading' ? <Live2dLoadingShell label={input.label} /> : null}
      {loadState.status === 'error' ? (
        <Live2dErrorShell
          label={input.label}
          errorMessage={loadState.error || 'Live2D model failed to load'}
          posterUrl={input.posterUrl}
        />
      ) : null}
      {viewportState.phase === 'idle' ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex justify-center pb-4">
          <span className="rounded-full border border-white/80 bg-slate-950/84 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
            {viewportState.badgeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
