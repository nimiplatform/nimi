/**
 * Normalize an avatar asset reference into a short label for badges and
 * fallbacks. Shared by the VRM/Live2D surfaces and the placeholder surface;
 * re-exported through `vrm.js` to preserve the public `avatar/vrm` contract.
 */
export function formatAvatarVrmAssetLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}
