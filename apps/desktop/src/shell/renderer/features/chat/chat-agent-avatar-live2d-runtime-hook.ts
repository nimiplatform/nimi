import { useEffect, useMemo, useRef, useState } from 'react';
import type { AvatarLive2dViewportComponentProps } from '@nimiplatform/kit/features/avatar/live2d';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { createOfficialLive2dCubismModel } from './chat-agent-avatar-live2d-cubism-runtime';
import {
  createLive2dViewportFailureDiagnostic,
  logLive2dViewportFailure,
} from './chat-agent-avatar-live2d-failure-reporting';
import {
  resolveChatAgentAvatarLive2dFramingIntent,
  type ChatAgentAvatarFramingIntent,
} from './chat-agent-avatar-framing-intent';
import {
  loadChatAgentAvatarLive2dModelSource,
  resolveChatAgentAvatarLive2dViewportState,
  type ChatAgentAvatarLive2dModelSource,
} from './chat-agent-avatar-live2d-viewport-state';
import {
  createLive2dDiagnostic,
  describeLive2dLoadError,
  probeLive2dAssetUrls,
  resizeCanvasToHost,
  resolveLive2dRuntimeUrls,
  type ChatAgentAvatarLive2dDiagnostic,
  type ChatAgentAvatarLive2dViewportLoadState,
  type Live2dViewportStatus,
} from './chat-agent-avatar-live2d-diagnostics';

type ChatAgentAvatarLive2dRuntimeHookInput = {
  input: AvatarLive2dViewportComponentProps['input'];
  chrome: NonNullable<AvatarLive2dViewportComponentProps['chrome']>;
  onLoadStateChange?: (status: Live2dViewportStatus) => void;
  onLoadErrorChange?: (error: string | null) => void;
  onDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
  framingIntent: ChatAgentAvatarFramingIntent;
};

const MINIMAL_CHAT_AGENT_LIVE2D_VERTICAL_OFFSET_Y = 0.14;

export function useChatAgentAvatarLive2dRuntime({
  input,
  chrome,
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
  framingIntent,
}: ChatAgentAvatarLive2dRuntimeHookInput) {
  const modelVerticalOffsetY = chrome === 'minimal' ? MINIMAL_CHAT_AGENT_LIVE2D_VERTICAL_OFFSET_Y : 0;
  const kitFramingIntent = useMemo(
    () => resolveChatAgentAvatarLive2dFramingIntent(framingIntent),
    [framingIntent],
  );
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
          const failureReport = {
            assetRef: input.assetRef,
            source: failedSource,
            stage: failureStage,
            error: inputFailure.error,
            cause: inputFailure.cause,
            runtimeUrls: failureRuntimeUrls,
            assetProbeFailures,
            recoveryAttemptCount,
            recoveryReason,
          };
          setDiagnostic(createLive2dViewportFailureDiagnostic(failureReport));
          logLive2dViewportFailure(failureReport);
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
            framingIntent: kitFramingIntent,
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
  }, [input.assetRef, modelVerticalOffsetY, runtimeEpoch, kitFramingIntent]);

  return {
    hostRef,
    loadState,
    viewportState,
  };
}
