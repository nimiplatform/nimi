import type { BackendHitRegion } from '@nimiplatform/kit/features/avatar/headless';

export const VRM_ALPHA_MASK_THRESHOLD = 10 / 255;
export const VRM_ALPHA_MASK_THRESHOLD_BYTE = 10;

export type VrmHitRegionDegradedDetail = {
  reason_code: 'device_tier_c';
  recordedAt: string;
};

export type VrmHitRegionDeviceTier = 'A' | 'B' | 'C';

export type VrmHitRegionRenderTarget = {
  probeAlphaAtClient(input: {
    clientX: number;
    clientY: number;
    viewport: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  }): number | null;
};

export type CreateVrmHitRegionInputs = {
  renderTarget: VrmHitRegionRenderTarget;
  body: BackendHitRegion['body'];
  drag: BackendHitRegion['drag'];
  getViewport: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  deviceTier?: VrmHitRegionDeviceTier;
  onDegraded?: (detail: VrmHitRegionDegradedDetail) => void;
};

const INVALID_REGION_RECT: BackendHitRegion['body'] = Object.freeze({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
});

function validRect(rect: BackendHitRegion['body']): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    && rect.left >= 0
    && rect.top >= 0
    && rect.right <= 1
    && rect.bottom <= 1
    && rect.right > rect.left
    && rect.bottom > rect.top;
}

// @nimi-authority: rule.nimi.avatar.embodiment.r062
export function createVrmHitRegion(input: CreateVrmHitRegionInputs): BackendHitRegion {
  const tier = input.deviceTier ?? 'C';
  if (!validRect(input.body) || !validRect(input.drag)) {
    return {
      body: INVALID_REGION_RECT,
      drag: INVALID_REGION_RECT,
      isOpaqueAtClientPoint: null,
    };
  }

  if (tier === 'C') {
    input.onDegraded?.({
      reason_code: 'device_tier_c',
      recordedAt: new Date().toISOString(),
    });
    return {
      body: input.body,
      drag: input.drag,
      isOpaqueAtClientPoint: null,
    };
  }

  const isOpaqueAtClientPoint = (
    clientX: number,
    clientY: number,
    threshold?: number,
  ): boolean | null => {
    const viewport = input.getViewport();
    if (viewport == null || viewport.width <= 0 || viewport.height <= 0) return null;
    const alphaByte = input.renderTarget.probeAlphaAtClient({
      clientX,
      clientY,
      viewport,
    });
    if (alphaByte == null) return null;
    const thresholdByte = (threshold ?? VRM_ALPHA_MASK_THRESHOLD) * 255;
    return alphaByte > thresholdByte;
  };

  return {
    body: input.body,
    drag: input.drag,
    isOpaqueAtClientPoint,
  };
}
