import {
  type DesktopMacosSmokeDriverDeps,
  type VrmCanvasStats,
  type VrmExpressionEvidence,
  type VrmFramingEvidence,
  type VrmFramingSignature,
  type VrmPerformanceEvidence,
  type VrmRenderLoopEvidence,
  type VrmRendererMemoryEvidence,
  type VrmResourceCountsEvidence,
  type VrmViewportStateEvidence,
  type VrmVisiblePixelsTimeoutError,
  type WaitForVrmPostureEvidenceInput,
  VRM_VIEWPORT_SELECTOR,
} from './desktop-macos-smoke-shared';

const DEFAULT_VRM_TIMEOUT_MS = 15000;

export function readVrmRenderLoopEvidence(runtimeDebug: Record<string, unknown> | null): VrmRenderLoopEvidence {
  const renderLoop = runtimeDebug && typeof runtimeDebug.renderLoop === 'object' && runtimeDebug.renderLoop
    ? runtimeDebug.renderLoop as Record<string, unknown>
    : null;
  const frameCount = typeof renderLoop?.frameCount === 'number' ? renderLoop.frameCount : 0;
  const readyFrameCount = typeof renderLoop?.readyFrameCount === 'number' ? renderLoop.readyFrameCount : 0;
  const lastFrameAt = typeof renderLoop?.lastFrameAt === 'number' ? renderLoop.lastFrameAt : null;
  const lastReadyFrameAt = typeof renderLoop?.lastReadyFrameAt === 'number' ? renderLoop.lastReadyFrameAt : null;
  const canvasEpoch = typeof renderLoop?.canvasEpoch === 'number' ? renderLoop.canvasEpoch : null;
  return {
    frameCount,
    readyFrameCount,
    lastFrameAt,
    lastReadyFrameAt,
    canvasEpoch,
  };
}

export function readVrmFramingEvidence(runtimeDebug: Record<string, unknown> | null): VrmFramingEvidence {
  const framing = runtimeDebug && typeof runtimeDebug.framing === 'object' && runtimeDebug.framing
    ? runtimeDebug.framing as Record<string, unknown>
    : null;
  return {
    mode: typeof framing?.mode === 'string' ? framing.mode : null,
    selectionReason: typeof framing?.selectionReason === 'string' ? framing.selectionReason : null,
    scale: typeof framing?.scale === 'number' ? framing.scale : null,
    railWidth: typeof framing?.railWidth === 'number' ? framing.railWidth : null,
    railHeight: typeof framing?.railHeight === 'number' ? framing.railHeight : null,
    railAspect: typeof framing?.railAspect === 'number' ? framing.railAspect : null,
    railIsPortrait: typeof framing?.railIsPortrait === 'boolean' ? framing.railIsPortrait : null,
    fitHeight: typeof framing?.fitHeight === 'number' ? framing.fitHeight : null,
    fitWidth: typeof framing?.fitWidth === 'number' ? framing.fitWidth : null,
    fitDepth: typeof framing?.fitDepth === 'number' ? framing.fitDepth : null,
    targetTop: typeof framing?.targetTop === 'number' ? framing.targetTop : null,
    minBottom: typeof framing?.minBottom === 'number' ? framing.minBottom : null,
    zOffset: typeof framing?.zOffset === 'number' ? framing.zOffset : null,
    width: typeof framing?.width === 'number' ? framing.width : null,
    height: typeof framing?.height === 'number' ? framing.height : null,
    depth: typeof framing?.depth === 'number' ? framing.depth : null,
    silhouetteAspect: typeof framing?.silhouetteAspect === 'number' ? framing.silhouetteAspect : null,
    widthRatio: typeof framing?.widthRatio === 'number' ? framing.widthRatio : null,
  };
}

