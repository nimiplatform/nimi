import * as THREE from 'three';

import type {
  ChatAgentAvatarVrmExpressionWeights,
  ChatAgentAvatarVrmViewportState,
  DesktopAgentAvatarAssetRef,
} from './chat-agent-avatar-vrm-viewport-state';
import type { ChatAgentAvatarVrmFramingResult } from './chat-agent-avatar-vrm-framing';
import type {
  ChatAgentAvatarVrmResizePosture,
  ChatAgentAvatarVrmRuntimeLifecycleState,
  VrmViewportStatus,
} from './chat-agent-avatar-vrm-runtime';

export type ChatAgentAvatarVrmResourceCounts = {
  objectCount: number;
  meshCount: number;
  skinnedMeshCount: number;
  geometryCount: number;
  materialCount: number;
  textureCount: number;
  morphTargetCount: number;
};

type ChatAgentAvatarVrmRendererMemoryDebug = {
  geometries: number | null;
  textures: number | null;
  programs: number | null;
};

type ChatAgentAvatarVrmPerformanceDebug = {
  loadSuccessCount: number;
  disposeCount: number;
  disposedGeometryCount: number;
  disposedMaterialCount: number;
  disposedTextureCount: number;
  lastLoadedAssetRef: string | null;
  lastLoadedAt: number | null;
  lastDisposedAssetRef: string | null;
  lastDisposedAt: number | null;
  sceneResources: ChatAgentAvatarVrmResourceCounts | null;
  rendererMemory: ChatAgentAvatarVrmRendererMemoryDebug | null;
};

type ChatAgentAvatarVrmRenderLoopDebug = {
  canvasEpoch: number;
  frameCount: number;
  readyFrameCount: number;
  lastFrameAt: number | null;
  lastReadyFrameAt: number | null;
};

export type ChatAgentAvatarVrmDiagnostic = {
  backendKind: 'vrm';
  stage: 'idle' | 'asset-resolve' | 'vrm-load' | 'ready';
  status: VrmViewportStatus;
  assetRef: string;
  assetLabel: string | null;
  resourceId: string | null;
  assetUrl: string | null;
  networkAssetUrl: string | null;
  posterUrl: string | null;
  error: string | null;
  source: 'desktop-resource' | 'network' | 'none';
  pointerHovered: boolean;
  recoveryAttemptCount: number;
  recoveryReason: ChatAgentAvatarVrmRuntimeLifecycleState['reason'];
  resizePosture: ChatAgentAvatarVrmResizePosture;
  viewportWidth: number;
  viewportHeight: number;
  hostRenderable: boolean;
  canvasEpoch: number;
};

type ChatAgentAvatarVrmDebugSnapshot = {
  diagnostic: ChatAgentAvatarVrmDiagnostic;
  viewportState: {
    phase: ChatAgentAvatarVrmViewportState['phase'];
    posture: ChatAgentAvatarVrmViewportState['posture'];
    emotion: ChatAgentAvatarVrmViewportState['emotion'];
    badgeLabel: ChatAgentAvatarVrmViewportState['badgeLabel'];
    assetLabel: ChatAgentAvatarVrmViewportState['assetLabel'];
    amplitude: ChatAgentAvatarVrmViewportState['amplitude'];
    speakingEnergy: ChatAgentAvatarVrmViewportState['speakingEnergy'];
    pointerInfluence: ChatAgentAvatarVrmViewportState['pointerInfluence'];
    mouthOpen: ChatAgentAvatarVrmViewportState['mouthOpen'];
    eyeOpen: ChatAgentAvatarVrmViewportState['eyeOpen'];
    blinkSpeed: ChatAgentAvatarVrmViewportState['blinkSpeed'];
  };
  expression: {
    activeViseme: string | null;
    weights: ChatAgentAvatarVrmExpressionWeights;
  };
  framing: {
    mode: ChatAgentAvatarVrmFramingResult['policy']['mode'];
    selectionReason: ChatAgentAvatarVrmFramingResult['policy']['selectionReason'];
    scale: number;
    positionX: number;
    positionY: number;
    positionZ: number;
    railWidth: number;
    railHeight: number;
    railAspect: number;
    railIsPortrait: boolean;
    fitHeight: number;
    fitWidth: number;
    fitDepth: number;
    targetTop: number;
    minBottom: number;
    zOffset: number;
    width: number;
    height: number;
    depth: number;
    silhouetteAspect: number;
    widthRatio: number;
  } | null;
  renderLoop: ChatAgentAvatarVrmRenderLoopDebug;
  performance: ChatAgentAvatarVrmPerformanceDebug;
};

