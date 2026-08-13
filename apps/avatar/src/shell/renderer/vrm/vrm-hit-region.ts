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
  getViewport: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  deviceTier?: VrmHitRegionDeviceTier;
  onDegraded?: (detail: VrmHitRegionDegradedDetail) => void;
};

const FULL_VIEWPORT_RECT: BackendHitRegion['body'] = Object.freeze({
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
});

export function createVrmHitRegion(input: CreateVrmHitRegionInputs): BackendHitRegion {
  const tier = input.deviceTier ?? 'C';

  if (tier === 'C') {
    input.onDegraded?.({
      reason_code: 'device_tier_c',
      recordedAt: new Date().toISOString(),
    });
    return {
      body: FULL_VIEWPORT_RECT,
      drag: FULL_VIEWPORT_RECT,
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
    body: FULL_VIEWPORT_RECT,
    drag: FULL_VIEWPORT_RECT,
    isOpaqueAtClientPoint,
  };
}