export function readVrmViewportStateEvidence(runtimeDebug: Record<string, unknown> | null): VrmViewportStateEvidence {
  const viewportState = runtimeDebug && typeof runtimeDebug.viewportState === 'object' && runtimeDebug.viewportState
    ? runtimeDebug.viewportState as Record<string, unknown>
    : null;
  return {
    phase: typeof viewportState?.phase === 'string' ? viewportState.phase : null,
    posture: typeof viewportState?.posture === 'string' ? viewportState.posture : null,
    speakingEnergy: typeof viewportState?.speakingEnergy === 'number' ? viewportState.speakingEnergy : null,
    mouthOpen: typeof viewportState?.mouthOpen === 'number' ? viewportState.mouthOpen : null,
    eyeOpen: typeof viewportState?.eyeOpen === 'number' ? viewportState.eyeOpen : null,
    blinkSpeed: typeof viewportState?.blinkSpeed === 'number' ? viewportState.blinkSpeed : null,
  };
}

export function readVrmExpressionEvidence(runtimeDebug: Record<string, unknown> | null): VrmExpressionEvidence {
  const expression = runtimeDebug && typeof runtimeDebug.expression === 'object' && runtimeDebug.expression
    ? runtimeDebug.expression as Record<string, unknown>
    : null;
  const weights = expression && typeof expression.weights === 'object' && expression.weights
    ? expression.weights as Record<string, unknown>
    : null;
  const activeViseme = typeof expression?.activeViseme === 'string' ? expression.activeViseme : null;
  const speakingWeight = activeViseme && typeof weights?.[activeViseme] === 'number'
    ? weights[activeViseme] as number
    : typeof weights?.aa === 'number'
      ? weights.aa
      : null;
  return {
    activeViseme,
    speakingWeight,
    relaxedWeight: typeof weights?.relaxed === 'number' ? weights.relaxed : null,
  };
}

function readVrmResourceCountsEvidence(value: unknown): VrmResourceCountsEvidence | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    objectCount: typeof record.objectCount === 'number' ? record.objectCount : null,
    meshCount: typeof record.meshCount === 'number' ? record.meshCount : null,
    skinnedMeshCount: typeof record.skinnedMeshCount === 'number' ? record.skinnedMeshCount : null,
    geometryCount: typeof record.geometryCount === 'number' ? record.geometryCount : null,
    materialCount: typeof record.materialCount === 'number' ? record.materialCount : null,
    textureCount: typeof record.textureCount === 'number' ? record.textureCount : null,
    morphTargetCount: typeof record.morphTargetCount === 'number' ? record.morphTargetCount : null,
  };
}

export function readVrmPerformanceEvidence(runtimeDebug: Record<string, unknown> | null): VrmPerformanceEvidence {
  const performance = runtimeDebug && typeof runtimeDebug.performance === 'object' && runtimeDebug.performance
    ? runtimeDebug.performance as Record<string, unknown>
    : null;
  const rendererMemory = performance && typeof performance.rendererMemory === 'object' && performance.rendererMemory
    ? performance.rendererMemory as Record<string, unknown>
    : null;
  return {
    loadSuccessCount: typeof performance?.loadSuccessCount === 'number' ? performance.loadSuccessCount : null,
    disposeCount: typeof performance?.disposeCount === 'number' ? performance.disposeCount : null,
    disposedGeometryCount: typeof performance?.disposedGeometryCount === 'number' ? performance.disposedGeometryCount : null,
    disposedMaterialCount: typeof performance?.disposedMaterialCount === 'number' ? performance.disposedMaterialCount : null,
    disposedTextureCount: typeof performance?.disposedTextureCount === 'number' ? performance.disposedTextureCount : null,
    lastLoadedAssetRef: typeof performance?.lastLoadedAssetRef === 'string' ? performance.lastLoadedAssetRef : null,
    lastDisposedAssetRef: typeof performance?.lastDisposedAssetRef === 'string' ? performance.lastDisposedAssetRef : null,
    sceneResources: readVrmResourceCountsEvidence(performance?.sceneResources),
    rendererMemory: rendererMemory
      ? {
          geometries: typeof rendererMemory.geometries === 'number' ? rendererMemory.geometries : null,
          textures: typeof rendererMemory.textures === 'number' ? rendererMemory.textures : null,
          programs: typeof rendererMemory.programs === 'number' ? rendererMemory.programs : null,
        }
      : null,
  };
}