function createInitialVrmRenderLoopDebug(canvasEpoch: number): ChatAgentAvatarVrmRenderLoopDebug {
  return {
    canvasEpoch,
    frameCount: 0,
    readyFrameCount: 0,
    lastFrameAt: null,
    lastReadyFrameAt: null,
  };
}

function createEmptyVrmResourceCounts(): ChatAgentAvatarVrmResourceCounts {
  return {
    objectCount: 0,
    meshCount: 0,
    skinnedMeshCount: 0,
    geometryCount: 0,
    materialCount: 0,
    textureCount: 0,
    morphTargetCount: 0,
  };
}

function createInitialVrmPerformanceDebug(): ChatAgentAvatarVrmPerformanceDebug {
  return {
    loadSuccessCount: 0,
    disposeCount: 0,
    disposedGeometryCount: 0,
    disposedMaterialCount: 0,
    disposedTextureCount: 0,
    lastLoadedAssetRef: null,
    lastLoadedAt: null,
    lastDisposedAssetRef: null,
    lastDisposedAt: null,
    sceneResources: null,
    rendererMemory: null,
  };
}

function readGlobalVrmDebugSnapshot(): ChatAgentAvatarVrmDebugSnapshot | null {
  return (globalThis as typeof globalThis & {
    __NIMI_VRM_DEBUG__?: ChatAgentAvatarVrmDebugSnapshot | null;
  }).__NIMI_VRM_DEBUG__ || null;
}

export function setGlobalVrmDebugSnapshot(snapshot: ChatAgentAvatarVrmDebugSnapshot | null): void {
  (globalThis as typeof globalThis & {
    __NIMI_VRM_DEBUG__?: ChatAgentAvatarVrmDebugSnapshot | null;
  }).__NIMI_VRM_DEBUG__ = snapshot;
}

function readGlobalVrmPerformanceDebug(): ChatAgentAvatarVrmPerformanceDebug {
  return (globalThis as typeof globalThis & {
    __NIMI_VRM_DEBUG_PERFORMANCE__?: ChatAgentAvatarVrmPerformanceDebug | null;
  }).__NIMI_VRM_DEBUG_PERFORMANCE__ || createInitialVrmPerformanceDebug();
}

function setGlobalVrmPerformanceDebug(snapshot: ChatAgentAvatarVrmPerformanceDebug): void {
  (globalThis as typeof globalThis & {
    __NIMI_VRM_DEBUG_PERFORMANCE__?: ChatAgentAvatarVrmPerformanceDebug | null;
  }).__NIMI_VRM_DEBUG_PERFORMANCE__ = snapshot;
}

function collectMaterialTextures(material: Record<string, unknown>): Array<{ uuid: string }> {
  const textures: Array<{ uuid: string }> = [];
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) {
      textures.push({ uuid: (value as { uuid: string }).uuid });
    }
  }
  return textures;
}

export function collectChatAgentAvatarVrmSceneResourceCounts(root: {
  traverse: (callback: (object: unknown) => void) => void;
}): ChatAgentAvatarVrmResourceCounts {
  const geometryKeys = new Set<string>();
  const materialKeys = new Set<string>();
  const textureKeys = new Set<string>();
  const counts = createEmptyVrmResourceCounts();
  root.traverse((object: unknown) => {
    const sceneObject = object as {
      material?: unknown;
      geometry?: unknown;
      morphTargetInfluences?: { length: number } | null;
    };
    counts.objectCount += 1;
    if (object instanceof THREE.Mesh) {
      const mesh = object as {
        geometry?: unknown;
        morphTargetInfluences?: { length: number } | null;
        material?: unknown;
      };
      counts.meshCount += 1;
      if (object instanceof THREE.SkinnedMesh) {
        counts.skinnedMeshCount += 1;
      }
      const geometry = mesh.geometry;
      if (geometry instanceof THREE.BufferGeometry) {
        const geometryRecord = geometry as { uuid: string };
        geometryKeys.add(geometryRecord.uuid);
      }
      if (mesh.morphTargetInfluences) {
        counts.morphTargetCount += mesh.morphTargetInfluences.length;
      }
      const materials = Array.isArray(sceneObject.material)
        ? sceneObject.material
        : sceneObject.material
          ? [sceneObject.material]
          : [];
      for (const material of materials) {
        if (!(material instanceof THREE.Material)) {
          continue;
        }
        materialKeys.add(material.uuid);
        for (const texture of collectMaterialTextures(material)) {
          textureKeys.add(texture.uuid);
        }
      }
    }
  });
  return {
    objectCount: counts.objectCount,
    meshCount: counts.meshCount,
    skinnedMeshCount: counts.skinnedMeshCount,
    geometryCount: geometryKeys.size,
    materialCount: materialKeys.size,
    textureCount: textureKeys.size,
    morphTargetCount: counts.morphTargetCount,
  };
}

