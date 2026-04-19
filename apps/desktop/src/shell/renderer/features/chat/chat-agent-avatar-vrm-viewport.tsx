import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AvatarVrmViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { cn } from '@nimiplatform/nimi-kit/ui';
import {
  parseDesktopAgentAvatarAssetRef,
  type DesktopAgentAvatarAssetRef,
  resolveChatAgentAvatarVrmAssetUrl,
  resolveChatAgentAvatarVrmExpressionWeights,
  resolveChatAgentAvatarVrmViewportState,
} from './chat-agent-avatar-vrm-viewport-state';
import {
  resolveChatAgentAvatarVrmFramingFromScene,
  type ChatAgentAvatarVrmFramingIntent,
  type ChatAgentAvatarVrmFramingResult,
} from './chat-agent-avatar-vrm-framing';
import type { ChatAgentAvatarAttentionState } from './chat-agent-avatar-attention-state';
import { readDesktopAgentAvatarResourceAsset } from '@renderer/bridge/runtime-bridge/chat-agent-avatar-store';
import {
  collectChatAgentAvatarVrmSceneResourceCounts,
  createChatAgentAvatarVrmDiagnostic,
  publishGlobalVrmDebugSnapshot,
  recordGlobalVrmDispose,
  recordGlobalVrmLoadSceneIfNeeded,
  type ChatAgentAvatarVrmDiagnostic,
  type ChatAgentAvatarVrmResourceCounts,
  setGlobalVrmDebugSnapshot,
} from './chat-agent-avatar-vrm-diagnostics';
import {
  createChatAgentAvatarVrmNonReadyState,
  resolveChatAgentAvatarVrmEffectiveLoadState,
  resolveChatAgentAvatarVrmFramingViewportSize,
  resolveChatAgentAvatarVrmViewportHostMetrics,
  resolveChatAgentAvatarVrmViewportStatus,
  suspendCreateImageBitmapForTauriVrmLoad,
  VRM_CONTEXT_RECOVERY_TIMEOUT_MS,
  type ChatAgentAvatarVrmFramingViewportSize,
  type ChatAgentAvatarVrmResolvedAssetState,
  type ChatAgentAvatarVrmRuntimeLifecycleState,
  type ChatAgentAvatarVrmViewportHostMetrics,
  type LoadedVrmState,
  type VrmViewportStatus,
} from './chat-agent-avatar-vrm-runtime';
import { AvatarScene, applyIdlePose, VrmRenderLoopTelemetry } from './chat-agent-avatar-vrm-scene';

export {
  collectChatAgentAvatarVrmSceneResourceCounts,
  createChatAgentAvatarVrmDiagnostic,
} from './chat-agent-avatar-vrm-diagnostics';
export type { ChatAgentAvatarVrmDiagnostic } from './chat-agent-avatar-vrm-diagnostics';
export {
  resolveChatAgentAvatarVrmEffectiveLoadState,
  resolveChatAgentAvatarVrmViewportStatus,
} from './chat-agent-avatar-vrm-runtime';

type ChatAgentAvatarVrmViewportProps = AvatarVrmViewportComponentProps & {
  attentionState?: ChatAgentAvatarAttentionState | null;
  onLoadStateChange?: (status: VrmViewportStatus) => void;
  onLoadErrorChange?: (error: string | null) => void;
  onDiagnosticChange?: (diagnostic: ChatAgentAvatarVrmDiagnostic) => void;
  framingIntent?: ChatAgentAvatarVrmFramingIntent;
};

const MINIMAL_CHAT_AGENT_VRM_VERTICAL_OFFSET_Y = -0.12;

