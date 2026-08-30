import type { AudioPlaybackSnapshot } from '@nimiplatform/kit/features/avatar/headless';
import {
  VISUALLY_HIDDEN_CLASS_NAME,
  VISUALLY_HIDDEN_STYLE,
} from '@nimiplatform/kit/ui/a11y';
import type { CSSProperties } from 'react';
import { useTranslation } from './i18n/index.js';
import type { BackendPresentationState } from './carrier/backend-branch.js';
import type { DriverAuthority } from './app-shell/app-store.js';

export type AvatarRuntimeStatus =
  | 'loading'
  | 'recovering'
  | 'ready'
  | 'not_verified'
  | 'speaking'
  | 'voice_failed'
  | 'lipsync_silent'
  | 'unavailable';

export function deriveAvatarRuntimeStatus(input: {
  compositionReady: boolean;
  compositionState: string;
  consumeAuthority: DriverAuthority | null;
  presentationState?: BackendPresentationState['kind'];
  audio: AudioPlaybackSnapshot;
}): AvatarRuntimeStatus {
  if (input.consumeAuthority === 'fixture') return 'not_verified';
  if (!input.compositionReady) {
    return input.compositionState === 'loading'
      ? 'loading'
      : 'unavailable';
  }
  const presentationState = input.presentationState ?? 'ready';
  if (presentationState === 'unavailable') return 'unavailable';
  if (presentationState === 'recovering') return 'recovering';
  if (presentationState !== 'ready') return 'loading';
  if (input.audio.state === 'failed') return 'voice_failed';
  if (input.audio.state === 'started' && input.audio.reason === 'lipsync_sink_failed') {
    return 'lipsync_silent';
  }
  if (input.audio.state === 'started') return 'speaking';
  return 'ready';
}

export function AvatarRuntimeStatusRegion(props: { status: AvatarRuntimeStatus }) {
  const { t } = useTranslation();
  const label = t(`Avatar.runtime_status.${props.status}`);
  return (
    <output
      className={[
        'avatar-runtime-status',
        `avatar-runtime-status--${props.status}`,
        props.status === 'ready' ? VISUALLY_HIDDEN_CLASS_NAME : '',
      ].filter(Boolean).join(' ')}
      data-testid="avatar-runtime-status"
      data-avatar-status={props.status}
      aria-live="polite"
      aria-atomic="true"
      style={props.status === 'ready' ? VISUALLY_HIDDEN_STYLE as CSSProperties : undefined}
    >
      <span className="avatar-runtime-status__indicator" aria-hidden="true" />
      <span>{label}</span>
    </output>
  );
}