function recordGlobalVrmLoadSuccess(input: {
  assetRef: string;
  sceneResources: ChatAgentAvatarVrmResourceCounts;
}): void {
  const previous = readGlobalVrmPerformanceDebug();
  setGlobalVrmPerformanceDebug({
    ...previous,
    loadSuccessCount: previous.loadSuccessCount + 1,
    lastLoadedAssetRef: input.assetRef,
    lastLoadedAt: Date.now(),
    sceneResources: input.sceneResources,
  });
}

export function recordGlobalVrmDispose(input: {
  assetRef: string;
  sceneResources: ChatAgentAvatarVrmResourceCounts;
}): void {
  const previous = readGlobalVrmPerformanceDebug();
  setGlobalVrmPerformanceDebug({
    ...previous,
    disposeCount: previous.disposeCount + 1,
    disposedGeometryCount: previous.disposedGeometryCount + input.sceneResources.geometryCount,
    disposedMaterialCount: previous.disposedMaterialCount + input.sceneResources.materialCount,
    disposedTextureCount: previous.disposedTextureCount + input.sceneResources.textureCount,
    lastDisposedAssetRef: input.assetRef,
    lastDisposedAt: Date.now(),
  });
}

function readRendererMemoryDebug(gl: unknown): ChatAgentAvatarVrmRendererMemoryDebug | null {
  const renderer = gl as {
    info?: {
      memory?: {
        geometries?: unknown;
        textures?: unknown;
      };
      programs?: { length: number } | null;
    };
  } | null;
  const geometries = renderer?.info?.memory?.geometries;
  const textures = renderer?.info?.memory?.textures;
  const programCount = renderer?.info?.programs?.length;
  if (
    typeof geometries !== 'number'
    && typeof textures !== 'number'
    && typeof programCount !== 'number'
  ) {
    return null;
  }
  return {
    geometries: typeof geometries === 'number' ? geometries : null,
    textures: typeof textures === 'number' ? textures : null,
    programs: typeof programCount === 'number' ? programCount : null,
  };
}

export function recordGlobalVrmRenderLoopFrame(input: {
  canvasEpoch: number;
  ready: boolean;
  gl: unknown;
}): void {
  const snapshot = readGlobalVrmDebugSnapshot();
  if (!snapshot) {
    return;
  }
  const previousRenderLoop = snapshot.renderLoop.canvasEpoch === input.canvasEpoch
    ? snapshot.renderLoop
    : createInitialVrmRenderLoopDebug(input.canvasEpoch);
  const rendererMemory = readRendererMemoryDebug(input.gl);
  const now = Date.now();
  setGlobalVrmDebugSnapshot({
    ...snapshot,
    renderLoop: {
      canvasEpoch: input.canvasEpoch,
      frameCount: previousRenderLoop.frameCount + 1,
      readyFrameCount: input.ready
        ? previousRenderLoop.readyFrameCount + 1
        : previousRenderLoop.readyFrameCount,
      lastFrameAt: now,
      lastReadyFrameAt: input.ready
        ? now
        : previousRenderLoop.lastReadyFrameAt,
    },
    performance: {
      ...snapshot.performance,
      rendererMemory,
    },
  });
}

export function createChatAgentAvatarVrmDiagnostic(input: {
  assetRef: string;
  assetLabel: string | null;
  desktopAssetRef: DesktopAgentAvatarAssetRef | null;
  assetUrl: string | null;
  networkAssetUrl: string | null;
  posterUrl: string | null;
  loadedStatus: VrmViewportStatus;
  loadedError: string | null;
  status?: VrmViewportStatus;
  error?: string | null;
  pointerHovered: boolean;
  assetResolved?: boolean;
  recoveryAttemptCount?: number;
  recoveryReason?: ChatAgentAvatarVrmRuntimeLifecycleState['reason'];
  resizePosture?: ChatAgentAvatarVrmResizePosture;
  viewportWidth?: number;
  viewportHeight?: number;
  hostRenderable?: boolean;
  canvasEpoch?: number;
}): ChatAgentAvatarVrmDiagnostic {
  const source = input.desktopAssetRef
    ? 'desktop-resource'
    : input.networkAssetUrl
      ? 'network'
      : 'none';
  const effectiveStatus = input.status ?? input.loadedStatus;
  const effectiveError = input.error ?? input.loadedError;
  const stage = input.loadedStatus === 'ready'
    ? 'ready'
    : input.loadedStatus === 'idle'
      ? 'idle'
      : input.desktopAssetRef && !input.assetResolved
        ? 'asset-resolve'
        : 'vrm-load';
  return {
    backendKind: 'vrm',
    stage,
    status: effectiveStatus,
    assetRef: input.assetRef,
    assetLabel: input.assetLabel,
    resourceId: input.desktopAssetRef?.resourceId || null,
    assetUrl: input.assetUrl,
    networkAssetUrl: input.networkAssetUrl,
    posterUrl: input.posterUrl || null,
    error: effectiveError,
    source,
    pointerHovered: input.pointerHovered,
    recoveryAttemptCount: input.recoveryAttemptCount ?? 0,
    recoveryReason: input.recoveryReason ?? null,
    resizePosture: input.resizePosture ?? 'tracked-host-size',
    viewportWidth: input.viewportWidth ?? 0,
    viewportHeight: input.viewportHeight ?? 0,
    hostRenderable: input.hostRenderable ?? true,
    canvasEpoch: input.canvasEpoch ?? 0,
  };
}