export default function ChatAgentAvatarVrmViewport({
  input,
  chrome = 'default',
  attentionState,
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
  framingIntent = 'chat-focus',
}: ChatAgentAvatarVrmViewportProps) {
  const stageVerticalOffsetY = chrome === 'minimal' ? MINIMAL_CHAT_AGENT_VRM_VERTICAL_OFFSET_Y : 0;
  const state = useMemo(
    () => resolveChatAgentAvatarVrmViewportState(input, attentionState),
    [input, attentionState],
  );
  const debugExpressionWeights = useMemo(
    () => resolveChatAgentAvatarVrmExpressionWeights(input),
    [input],
  );
  const desktopAssetRef = useMemo<DesktopAgentAvatarAssetRef | null>(
    () => parseDesktopAgentAvatarAssetRef(input.assetRef),
    [input.assetRef],
  );
  const networkAssetUrl = useMemo(
    () => resolveChatAgentAvatarVrmAssetUrl(input.assetRef),
    [input.assetRef],
  );
  const viewportHostRef = useRef<HTMLDivElement | null>(null);
  const contextRecoveryTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [resolvedAsset, setResolvedAsset] = useState<ChatAgentAvatarVrmResolvedAssetState>({
    assetRef: input.assetRef,
    url: networkAssetUrl,
    arrayBuffer: null,
  });
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [viewportHostMetrics, setViewportHostMetrics] = useState<ChatAgentAvatarVrmViewportHostMetrics>({
    width: 0,
    height: 0,
    renderable: true,
  });
  const [lastRenderableFramingViewportSize, setLastRenderableFramingViewportSize] = useState<ChatAgentAvatarVrmFramingViewportSize | null>(null);
  const [runtimeLifecycle, setRuntimeLifecycle] = useState<ChatAgentAvatarVrmRuntimeLifecycleState>({
    phase: 'stable',
    reason: null,
    attemptCount: 0,
    error: null,
  });
  const [loadedVrm, setLoadedVrm] = useState<LoadedVrmState>({
    status: networkAssetUrl ? 'loading' : 'idle',
    assetRef: input.assetRef,
    vrm: null,
    error: null,
  });
  const effectiveLoadState = useMemo(
    () => resolveChatAgentAvatarVrmEffectiveLoadState({
      assetRef: input.assetRef,
      desktopAssetRef,
      networkAssetUrl,
      resolvedAsset,
      loadedVrm,
    }),
    [desktopAssetRef, input.assetRef, loadedVrm, networkAssetUrl, resolvedAsset],
  );
  const activeResolvedAssetBuffer = useMemo(
    () => resolvedAsset.assetRef === input.assetRef ? resolvedAsset.arrayBuffer : null,
    [input.assetRef, resolvedAsset],
  );
  const activeLoadedVrm = useMemo<LoadedVrmState>(
    () => loadedVrm.assetRef === input.assetRef
      ? loadedVrm
      : createChatAgentAvatarVrmNonReadyState({
          assetRef: input.assetRef,
          status: effectiveLoadState.status === 'ready' ? 'loading' : effectiveLoadState.status,
          error: effectiveLoadState.error,
        }),
    [effectiveLoadState.error, effectiveLoadState.status, input.assetRef, loadedVrm],
  );
  const framingViewportSize = useMemo(
    () => resolveChatAgentAvatarVrmFramingViewportSize({
      currentHostMetrics: viewportHostMetrics,
      lastRenderableSize: lastRenderableFramingViewportSize,
    }),
    [lastRenderableFramingViewportSize, viewportHostMetrics],
  );
  const activeVrmResourceCounts = useMemo<ChatAgentAvatarVrmResourceCounts | null>(
    () => activeLoadedVrm.status === 'ready'
      ? collectChatAgentAvatarVrmSceneResourceCounts(activeLoadedVrm.vrm.scene)
      : null,
    [activeLoadedVrm],
  );
  const recordedLoadSceneKeyRef = useRef<string | null>(null);
  const activeVrmFraming = useMemo<ChatAgentAvatarVrmFramingResult | null>(
    () => activeLoadedVrm.status === 'ready'
      ? resolveChatAgentAvatarVrmFramingFromScene({
          railWidth: framingViewportSize.width,
          railHeight: framingViewportSize.height,
          scene: activeLoadedVrm.vrm.scene,
          intent: framingIntent,
        })
      : null,
    [activeLoadedVrm, framingIntent, framingViewportSize.height, framingViewportSize.width],
  );
  const resolvedViewportStatus = useMemo(
    () => resolveChatAgentAvatarVrmViewportStatus({
      loadedStatus: effectiveLoadState.status,
      loadedError: effectiveLoadState.error,
      hostRenderable: viewportHostMetrics.renderable,
      runtimeLifecycle,
    }),
    [effectiveLoadState.error, effectiveLoadState.status, runtimeLifecycle, viewportHostMetrics.renderable],
  );
  const resizePosture = viewportHostMetrics.renderable
    ? 'tracked-host-size'
    : 'awaiting-renderable-host';
  const diagnostic = useMemo(
    () => createChatAgentAvatarVrmDiagnostic({
      assetRef: input.assetRef,
      assetLabel: state.assetLabel,
      desktopAssetRef,
      assetUrl: effectiveLoadState.assetUrl,
      assetResolved: Boolean(effectiveLoadState.assetUrl) || Boolean(activeResolvedAssetBuffer),
      networkAssetUrl,
      posterUrl: input.posterUrl,
      loadedStatus: effectiveLoadState.status,
      loadedError: effectiveLoadState.error,
      status: resolvedViewportStatus.status,
      error: resolvedViewportStatus.error,
      attentionActive: Boolean(attentionState?.active),
      recoveryAttemptCount: runtimeLifecycle.attemptCount,
      recoveryReason: runtimeLifecycle.reason,
      resizePosture,
      viewportWidth: viewportHostMetrics.width,
      viewportHeight: viewportHostMetrics.height,
      hostRenderable: viewportHostMetrics.renderable,
      canvasEpoch,
    }),
    [
      activeResolvedAssetBuffer,
      canvasEpoch,
      desktopAssetRef,
      effectiveLoadState.assetUrl,
      effectiveLoadState.error,
      effectiveLoadState.status,
      input.assetRef,
      input.posterUrl,
      networkAssetUrl,
      attentionState?.active,
      resizePosture,
      resolvedViewportStatus.error,
      resolvedViewportStatus.status,
      runtimeLifecycle.attemptCount,
      runtimeLifecycle.reason,
      state.assetLabel,
      viewportHostMetrics.height,
      viewportHostMetrics.renderable,
      viewportHostMetrics.width,
    ],
  );

  useEffect(() => {
    onLoadStateChange?.(resolvedViewportStatus.status);
  }, [onLoadStateChange, resolvedViewportStatus.status]);

  useEffect(() => {
    onLoadErrorChange?.(resolvedViewportStatus.error);
  }, [onLoadErrorChange, resolvedViewportStatus.error]);

  useEffect(() => {
    onDiagnosticChange?.(diagnostic);
  }, [diagnostic, onDiagnosticChange]);

  useEffect(() => {
    recordGlobalVrmLoadSceneIfNeeded({
      activeLoadedStatus: activeLoadedVrm.status,
      assetRef: activeLoadedVrm.assetRef,
      sceneUuid: activeLoadedVrm.status === 'ready' ? activeLoadedVrm.vrm.scene.uuid : null,
      activeVrmResourceCounts,
      recordedLoadSceneKeyRef,
    });
  }, [activeLoadedVrm, activeVrmResourceCounts]);

  useEffect(() => {
    publishGlobalVrmDebugSnapshot({
      diagnostic,
      state,
      activeViseme: input.snapshot.interaction.visemeId || null,
      debugExpressionWeights,
      activeVrmFraming,
      canvasEpoch,
      activeVrmResourceCounts,
    });
    return () => {
      setGlobalVrmDebugSnapshot(null);
    };
  }, [
    activeVrmFraming,
    canvasEpoch,
    diagnostic,
    debugExpressionWeights,
    input.snapshot.interaction.visemeId,
    state.amplitude,
    state.assetLabel,
    state.badgeLabel,
    state.blinkSpeed,
    state.emotion,
    state.eyeOpen,
    state.mouthOpen,
    state.phase,
    state.attentionInfluence,
    state.posture,
    state.speakingEnergy,
    activeVrmResourceCounts,
  ]);

  useEffect(() => {
    if (contextRecoveryTimerRef.current !== null) {
      globalThis.clearTimeout(contextRecoveryTimerRef.current);
      contextRecoveryTimerRef.current = null;
    }
    setRuntimeLifecycle({
      phase: 'stable',
      reason: null,
      attemptCount: 0,
      error: null,
    });
    setCanvasEpoch((current) => current + 1);

    return () => {
      if (contextRecoveryTimerRef.current !== null) {
        globalThis.clearTimeout(contextRecoveryTimerRef.current);
        contextRecoveryTimerRef.current = null;
      }
    };
  }, [input.assetRef]);

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) {
      return undefined;
    }

    const updateHostMetrics = () => {
      const nextMetrics = resolveChatAgentAvatarVrmViewportHostMetrics(host);
      setViewportHostMetrics((current) => (
        current.width === nextMetrics.width
        && current.height === nextMetrics.height
        && current.renderable === nextMetrics.renderable
          ? current
          : nextMetrics
      ));
    };

    updateHostMetrics();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateHostMetrics();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!viewportHostMetrics.renderable) {
      return;
    }
    setLastRenderableFramingViewportSize((current) => (
      current?.width === viewportHostMetrics.width && current?.height === viewportHostMetrics.height
        ? current
        : {
            width: viewportHostMetrics.width,
            height: viewportHostMetrics.height,
          }
    ));
  }, [viewportHostMetrics.height, viewportHostMetrics.renderable, viewportHostMetrics.width]);

  useEffect(() => {
    if (!viewportHostMetrics.renderable) {
      setRuntimeLifecycle((current) => (
        current.phase === 'failed'
          ? current
          : {
              ...current,
              phase: 'recovering',
              reason: 'host-not-renderable',
              error: null,
            }
      ));
      return;
    }
    setRuntimeLifecycle((current) => (
      current.reason === 'host-not-renderable'
        ? {
            ...current,
            phase: 'stable',
            reason: null,
            error: null,
          }
        : current
    ));
  }, [viewportHostMetrics.renderable]);

  useEffect(() => {
    const canvas = viewportHostRef.current?.querySelector('canvas');
    if (!canvas) {
      return undefined;
    }

    const failClosed = (error: string, reason: ChatAgentAvatarVrmRuntimeLifecycleState['reason']) => {
      if (contextRecoveryTimerRef.current !== null) {
        globalThis.clearTimeout(contextRecoveryTimerRef.current);
        contextRecoveryTimerRef.current = null;
      }
      setRuntimeLifecycle((current) => ({
        phase: 'failed',
        reason,
        attemptCount: current.attemptCount,
        error,
      }));
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setRuntimeLifecycle((current) => {
        if (current.attemptCount >= 1) {
          return {
            phase: 'failed',
            reason: 'webgl-context-lost',
            attemptCount: current.attemptCount,
            error: 'VRM WebGL context was lost more than once. The desktop rail failed closed to fallback.',
          };
        }
        return {
          phase: 'recovering',
          reason: 'webgl-context-lost',
          attemptCount: current.attemptCount + 1,
          error: null,
        };
      });
      if (contextRecoveryTimerRef.current !== null) {
        globalThis.clearTimeout(contextRecoveryTimerRef.current);
      }
      contextRecoveryTimerRef.current = globalThis.setTimeout(() => {
        contextRecoveryTimerRef.current = null;
        failClosed(
          'VRM WebGL context was lost and did not recover. The desktop rail failed closed to fallback.',
          'webgl-context-lost',
        );
      }, VRM_CONTEXT_RECOVERY_TIMEOUT_MS);
    };

    const handleContextRestored = () => {
      if (contextRecoveryTimerRef.current !== null) {
        globalThis.clearTimeout(contextRecoveryTimerRef.current);
        contextRecoveryTimerRef.current = null;
      }
      setRuntimeLifecycle((current) => (
        current.phase === 'failed'
          ? current
          : {
              ...current,
              phase: 'recovering',
              reason: 'webgl-context-restored',
              error: null,
            }
      ));
      setCanvasEpoch((current) => current + 1);
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, { passive: false });
    canvas.addEventListener('webglcontextrestored', handleContextRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, [canvasEpoch, viewportHostMetrics.renderable]);

  useEffect(() => {
    if (!desktopAssetRef) {
      setResolvedAsset({
        assetRef: input.assetRef,
        url: networkAssetUrl,
        arrayBuffer: null,
      });
      return undefined;
    }
    let active = true;

    setResolvedAsset({
      assetRef: input.assetRef,
      url: null,
      arrayBuffer: null,
    });
    setLoadedVrm({
      status: 'loading',
      assetRef: input.assetRef,
      vrm: null,
      error: null,
    });

    void readDesktopAgentAvatarResourceAsset(desktopAssetRef.resourceId)
      .then((asset) => {
        if (!active) {
          return;
        }
        const binary = Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0));
        setResolvedAsset({
          assetRef: input.assetRef,
          url: null,
          arrayBuffer: binary.buffer,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setLoadedVrm({
          status: 'error',
          assetRef: input.assetRef,
          vrm: null,
          error: error instanceof Error ? error.message : 'Failed to load desktop avatar asset.',
        });
      });

    return () => {
      active = false;
    };
  }, [desktopAssetRef, input.assetRef, networkAssetUrl]);

  useEffect(() => {
    if (!effectiveLoadState.assetUrl && !activeResolvedAssetBuffer) {
      setLoadedVrm((previous) => previous.status === 'loading' && previous.assetRef === input.assetRef
        ? previous
        : {
            status: 'idle',
            assetRef: input.assetRef,
            vrm: null,
            error: null,
          });
      return undefined;
    }

    let active = true;
    let retainedVrm: VRM | null = null;
    setLoadedVrm({
      status: 'loading',
      assetRef: input.assetRef,
      vrm: null,
      error: null,
    });

    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const restoreCreateImageBitmap = suspendCreateImageBitmapForTauriVrmLoad();

    const handleLoad = (gltf: GLTF) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          if (active) {
            setLoadedVrm({
              status: 'error',
              assetRef: input.assetRef,
              vrm: null,
              error: 'A VRM profile was requested, but the asset did not expose VRM data.',
            });
          }
          return;
        }

        retainedVrm = vrm;
        VRMUtils.rotateVRM0(vrm);
        applyIdlePose(vrm);
        vrm.scene.traverse((object: { frustumCulled: boolean }) => {
          object.frustumCulled = false;
        });

        if (!active) {
          VRMUtils.deepDispose(vrm.scene);
          return;
        }

        setLoadedVrm({
          status: 'ready',
          assetRef: input.assetRef,
          vrm,
          error: null,
        });
      };
    const handleError = (error: unknown) => {
        if (!active) {
          return;
        }
        setLoadedVrm({
          status: 'error',
          assetRef: input.assetRef,
          vrm: null,
          error: error instanceof Error ? error.message : 'Failed to load VRM asset.',
        });
      };

    try {
      if (activeResolvedAssetBuffer) {
        try {
          loader.parse(activeResolvedAssetBuffer, '', handleLoad, handleError);
        } catch (error) {
          handleError(error);
        }
      } else {
        loader.load(
          effectiveLoadState.assetUrl as string,
          handleLoad,
          undefined,
          handleError,
        );
      }
    } finally {
      restoreCreateImageBitmap();
    }

    return () => {
      active = false;
      if (retainedVrm) {
        recordGlobalVrmDispose({
          assetRef: input.assetRef,
          sceneResources: collectChatAgentAvatarVrmSceneResourceCounts(retainedVrm.scene),
        });
        VRMUtils.deepDispose(retainedVrm.scene);
      }
    };
  }, [activeResolvedAssetBuffer, effectiveLoadState.assetUrl, input.assetRef]);

  const debugLines = chrome === 'minimal' && resolvedViewportStatus.status !== 'ready'
    ? [
      `status: ${diagnostic.status}`,
      `stage: ${diagnostic.stage}`,
      `phase: ${state.phase}`,
      `posture: ${state.posture}`,
      `speakingEnergy: ${state.speakingEnergy.toFixed(2)}`,
      `source: ${diagnostic.source}`,
      `assetRef: ${diagnostic.assetRef || 'none'}`,
      diagnostic.assetLabel ? `assetLabel: ${diagnostic.assetLabel}` : null,
      diagnostic.resourceId ? `resourceId: ${diagnostic.resourceId}` : null,
      `assetUrl: ${diagnostic.assetUrl || 'none'}`,
      diagnostic.networkAssetUrl ? `networkAssetUrl: ${diagnostic.networkAssetUrl}` : null,
      diagnostic.posterUrl ? `posterUrl: ${diagnostic.posterUrl}` : null,
      `resizePosture: ${diagnostic.resizePosture}`,
      `hostRenderable: ${diagnostic.hostRenderable ? 'true' : 'false'}`,
      `viewport: ${diagnostic.viewportWidth}x${diagnostic.viewportHeight}`,
      `canvasEpoch: ${diagnostic.canvasEpoch}`,
      diagnostic.recoveryReason ? `recoveryReason: ${diagnostic.recoveryReason}` : null,
      diagnostic.recoveryAttemptCount > 0 ? `recoveryAttemptCount: ${diagnostic.recoveryAttemptCount}` : null,
      diagnostic.error ? `error: ${diagnostic.error}` : null,
    ].filter(Boolean)
    : [];

  const showPosterFallback = chrome === 'minimal'
    && resolvedViewportStatus.status !== 'ready'
    && runtimeLifecycle.reason !== 'webgl-context-lost'
    && runtimeLifecycle.reason !== 'webgl-context-restored'
    && Boolean(input.posterUrl);

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden',
        chrome === 'minimal'
          ? 'bg-transparent'
          : 'bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(224,231,255,0.88)_45%,rgba(186,230,253,0.7)_68%,rgba(14,165,233,0.16))]',
      )}
      data-desktop-agent-vrm-viewport="true"
      data-avatar-vrm-status={resolvedViewportStatus.status}
      data-avatar-vrm-stage={diagnostic.stage}
      data-avatar-attention-active={attentionState?.active ? 'true' : 'false'}
    >
      {chrome === 'minimal' || !input.posterUrl ? null : (
        <img
          src={input.posterUrl}
          alt={input.label}
          className={cn(
            'absolute inset-0 h-full w-full object-cover saturate-150',
            'opacity-20',
          )}
        />
      )}
      {chrome === 'minimal' ? null : (
        <span
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.58),transparent_54%)]"
        />
      )}
      <div className={cn(
        'absolute overflow-hidden',
        chrome === 'minimal'
          ? 'inset-0'
          : 'inset-[6%] rounded-[46%] border border-white/70 bg-white/18 shadow-[0_30px_80px_rgba(14,165,233,0.14)]',
      )} ref={viewportHostRef}>
        {showPosterFallback ? (
          <div className="relative h-full w-full overflow-hidden bg-transparent">
            <img
              src={input.posterUrl || ''}
              alt={input.label}
              className={cn(
                'absolute saturate-[1.08]',
                chrome === 'minimal'
                  ? 'inset-0 h-full w-full object-contain object-center opacity-[0.96]'
                  : 'inset-0 h-full w-full object-cover object-top',
              )}
            />
            {chrome === 'minimal' ? null : (
              <>
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_14%,rgba(255,255,255,0.72),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.12),transparent_26%,rgba(15,23,42,0.08)_94%)]" />
                <span className="absolute inset-x-[12%] bottom-[8%] h-[22%] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.24),rgba(14,165,233,0.12)_48%,transparent_78%)] blur-2xl" />
                <span className="absolute inset-x-0 bottom-0 h-[28%] bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.16)_18%,rgba(9,22,34,0.28))]" />
              </>
            )}
          </div>
        ) : (
          <Canvas
            key={canvasEpoch}
            camera={{ position: [0, 0.42, 5.1], fov: 26, near: 0.01, far: 20 }}
            dpr={[1, 1.8]}
            gl={{ antialias: true, alpha: true }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 0.92;
              setRuntimeLifecycle((current) => (
                current.phase === 'failed'
                  ? current
                  : {
                      ...current,
                      phase: 'stable',
                      reason: null,
                      error: null,
                    }
              ));
            }}
          >
            <VrmRenderLoopTelemetry canvasEpoch={canvasEpoch} ready={activeLoadedVrm.status === 'ready'} />
            <Suspense fallback={null}>
              <AvatarScene
                state={state}
                input={input}
                loadedVrm={activeLoadedVrm}
                framing={activeVrmFraming}
                verticalOffsetY={stageVerticalOffsetY}
                transparentBackground={chrome === 'minimal'}
              />
            </Suspense>
          </Canvas>
        )}
      </div>
      {chrome === 'default' ? (
        <span
          className="pointer-events-none absolute inset-[10%] rounded-[48%] border"
          style={{
            borderColor: `${state.accentColor}38`,
            boxShadow: `0 0 0 1px ${state.glowColor}2a inset`,
          }}
        />
      ) : null}
      {chrome === 'default' ? (
        <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/75 bg-slate-950/82 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              state.phase === 'speaking' || state.phase === 'listening' ? 'animate-pulse' : '',
            )}
            style={{ background: state.glowColor }}
          />
          <span>{state.badgeLabel}</span>
        </span>
      ) : null}
      {chrome === 'default' && resolvedViewportStatus.status === 'loading' ? (
        <span className="absolute top-11 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
          {diagnostic.recoveryReason ? 'Recovering model' : 'Loading model'}
        </span>
      ) : null}
      {chrome === 'default' && resolvedViewportStatus.status === 'error' ? (
        <span
          className="absolute top-11 max-w-[72%] rounded-full border border-amber-200/80 bg-white/92 px-2.5 py-1 text-center text-[10px] font-semibold text-amber-700 shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
          title={resolvedViewportStatus.error || undefined}
        >
          VRM fallback active
        </span>
      ) : null}
      {chrome === 'default' ? (
        <>
          <span className="absolute left-3 top-3 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-[0_8px_20px_rgba(14,165,233,0.12)]" style={{ color: state.accentColor }}>
            {resolvedViewportStatus.status === 'ready' ? 'VRM Live' : 'VRM'}
          </span>
          <span className="absolute right-3 top-3 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
            {state.emotion}
          </span>
          <span className="absolute bottom-12 rounded-full border border-white/70 bg-white/86 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
            {state.assetLabel}
          </span>
        </>
      ) : null}
      {chrome === 'minimal' && debugLines.length > 0 ? (
        <div
          className="absolute inset-x-3 bottom-3 rounded-2xl nimi-material-glass-thin border border-amber-200/70 bg-[var(--nimi-material-glass-thin-bg)] px-3 py-2 text-[10px] leading-4 text-amber-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-[var(--nimi-backdrop-blur-thin)]"
          data-avatar-vrm-debug="true"
        >
          {debugLines.map((line) => (
            <div key={line} className="truncate font-mono">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
