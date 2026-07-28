import type { AgentCenterAppearanceProjection } from './types.js';

export function isAgentCenterAvatarPreviewReady(
  appearance: AgentCenterAppearanceProjection,
): boolean {
  const backendKind = normalizeText(appearance.backendKind);
  const avatarAssetRef = normalizeText(appearance.avatarAssetRef);
  const previewMaterialRef = normalizeText(appearance.previewMaterialRef);
  return appearance.avatarAssetValid === true
    && appearance.previewState === 'ready'
    && appearance.previewTier === 'avatar_preview_service'
    && (backendKind === 'live2d' || backendKind === 'vrm')
    && Boolean(avatarAssetRef)
    && Boolean(previewMaterialRef)
    && isAvatarControlledPreviewSurfaceRef(appearance.previewImageRef)
    && isPositiveFiniteNumber(appearance.previewVisiblePixels);
}

export function isAvatarControlledPreviewSurfaceRef(value: unknown): boolean {
  const text = normalizeText(value);
  if (text.startsWith('/') && !text.startsWith('//') && !text.includes('\\')) {
    return true;
  }
  if (!text.startsWith('blob:')) return false;
  const currentOrigin = normalizeText(globalThis.location?.origin);
  if (!currentOrigin || currentOrigin === 'null') return false;
  try {
    return new URL(text.slice('blob:'.length)).origin === currentOrigin;
  } catch {
    return false;
  }
}

export function normalizeAgentCenterPreviewRef(value: unknown): string {
  return normalizeText(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