export function assertStableVrmResourceCounts(input: {
  label: string;
  expected: VrmResourceCountsEvidence;
  runtimeDebug: Record<string, unknown> | null;
}) {
  const current = readVrmPerformanceEvidence(input.runtimeDebug).sceneResources;
  if (!current) {
    throw new Error(`vrm performance evidence missing at ${input.label}`);
  }
  for (const key of Object.keys(input.expected) as Array<keyof VrmResourceCountsEvidence>) {
    if (current[key] !== input.expected[key]) {
      throw new Error(
        `vrm resource ${key} drifted at ${input.label}: expected=${input.expected[key]} actual=${current[key]}`,
      );
    }
  }
}

export function assertStableVrmRendererMemory(input: {
  label: string;
  expected: VrmRendererMemoryEvidence;
  runtimeDebug: Record<string, unknown> | null;
}) {
  const current = readVrmPerformanceEvidence(input.runtimeDebug).rendererMemory;
  if (!current) {
    throw new Error(`vrm renderer-memory evidence missing at ${input.label}`);
  }
  for (const key of Object.keys(input.expected) as Array<keyof VrmRendererMemoryEvidence>) {
    if (input.expected[key] === null) {
      continue;
    }
    const expectedValue = input.expected[key];
    const currentValue = current[key];
    const allowedDelta = key === 'textures' ? 1 : 0;
    if (
      typeof expectedValue !== 'number'
      || typeof currentValue !== 'number'
      || currentValue < expectedValue
      || currentValue > expectedValue + allowedDelta
    ) {
      throw new Error(
        `vrm renderer-memory ${key} drifted at ${input.label}: expected=${expectedValue} actual=${currentValue} allowedDelta=${allowedDelta}`,
      );
    }
  }
}

export function resolveVrmFramingSignature(runtimeDebug: Record<string, unknown> | null): VrmFramingSignature | null {
  const framing = readVrmFramingEvidence(runtimeDebug);
  if (
    framing.mode === null
    || framing.selectionReason === null
    || framing.scale === null
    || framing.fitHeight === null
    || framing.fitWidth === null
    || framing.fitDepth === null
    || framing.targetTop === null
    || framing.minBottom === null
    || framing.zOffset === null
    || framing.width === null
    || framing.height === null
    || framing.depth === null
    || framing.silhouetteAspect === null
    || framing.widthRatio === null
  ) {
    return null;
  }
  return {
    mode: framing.mode,
    selectionReason: framing.selectionReason,
    scale: framing.scale,
    fitHeight: framing.fitHeight,
    fitWidth: framing.fitWidth,
    fitDepth: framing.fitDepth,
    targetTop: framing.targetTop,
    minBottom: framing.minBottom,
    zOffset: framing.zOffset,
    width: framing.width,
    height: framing.height,
    depth: framing.depth,
    silhouetteAspect: framing.silhouetteAspect,
    widthRatio: framing.widthRatio,
  };
}

