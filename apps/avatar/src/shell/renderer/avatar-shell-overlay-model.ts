import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AvatarAppearanceSourceAuthority } from './appearance-overlay/avatar-appearance-overlay.js';
import type { AppOriginEvent } from './driver/types.js';
import type { AvatarTransientComposerSendState } from './transient-composer/avatar-transient-composer.js';

export type AvatarContextMenuState = {
  x: number;
  y: number;
};

export type AvatarTransientComposerState = {
  x: number;
  y: number;
  draft: string;
  sendState: AvatarTransientComposerSendState;
  sendError: string | null;
};

export type AvatarSettingsOverlayState = {
  x: number;
  y: number;
};

export type AvatarAppearanceOverlayState = {
  x: number;
  y: number;
};

type LocalPresentationResult = {
  resolvedActivityName: string;
  intensity: number | null;
};

export function localClickActivity(_event: AppOriginEvent): LocalPresentationResult {
  return { resolvedActivityName: 'focused', intensity: 0.25 };
}

export function appearanceSourceAuthority(value: string | null): AvatarAppearanceSourceAuthority {
  if (value === 'runtime' || value === 'fixture') return value;
  return 'unknown';
}

export function applyLocalPresentation(
  bootstrapHandle: BootstrapHandle | null,
  result: LocalPresentationResult | null,
): void {
  if (!result) return;
  bootstrapHandle?.carrier?.backend?.projection.applyActivity({
    name: result.resolvedActivityName,
    intensity: result.intensity,
  });
}
