import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AvatarVrmViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { createOfficialLive2dCubismModel } from './chat-agent-avatar-live2d-cubism-runtime';
import {
  loadChatAgentAvatarLive2dModelSource,
  resolveChatAgentAvatarLive2dViewportState,
  type ChatAgentAvatarLive2dModelSource,
} from './chat-agent-avatar-live2d-viewport-state';

type Live2dViewportStatus = 'loading' | 'ready' | 'error';
type ChatAgentAvatarLive2dViewportLoadState = {
  status: Live2dViewportStatus;
  source: ChatAgentAvatarLive2dModelSource | null;
  error: string | null;
};

type ChatAgentAvatarLive2dViewportProps = AvatarVrmViewportComponentProps & {
  onLoadStateChange?: (status: Live2dViewportStatus) => void;
  onLoadErrorChange?: (error: string | null) => void;
  onDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
};

type Live2dRuntimeError = Error & {
  url?: string;
  status?: number;
};

export type ChatAgentAvatarLive2dDiagnostic = {
  backendKind: 'live2d';
  stage: 'core-check' | 'runtime-load' | 'source-resolve' | 'model-load' | 'ready';
  status: Live2dViewportStatus;
  assetRef: string;
  assetLabel: string | null;
  mocVersion: number | null;
  resourceId: string | null;
  fileUrl: string | null;
  modelUrl: string | null;
  error: string | null;
  errorUrl: string | null;
  errorStatus: number | null;
  runtimeUrls: string[];
  cubismCoreAvailable: boolean;
  assetProbeFailures: string[];
  motionGroups: string[];
  idleMotionGroup: string | null;
  speechMotionGroup: string | null;
  recoveryAttemptCount: number;
  recoveryReason: string | null;
};

function hasLive2dCubismCore(): boolean {
  return Boolean((globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore);
}

function describeLive2dLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Live2D model failed to load';
}

function createLive2dDiagnostic(input: {
  assetRef: string;
  stage: ChatAgentAvatarLive2dDiagnostic['stage'];
  status: Live2dViewportStatus;
  source?: ChatAgentAvatarLive2dModelSource | null;
  error?: string | null;
  cause?: unknown;
  runtimeUrls?: string[];
  assetProbeFailures?: string[];
  recoveryAttemptCount?: number;
  recoveryReason?: string | null;
}): ChatAgentAvatarLive2dDiagnostic {
  const runtimeError = input.cause as Live2dRuntimeError | undefined;
  return {
    backendKind: 'live2d',
    stage: input.stage,
    status: input.status,
    assetRef: input.assetRef,
    assetLabel: input.source?.assetLabel || null,
    mocVersion: input.source?.mocVersion ?? null,
    resourceId: input.source?.resourceId || null,
    fileUrl: input.source?.fileUrl || null,
    modelUrl: input.source?.modelUrl || null,
    error: input.error || null,
    errorUrl: typeof runtimeError?.url === 'string' ? runtimeError.url : null,
    errorStatus: typeof runtimeError?.status === 'number' ? runtimeError.status : null,
    runtimeUrls: input.runtimeUrls ?? [],
    cubismCoreAvailable: hasLive2dCubismCore(),
    assetProbeFailures: input.assetProbeFailures ?? [],
    motionGroups: input.source?.motionGroups ?? [],
    idleMotionGroup: input.source?.idleMotionGroup ?? null,
    speechMotionGroup: input.source?.speechMotionGroup ?? null,
    recoveryAttemptCount: input.recoveryAttemptCount ?? 0,
    recoveryReason: input.recoveryReason ?? null,
  };
}

function resolveLive2dRuntimeUrls(source: ChatAgentAvatarLive2dModelSource | null): string[] {
  if (!source) {
    return [];
  }
  return [...new Set([source.modelUrl, ...source.resolvedAssetUrls].filter(Boolean))];
}

async function probeLive2dAssetUrls(urls: readonly string[]): Promise<string[]> {
  const failures = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        return `${url} -> HTTP ${response.status}`;
      }
      const bytes = (await response.arrayBuffer()).byteLength;
      return `${url} -> OK (${bytes} bytes)`;
    } catch (error) {
      return `${url} -> ${describeLive2dLoadError(error)}`;
    }
  }));
  return failures.filter((value): value is string => Boolean(value));
}

function resizeCanvasToHost(canvas: HTMLCanvasElement, host: HTMLDivElement): {
  width: number;
  height: number;
  changed: boolean;
  renderable: boolean;
} {
  const minimumRenderableCssPixels = 24;
  if (host.clientWidth < minimumRenderableCssPixels || host.clientHeight < minimumRenderableCssPixels) {
    return {
      width: Math.max(canvas.width, 1),
      height: Math.max(canvas.height, 1),
      changed: false,
      renderable: false,
    };
  }

  const devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(Math.max(host.clientWidth, 1) * devicePixelRatio));
  const height = Math.max(1, Math.round(Math.max(host.clientHeight, 1) * devicePixelRatio));
  const changed = canvas.width !== width || canvas.height !== height;

  if (changed) {
    canvas.width = width;
    canvas.height = height;
  }

  return {
    width,
    height,
    changed,
    renderable: true,
  };
}

function Live2dLoadingShell({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(224,242,254,0.94)_50%,rgba(191,219,254,0.82))]">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="h-11 w-11 animate-spin rounded-full border-2 border-cyan-200 border-t-cyan-500" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700/80">
            {t('Chat.avatarLive2dLabel', { defaultValue: 'Live2D' })}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{label}</p>
        </div>
      </div>
    </div>
  );
}

function Live2dErrorShell(props: {
  label: string;
  errorMessage: string;
  posterUrl?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.98),rgba(226,232,240,0.94)_54%,rgba(203,213,225,0.84))]">
      {props.posterUrl ? (
        <img
          src={props.posterUrl}
          alt={props.label}
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />
      ) : null}
      <div className="relative mx-6 max-w-[18rem] rounded-[24px] border border-white/80 bg-white/84 px-5 py-4 text-center shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          {t('Chat.avatarLive2dFallbackLabel', { defaultValue: 'Live2D Fallback' })}
        </p>
        <p className="mt-2 text-sm font-semibold text-slate-900">{props.label}</p>
        <p className="mt-2 text-xs leading-5 text-slate-600">{props.errorMessage}</p>
      </div>
    </div>
  );
}

export default function ChatAgentAvatarLive2dViewport({
  input,
  chrome = 'default',
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
}: ChatAgentAvatarLive2dViewportProps) {
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
  }, [input.assetRef, runtimeEpoch]);

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden',
        chrome === 'minimal' ? 'bg-transparent' : 'rounded-[28px]',
      )}
      data-avatar-live2d-status={loadState.status}
      data-avatar-live2d-phase={viewportState.phase}
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex justify-center pb-4">
        <span className="rounded-full border border-white/80 bg-slate-950/84 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
          {viewportState.badgeLabel}
        </span>
      </div>
    </div>
  );
}
