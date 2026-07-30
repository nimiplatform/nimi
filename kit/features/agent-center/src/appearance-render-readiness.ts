import { isAvatarControlledPreviewSurfaceRef } from '@nimiplatform/kit/features/avatar/headless';
import type { AgentCenterAppearanceProjection } from './types.js';

/** Client-side committed-effect readiness only; never Runtime commit authority. */
export function isAgentCenterCommittedAppearanceReady(
  appearance: AgentCenterAppearanceProjection,
): boolean {
  return Boolean(
    appearance.avatarAssetRef
    && appearance.renderState === 'ready'
    && appearance.renderTier === 'avatar_preview_service'
    && appearance.renderImageRef
    && isAvatarControlledPreviewSurfaceRef(appearance.renderImageRef)
    && typeof appearance.renderVisiblePixels === 'number'
    && Number.isFinite(appearance.renderVisiblePixels)
    && appearance.renderVisiblePixels > 0,
  );
}
