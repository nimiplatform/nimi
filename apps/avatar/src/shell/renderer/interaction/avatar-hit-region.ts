export type AvatarHitRegionName = 'body' | 'head' | 'face' | 'accessory' | null;

export type AvatarHitRegionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  region: AvatarHitRegionName;
};

export type AvatarHitRegionSnapshot = {
  body: AvatarHitRegionRect | null;
  overlays: AvatarHitRegionRect[];
  capturedAtMs: number;
  staleAfterMs: number;
};

export type AvatarHitTestPoint = {
  clientX: number;
  clientY: number;
};

export type AvatarHitTestResult = {
  inside: boolean;
  stale: boolean;
  region: AvatarHitRegionName;
  localX: number;
  localY: number;
};

export function rectFromElement(
  element: Element | null,
  region: AvatarHitRegionName,
): AvatarHitRegionRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    region,
  };
}

export function createAvatarHitRegionSnapshot(input: {
  body: AvatarHitRegionRect | null;
  overlays?: AvatarHitRegionRect[];
  capturedAtMs: number;
  staleAfterMs?: number;
}): AvatarHitRegionSnapshot {
  return {
    body: input.body,
    overlays: input.overlays ?? [],
    capturedAtMs: input.capturedAtMs,
    staleAfterMs: input.staleAfterMs ?? 250,
  };
}

export function hitTestAvatarRegion(
  snapshot: AvatarHitRegionSnapshot | null,
  point: AvatarHitTestPoint,
  nowMs: number,
): AvatarHitTestResult {
  if (!snapshot || nowMs - snapshot.capturedAtMs > snapshot.staleAfterMs) {
    return outsideResult(true);
  }

  for (const overlay of snapshot.overlays) {
    const hit = hitRect(overlay, point);
    if (hit) {
      return hit;
    }
  }

  if (!snapshot.body) {
    return outsideResult(false);
  }

  return hitRect(snapshot.body, point) ?? outsideResult(false);
}

function outsideResult(stale: boolean): AvatarHitTestResult {
  return {
    inside: false,
    stale,
    region: null,
    localX: 0,
    localY: 0,
  };
}

function hitRect(rect: AvatarHitRegionRect, point: AvatarHitTestPoint): AvatarHitTestResult | null {
  const localX = point.clientX - rect.x;
  const localY = point.clientY - rect.y;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
    return null;
  }
  return {
    inside: true,
    stale: false,
    region: inferBodyRegion(rect, localX, localY),
    localX: Math.round(localX),
    localY: Math.round(localY),
  };
}

function inferBodyRegion(rect: AvatarHitRegionRect, localX: number, localY: number): AvatarHitRegionName {
  if (rect.region !== 'body') return rect.region;
  const yRatio = rect.height > 0 ? localY / rect.height : 1;
  const xRatio = rect.width > 0 ? localX / rect.width : 0.5;
  if (yRatio <= 0.22) return 'head';
  if (yRatio <= 0.38 && xRatio >= 0.24 && xRatio <= 0.76) return 'face';
  return 'body';
}
