import * as THREE from 'three';

const FALLBACK_VRM_WIDTH = 0.9;
const FALLBACK_VRM_HEIGHT = 1.8;
const FALLBACK_VRM_DEPTH = 0.75;
const FALLBACK_RAIL_WIDTH = 360;
const FALLBACK_RAIL_HEIGHT = 820;

type AvatarVrmSceneObject = unknown;

export type AvatarVrmFramingMetrics = {
  width: number;
  height: number;
  depth: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  silhouetteAspect: number;
  widthRatio: number;
};

export type AvatarVrmFramingIntent = 'auto' | 'full-body' | 'bottom-companion' | 'head-shoulders';

export type AvatarVrmFramingPolicy = {
  mode: 'full-body-tall' | 'upper-body-portrait' | 'broad-portrait' | 'default' | 'bottom-companion' | 'head-shoulders';
  selectionReason:
    | 'silhouette-aspect-threshold'
    | 'width-ratio-threshold'
    | 'portrait-default'
    | 'landscape-default'
    | 'framing-intent';
  fitHeight: number;
  fitWidth: number;
  fitDepth: number;
  targetTop: number;
  minBottom: number;
  zOffset: number;
};

export type AvatarVrmFramingResult = {
  metrics: AvatarVrmFramingMetrics;
  policy: AvatarVrmFramingPolicy;
  railWidth: number;
  railHeight: number;
  railAspect: number;
  railIsPortrait: boolean;
  scale: number;
  positionX: number;
  positionY: number;
  positionZ: number;
};

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeRailDimensions(input: {
  railWidth: number;
  railHeight: number;
}): {
  railWidth: number;
  railHeight: number;
  railAspect: number;
  railIsPortrait: boolean;
} {
  const railWidth = normalizeDimension(input.railWidth, FALLBACK_RAIL_WIDTH);
  const railHeight = normalizeDimension(input.railHeight, FALLBACK_RAIL_HEIGHT);
  return {
    railWidth,
    railHeight,
    railAspect: railHeight / railWidth,
    railIsPortrait: railHeight > railWidth,
  };
}

function createFallbackMetrics(): AvatarVrmFramingMetrics {
  const width = FALLBACK_VRM_WIDTH;
  const height = FALLBACK_VRM_HEIGHT;
  const depth = FALLBACK_VRM_DEPTH;
  return {
    width,
    height,
    depth,
    minX: -width / 2,
    minY: -height / 2,
    minZ: -depth / 2,
    maxX: width / 2,
    maxY: height / 2,
    maxZ: depth / 2,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    silhouetteAspect: height / width,
    widthRatio: width / height,
  };
}