export function assertStableVrmFramingSignature(input: {
  label: string;
  expected: VrmFramingSignature;
  runtimeDebug: Record<string, unknown> | null;
}) {
  const current = resolveVrmFramingSignature(input.runtimeDebug);
  if (!current) {
    throw new Error(`vrm framing evidence missing at ${input.label}`);
  }
  const numericKeys = [
    'scale',
    'fitHeight',
    'fitWidth',
    'fitDepth',
    'targetTop',
    'minBottom',
    'zOffset',
    'width',
    'height',
    'depth',
    'silhouetteAspect',
    'widthRatio',
  ] as const;
  if (current.mode !== input.expected.mode) {
    throw new Error(`vrm framing mode drifted at ${input.label}: expected=${input.expected.mode} actual=${current.mode}`);
  }
  if (current.selectionReason !== input.expected.selectionReason) {
    throw new Error(
      `vrm framing selectionReason drifted at ${input.label}: expected=${input.expected.selectionReason} actual=${current.selectionReason}`,
    );
  }
  for (const key of numericKeys) {
    const delta = Math.abs(current[key] - input.expected[key]);
    if (delta > 0.0001) {
      throw new Error(`vrm framing ${key} drifted at ${input.label}: expected=${input.expected[key]} actual=${current[key]}`);
    }
  }
}

