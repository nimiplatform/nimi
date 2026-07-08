import { AvatarDebugProbeKind } from '@nimiplatform/sdk/runtime/wire-types';
import type { BootstrapHandle } from './app-shell/app-bootstrap.js';
import type { AvatarActionRadialAction } from './action-radial/avatar-action-radial.js';
import type { AvatarAppearanceSourceAuthority } from './appearance-overlay/avatar-appearance-overlay.js';
import type { AppOriginEvent } from './driver/types.js';
import type { AvatarTransientComposerSendState } from './transient-composer/avatar-transient-composer.js';

export type AvatarContextMenuState = {
  x: number;
  y: number;
};

export type AvatarActionRadialState = {
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

export type AvatarDebugOverlayState = {
  x: number;
  y: number;
};

type LocalPresentationResult = {
  resolvedActivityName: string;
  intensity: number | null;
};

const RANDOM_LOCAL_ACTIVITY_IDS = ['greet', 'agree', 'disagree', 'thinking', 'excited'] as const;

export function localClickActivity(event: AppOriginEvent): LocalPresentationResult {
  return event.detail['region'] === 'face'
    ? { resolvedActivityName: 'greet', intensity: null }
    : { resolvedActivityName: 'happy', intensity: 0.35 };
}

export function radialActionActivity(action: AvatarActionRadialAction): LocalPresentationResult | null {
  switch (action) {
    case 'greet':
      return { resolvedActivityName: 'greet', intensity: null };
    case 'look_at_me':
      return { resolvedActivityName: 'focused', intensity: 0.55 };
    case 'happy':
      return { resolvedActivityName: 'happy', intensity: 0.8 };
    case 'quiet':
      return { resolvedActivityName: 'idle', intensity: 0.35 };
    case 'random_motion': {
      const index = Math.floor(Math.random() * RANDOM_LOCAL_ACTIVITY_IDS.length);
      return {
        resolvedActivityName: RANDOM_LOCAL_ACTIVITY_IDS[index] ?? 'greet',
        intensity: null,
      };
    }
    case 'open_text_input':
      return null;
  }
}

export function avatarDebugProbeKindId(probeKind: AvatarDebugProbeKind): string {
  switch (probeKind) {
    case AvatarDebugProbeKind.BACKEND_LOAD:
      return 'backend_load';
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
      return 'capability_profile';
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
      return 'route_support_matrix';
    case AvatarDebugProbeKind.GENERATED_MOTION:
      return 'generated_motion';
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
      return 'emotion_expression';
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
      return 'speech_lipsync';
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      return 'window_hit_region';
    default:
      return 'unknown';
  }
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