export function measureAvatarVrmFramingMetrics(
  scene: AvatarVrmSceneObject,
): AvatarVrmFramingMetrics {
  const box = new THREE.Box3().setFromObject(scene as never);
  if (box.isEmpty()) {
    return createFallbackMetrics();
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const width = normalizeDimension(size.x, FALLBACK_VRM_WIDTH);
  const height = normalizeDimension(size.y, FALLBACK_VRM_HEIGHT);
  const depth = normalizeDimension(size.z, FALLBACK_VRM_DEPTH);
  return {
    width,
    height,
    depth,
    minX: Number.isFinite(box.min.x) ? box.min.x : -width / 2,
    minY: Number.isFinite(box.min.y) ? box.min.y : -height / 2,
    minZ: Number.isFinite(box.min.z) ? box.min.z : -depth / 2,
    maxX: Number.isFinite(box.max.x) ? box.max.x : width / 2,
    maxY: Number.isFinite(box.max.y) ? box.max.y : height / 2,
    maxZ: Number.isFinite(box.max.z) ? box.max.z : depth / 2,
    centerX: Number.isFinite(center.x) ? center.x : 0,
    centerY: Number.isFinite(center.y) ? center.y : 0,
    centerZ: Number.isFinite(center.z) ? center.z : 0,
    silhouetteAspect: height / width,
    widthRatio: width / height,
  };
}

export function resolveAvatarVrmFramingPolicy(input: {
  railWidth: number;
  railHeight: number;
  metrics: AvatarVrmFramingMetrics;
  intent?: AvatarVrmFramingIntent;
}): AvatarVrmFramingPolicy {
  const rail = normalizeRailDimensions(input);
  const intent: AvatarVrmFramingIntent = input.intent ?? 'auto';

  if (intent === 'bottom-companion') {
    return {
      mode: 'bottom-companion',
      selectionReason: 'framing-intent',
      fitHeight: 4.8,
      fitWidth: 2.7,
      fitDepth: 2.1,
      targetTop: 1.28,
      minBottom: -6,
      zOffset: -0.3,
    };
  }

  if (intent === 'head-shoulders' && rail.railIsPortrait) {
    return {
      mode: 'head-shoulders',
      selectionReason: 'framing-intent',
      fitHeight: 3.8,
      fitWidth: 2.4,
      fitDepth: 2,
      targetTop: 1.18,
      minBottom: -5,
      zOffset: -0.22,
    };
  }

  if (rail.railIsPortrait) {
    if (input.metrics.silhouetteAspect >= 2.6) {
      return {
        mode: 'full-body-tall',
        selectionReason: 'silhouette-aspect-threshold',
        fitHeight: 2.94,
        fitWidth: 1.88,
        fitDepth: 1.5,
        targetTop: 1.52,
        minBottom: -1.98,
        zOffset: -0.18,
      };
    }
    if (input.metrics.widthRatio >= 0.58) {
      return {
        mode: 'broad-portrait',
        selectionReason: 'width-ratio-threshold',
        fitHeight: 2.68,
        fitWidth: 1.72,
        fitDepth: 1.42,
        targetTop: 1.48,
        minBottom: -1.88,
        zOffset: -0.12,
      };
    }
    return {
      mode: 'upper-body-portrait',
      selectionReason: 'portrait-default',
      fitHeight: 2.72,
      fitWidth: 1.9,
      fitDepth: 1.5,
      targetTop: 1.46,
      minBottom: -1.78,
      zOffset: -0.16,
    };
  }
  return {
    mode: 'default',
    selectionReason: 'landscape-default',
    fitHeight: 2.82,
    fitWidth: 1.96,
    fitDepth: 1.52,
    targetTop: 1.48,
    minBottom: -1.96,
    zOffset: -0.18,
  };
}

export function resolveAvatarVrmFramingResult(input: {
  railWidth: number;
  railHeight: number;
  metrics: AvatarVrmFramingMetrics;
  intent?: AvatarVrmFramingIntent;
}): AvatarVrmFramingResult {
  const rail = normalizeRailDimensions(input);
  const policy = resolveAvatarVrmFramingPolicy({
    railWidth: rail.railWidth,
    railHeight: rail.railHeight,
    metrics: input.metrics,
    intent: input.intent,
  });
  const scale = Math.min(
    policy.fitHeight / input.metrics.height,
    policy.fitWidth / input.metrics.width,
    policy.fitDepth / input.metrics.depth,
  );
  const anchoredTopY = policy.targetTop - input.metrics.maxY * scale;
  const protectedBottomY = policy.minBottom - input.metrics.minY * scale;
  return {
    metrics: input.metrics,
    policy,
    railWidth: rail.railWidth,
    railHeight: rail.railHeight,
    railAspect: rail.railAspect,
    railIsPortrait: rail.railIsPortrait,
    scale,
    positionX: -input.metrics.centerX * scale,
    positionY: Math.max(anchoredTopY, protectedBottomY),
    positionZ: -input.metrics.centerZ * scale + policy.zOffset,
  };
}

export function resolveAvatarVrmFramingFromScene(input: {
  railWidth: number;
  railHeight: number;
  scene: AvatarVrmSceneObject;
  intent?: AvatarVrmFramingIntent;
}): AvatarVrmFramingResult {
  return resolveAvatarVrmFramingResult({
    railWidth: input.railWidth,
    railHeight: input.railHeight,
    metrics: measureAvatarVrmFramingMetrics(input.scene),
    intent: input.intent,
  });
}
