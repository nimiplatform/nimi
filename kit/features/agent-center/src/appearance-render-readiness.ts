import { isAvatarControlledPreviewSurfaceRef } from '@nimiplatform/kit/features/avatar/headless';
import type { AgentCenterAppearanceProjection } from './types.js';

/** Runtime-committed appearance configuration, independent of an embedded preview. */
export function isAgentCenterAppearanceConfigured(
  appearance: AgentCenterAppearanceProjection,
): boolean {
  return Boolean(
    appearance.avatarAssetRef
    && (appearance.backendKind === 'live2d' || appearance.backendKind === 'vrm')
    && appearance.avatarAssetValid !== false
    && appearance.status !== 'invalid',
  );
}

/** Client-side committed-effect readiness only; never Runtime commit authority. */
export function isAgentCenterCommittedAppearanceReady(
  appearance: AgentCenterAppearanceProjection,
): boolean {
  return Boolean(
    appearance.avatarAssetRef
    && appearance.renderState === 'ready'
    && appearance.renderTier === 'avatar_preview_service'
    && appearance.renderImageRef
    && isAvatarControlledPreviewSurfaceRef(appearance.renderImageRef),
  );
}
