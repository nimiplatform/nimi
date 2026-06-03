import { useEffect, useMemo, useRef, useState } from 'react';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  resolveAvatarVrmFramingFromScene as resolveChatAgentAvatarVrmFramingFromScene,
  type AvatarVrmFramingResult as ChatAgentAvatarVrmFramingResult,
  type AvatarVrmViewportComponentProps,
} from '@nimiplatform/kit/features/avatar/vrm';
import {
  resolveChatAgentAvatarVrmFramingIntent,
  type ChatAgentAvatarFramingIntent,
} from './chat-agent-avatar-framing-intent';
import {
  parseDesktopAgentAvatarAssetRef,
  type DesktopAgentAvatarAssetRef,
  resolveChatAgentAvatarVrmAssetUrl,
  resolveChatAgentAvatarVrmExpressionWeights,
  resolveChatAgentAvatarVrmViewportState,
} from './chat-agent-avatar-vrm-viewport-state';
import type { ChatAgentAvatarAttentionState } from './chat-agent-avatar-attention-state';
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
  resolveChatAgentAvatarVrmViewportStatus,
  suspendCreateImageBitmapForTauriVrmLoad,
  VRM_CONTEXT_RECOVERY_TIMEOUT_MS,
  type ChatAgentAvatarVrmResolvedAssetState,
  type ChatAgentAvatarVrmRuntimeLifecycleState,
  type LoadedVrmState,
  type VrmViewportStatus,
} from './chat-agent-avatar-vrm-runtime';
import { applyIdlePose } from './chat-agent-avatar-vrm-scene';
import { ChatAgentAvatarVrmViewportFrame } from './chat-agent-avatar-vrm-viewport-frame';
import {
  buildChatAgentAvatarVrmDebugLines,
  shouldShowChatAgentAvatarVrmPosterFallback,
} from './chat-agent-avatar-vrm-debug-projection';
import { useChatAgentAvatarVrmHostMetrics } from './chat-agent-avatar-vrm-host-metrics-hook';

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
  framingIntent?: ChatAgentAvatarFramingIntent;
};

const MINIMAL_CHAT_AGENT_VRM_VERTICAL_OFFSET_Y = -0.12;

export default function ChatAgentAvatarVrmViewport({
  input,
  chrome = 'default',
  attentionState,
  onLoadStateChange,
  onLoadErrorChange,
  onDiagnosticChange,
  framingIntent = 'conversation',
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
  const [runtimeLifecycle, setRuntimeLifecycle] = useState<ChatAgentAvatarVrmRuntimeLifecycleState>({
    phase: 'stable',
    reason: null,
    attemptCount: 0,
    error: null,
  });
  const {
    lastRenderableFramingViewportSize,
    viewportHostMetrics,
  } = useChatAgentAvatarVrmHostMetrics({
    setRuntimeLifecycle,
    viewportHostRef,
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
          intent: resolveChatAgentAvatarVrmFramingIntent(framingIntent),
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
    setResolvedAsset({
      assetRef: input.assetRef,
      url: null,
      arrayBuffer: null,
    });
    setLoadedVrm({
      status: 'error',
      assetRef: input.assetRef,
      vrm: null,
      error: 'desktop-avatar:// asset references are decommissioned; use Avatar-owned local asset materialization.',
    });

    return undefined;
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

  const debugLines = buildChatAgentAvatarVrmDebugLines({
    chrome,
    diagnostic,
    resolvedStatus: resolvedViewportStatus.status,
    state,
  });

  const showPosterFallback = shouldShowChatAgentAvatarVrmPosterFallback({
    chrome,
    posterUrl: input.posterUrl,
    runtimeReason: runtimeLifecycle.reason,
    status: resolvedViewportStatus.status,
  });

  return (
    <ChatAgentAvatarVrmViewportFrame
      input={input}
      chrome={chrome}
      state={state}
      diagnostic={diagnostic}
      resolvedViewportStatus={resolvedViewportStatus}
      attentionState={attentionState}
      viewportHostRef={viewportHostRef}
      showPosterFallback={showPosterFallback}
      debugLines={debugLines}
      canvasEpoch={canvasEpoch}
      activeLoadedVrm={activeLoadedVrm}
      activeVrmFraming={activeVrmFraming}
      stageVerticalOffsetY={stageVerticalOffsetY}
      setRuntimeLifecycle={setRuntimeLifecycle}
    />
  );
}