export function publishGlobalVrmDebugSnapshot(input: {
  diagnostic: ChatAgentAvatarVrmDiagnostic;
  state: ChatAgentAvatarVrmViewportState;
  activeViseme: string | null;
  debugExpressionWeights: ChatAgentAvatarVrmExpressionWeights;
  activeVrmFraming: ChatAgentAvatarVrmFramingResult | null;
  canvasEpoch: number;
  activeVrmResourceCounts: ChatAgentAvatarVrmResourceCounts | null;
}): void {
  const previousRenderLoop = readGlobalVrmDebugSnapshot()?.renderLoop;
  setGlobalVrmDebugSnapshot({
    diagnostic: input.diagnostic,
    viewportState: {
      phase: input.state.phase,
      posture: input.state.posture,
      emotion: input.state.emotion,
      badgeLabel: input.state.badgeLabel,
      assetLabel: input.state.assetLabel,
      amplitude: input.state.amplitude,
      speakingEnergy: input.state.speakingEnergy,
      pointerInfluence: input.state.pointerInfluence,
      mouthOpen: input.state.mouthOpen,
      eyeOpen: input.state.eyeOpen,
      blinkSpeed: input.state.blinkSpeed,
    },
    expression: {
      activeViseme: input.activeViseme,
      weights: input.debugExpressionWeights,
    },
    framing: input.activeVrmFraming
      ? {
          mode: input.activeVrmFraming.policy.mode,
          selectionReason: input.activeVrmFraming.policy.selectionReason,
          scale: input.activeVrmFraming.scale,
          positionX: input.activeVrmFraming.positionX,
          positionY: input.activeVrmFraming.positionY,
          positionZ: input.activeVrmFraming.positionZ,
          railWidth: input.activeVrmFraming.railWidth,
          railHeight: input.activeVrmFraming.railHeight,
          railAspect: input.activeVrmFraming.railAspect,
          railIsPortrait: input.activeVrmFraming.railIsPortrait,
          fitHeight: input.activeVrmFraming.policy.fitHeight,
          fitWidth: input.activeVrmFraming.policy.fitWidth,
          fitDepth: input.activeVrmFraming.policy.fitDepth,
          targetTop: input.activeVrmFraming.policy.targetTop,
          minBottom: input.activeVrmFraming.policy.minBottom,
          zOffset: input.activeVrmFraming.policy.zOffset,
          width: input.activeVrmFraming.metrics.width,
          height: input.activeVrmFraming.metrics.height,
          depth: input.activeVrmFraming.metrics.depth,
          silhouetteAspect: input.activeVrmFraming.metrics.silhouetteAspect,
          widthRatio: input.activeVrmFraming.metrics.widthRatio,
        }
      : null,
    renderLoop: previousRenderLoop?.canvasEpoch === input.canvasEpoch
      ? previousRenderLoop
      : createInitialVrmRenderLoopDebug(input.canvasEpoch),
    performance: {
      ...readGlobalVrmPerformanceDebug(),
      sceneResources: input.activeVrmResourceCounts,
    },
  });
}

export function recordGlobalVrmLoadSceneIfNeeded(input: {
  activeLoadedStatus: VrmViewportStatus;
  assetRef: string;
  sceneUuid: string | null;
  activeVrmResourceCounts: ChatAgentAvatarVrmResourceCounts | null;
  recordedLoadSceneKeyRef: { current: string | null };
}): void {
  if (input.activeLoadedStatus !== 'ready' || !input.activeVrmResourceCounts || !input.sceneUuid) {
    return;
  }
  const sceneKey = `${input.assetRef}:${input.sceneUuid}`;
  if (input.recordedLoadSceneKeyRef.current === sceneKey) {
    return;
  }
  input.recordedLoadSceneKeyRef.current = sceneKey;
  recordGlobalVrmLoadSuccess({
    assetRef: input.assetRef,
    sceneResources: input.activeVrmResourceCounts,
  });
}