export async function waitForVisibleVrmPixels(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readVrmCanvasStats'>,
  timeoutMs = 15000,
): Promise<VrmCanvasStats> {
  const deadline = Date.now() + timeoutMs;
  let lastStats = await deps.readVrmCanvasStats(VRM_VIEWPORT_SELECTOR);
  const initialRenderLoop = readVrmRenderLoopEvidence(lastStats.runtimeDebug);
  while (Date.now() < deadline) {
    lastStats = await deps.readVrmCanvasStats(VRM_VIEWPORT_SELECTOR);
    if (lastStats.status === 'error') {
      throw new Error(lastStats.fallbackText || 'vrm viewport failed closed');
    }
    const renderLoop = readVrmRenderLoopEvidence(lastStats.runtimeDebug);
    const framing = readVrmFramingEvidence(lastStats.runtimeDebug);
    const viewportState = readVrmViewportStateEvidence(lastStats.runtimeDebug);
    const renderLoopAdvanced = renderLoop.frameCount >= Math.max(2, initialRenderLoop.frameCount + 2);
    const readyLoopAdvanced = renderLoop.readyFrameCount >= Math.max(2, initialRenderLoop.readyFrameCount + 2);
    if (
      lastStats.status === 'ready'
      && lastStats.canvasPresent
      && lastStats.width > 0
      && lastStats.height > 0
      && renderLoopAdvanced
      && readyLoopAdvanced
      && renderLoop.lastFrameAt !== null
      && renderLoop.lastReadyFrameAt !== null
      && viewportState.phase !== null
      && viewportState.posture !== null
      && viewportState.speakingEnergy !== null
      && viewportState.speakingEnergy >= 0
      && framing.mode !== null
      && framing.selectionReason !== null
      && framing.scale !== null
      && framing.scale > 0
      && framing.railWidth !== null
      && framing.railWidth > 0
      && framing.railHeight !== null
      && framing.railHeight > 0
      && framing.railAspect !== null
      && framing.railAspect > 0
      && framing.railIsPortrait !== null
      && framing.fitHeight !== null
      && framing.fitHeight > 0
      && framing.fitWidth !== null
      && framing.fitWidth > 0
      && framing.fitDepth !== null
      && framing.fitDepth > 0
      && framing.targetTop !== null
      && framing.minBottom !== null
      && framing.zOffset !== null
      && framing.width !== null
      && framing.width > 0
      && framing.height !== null
      && framing.height > 0
      && framing.depth !== null
      && framing.depth > 0
      && framing.silhouetteAspect !== null
      && framing.silhouetteAspect > 0
      && framing.widthRatio !== null
      && framing.widthRatio > 0
    ) {
      return lastStats;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const finalRenderLoop = readVrmRenderLoopEvidence(lastStats.runtimeDebug);
  const finalFraming = readVrmFramingEvidence(lastStats.runtimeDebug);
  const finalViewportState = readVrmViewportStateEvidence(lastStats.runtimeDebug);
  const error = new Error(
    [
      'vrm viewport did not produce ready render-loop evidence',
      `status=${lastStats.status || 'missing'}`,
      `stage=${lastStats.stage || 'missing'}`,
      `canvas=${lastStats.canvasPresent ? 'present' : 'missing'}`,
      `size=${lastStats.width}x${lastStats.height}`,
      `context=${lastStats.contextKind || 'none'}`,
      `frameCount=${finalRenderLoop.frameCount}`,
      `readyFrameCount=${finalRenderLoop.readyFrameCount}`,
      `canvasEpoch=${finalRenderLoop.canvasEpoch ?? 'missing'}`,
      `lastFrameAt=${finalRenderLoop.lastFrameAt ?? 'missing'}`,
      `lastReadyFrameAt=${finalRenderLoop.lastReadyFrameAt ?? 'missing'}`,
      `phase=${finalViewportState.phase ?? 'missing'}`,
      `posture=${finalViewportState.posture ?? 'missing'}`,
      `speakingEnergy=${finalViewportState.speakingEnergy ?? 'missing'}`,
      `framingMode=${finalFraming.mode ?? 'missing'}`,
      `framingSelectionReason=${finalFraming.selectionReason ?? 'missing'}`,
      `framingScale=${finalFraming.scale ?? 'missing'}`,
      `framingRail=${finalFraming.railWidth ?? 'missing'}x${finalFraming.railHeight ?? 'missing'} aspect=${finalFraming.railAspect ?? 'missing'} portrait=${finalFraming.railIsPortrait ?? 'missing'}`,
      `framingFit=${finalFraming.fitWidth ?? 'missing'}x${finalFraming.fitHeight ?? 'missing'}x${finalFraming.fitDepth ?? 'missing'}`,
      `framingAnchors=top:${finalFraming.targetTop ?? 'missing'} bottom:${finalFraming.minBottom ?? 'missing'} z:${finalFraming.zOffset ?? 'missing'}`,
      `framingSize=${finalFraming.width ?? 'missing'}x${finalFraming.height ?? 'missing'}x${finalFraming.depth ?? 'missing'}`,
      `framingAspect=${finalFraming.silhouetteAspect ?? 'missing'}`,
      `framingWidthRatio=${finalFraming.widthRatio ?? 'missing'}`,
      `nonTransparentSamples=${lastStats.nonTransparentSampleCount}/${lastStats.sampleCount}`,
      lastStats.sampleError ? `sampleError=${lastStats.sampleError}` : null,
      lastStats.runtimeDebug ? `runtimeDebug=${JSON.stringify(lastStats.runtimeDebug)}` : null,
      lastStats.fallbackText ? `fallback=${lastStats.fallbackText}` : null,
    ].filter(Boolean).join(' '),
  ) as VrmVisiblePixelsTimeoutError;
  error.vrmStats = lastStats;
  throw error;
}

export async function waitForVrmPostureEvidence(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readVrmCanvasStats'>,
  input: WaitForVrmPostureEvidenceInput,
  timeoutMs = DEFAULT_VRM_TIMEOUT_MS,
): Promise<VrmCanvasStats> {
  const deadline = Date.now() + timeoutMs;
  let lastStats = await deps.readVrmCanvasStats(VRM_VIEWPORT_SELECTOR);
  while (Date.now() < deadline) {
    lastStats = await deps.readVrmCanvasStats(VRM_VIEWPORT_SELECTOR);
    if (lastStats.status === 'error') {
      throw new Error(lastStats.fallbackText || 'vrm viewport failed closed');
    }
    const viewportState = readVrmViewportStateEvidence(lastStats.runtimeDebug);
    const expression = readVrmExpressionEvidence(lastStats.runtimeDebug);
    if (
      lastStats.status === 'ready'
      && lastStats.stage === 'ready'
      && lastStats.canvasPresent
      && lastStats.width > 0
      && lastStats.height > 0
      && viewportState.phase === input.expectedPhase
      && viewportState.posture === input.expectedPosture
      && viewportState.speakingEnergy !== null
      && viewportState.speakingEnergy >= (input.minSpeakingEnergy ?? 0)
      && (input.maxSpeakingEnergy == null || viewportState.speakingEnergy <= input.maxSpeakingEnergy)
      && viewportState.mouthOpen !== null
      && viewportState.mouthOpen >= (input.mouthOpenMin ?? 0)
      && (input.mouthOpenMax == null || viewportState.mouthOpen <= input.mouthOpenMax)
      && viewportState.eyeOpen !== null
      && viewportState.eyeOpen >= (input.eyeOpenMin ?? 0)
      && (input.eyeOpenMax == null || viewportState.eyeOpen <= input.eyeOpenMax)
      && viewportState.blinkSpeed !== null
      && viewportState.blinkSpeed >= (input.blinkSpeedMin ?? 0)
      && (input.blinkSpeedMax == null || viewportState.blinkSpeed <= input.blinkSpeedMax)
      && expression.activeViseme === input.expectedActiveViseme
      && (input.minSpeakingWeight == null
        || (expression.speakingWeight !== null && expression.speakingWeight >= input.minSpeakingWeight))
      && (input.maxSpeakingWeight == null
        || expression.speakingWeight == null
        || expression.speakingWeight <= input.maxSpeakingWeight)
      && (input.minRelaxedWeight == null
        || (expression.relaxedWeight !== null && expression.relaxedWeight >= input.minRelaxedWeight))
    ) {
      return lastStats;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const finalViewportState = readVrmViewportStateEvidence(lastStats.runtimeDebug);
  const finalExpression = readVrmExpressionEvidence(lastStats.runtimeDebug);
  throw new Error(
    [
      `vrm viewport did not enter ${input.errorLabel}`,
      `status=${lastStats.status || 'missing'}`,
      `stage=${lastStats.stage || 'missing'}`,
      `canvas=${lastStats.canvasPresent ? 'present' : 'missing'}`,
      `size=${lastStats.width}x${lastStats.height}`,
      `context=${lastStats.contextKind || 'none'}`,
      `phase=${finalViewportState.phase ?? 'missing'}`,
      `posture=${finalViewportState.posture ?? 'missing'}`,
      `speakingEnergy=${finalViewportState.speakingEnergy ?? 'missing'}`,
      `mouthOpen=${finalViewportState.mouthOpen ?? 'missing'}`,
      `eyeOpen=${finalViewportState.eyeOpen ?? 'missing'}`,
      `blinkSpeed=${finalViewportState.blinkSpeed ?? 'missing'}`,
      `expectedPhase=${input.expectedPhase}`,
      `expectedPosture=${input.expectedPosture}`,
      `expectedActiveViseme=${input.expectedActiveViseme ?? 'none'}`,
      `activeViseme=${finalExpression.activeViseme ?? 'missing'}`,
      `speakingWeight=${finalExpression.speakingWeight ?? 'missing'}`,
      `relaxedWeight=${finalExpression.relaxedWeight ?? 'missing'}`,
      lastStats.runtimeDebug ? `runtimeDebug=${JSON.stringify(lastStats.runtimeDebug)}` : null,
      lastStats.fallbackText ? `fallback=${lastStats.fallbackText}` : null,
    ].filter(Boolean).join(' '),
  );
}

export function toVrmCanvasStatsReport(stats: VrmCanvasStats): Record<string, unknown> {
  return {
    status: stats.status,
    stage: stats.stage,
    fallbackText: stats.fallbackText,
    width: stats.width,
    height: stats.height,
    canvasPresent: stats.canvasPresent,
    contextKind: stats.contextKind,
    sampleCount: stats.sampleCount,
    nonTransparentSampleCount: stats.nonTransparentSampleCount,
    sampleError: stats.sampleError,
    runtimeDebug: stats.runtimeDebug ?? undefined,
  };
}
