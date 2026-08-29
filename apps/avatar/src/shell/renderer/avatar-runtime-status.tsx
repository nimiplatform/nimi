import type { AudioPlaybackSnapshot } from '@nimiplatform/kit/features/avatar/headless';
import {
  VISUALLY_HIDDEN_CLASS_NAME,
  VISUALLY_HIDDEN_STYLE,
} from '@nimiplatform/kit/ui/a11y';
import type { CSSProperties } from 'react';
import { useTranslation } from './i18n/index.js';

export type AvatarRuntimeStatus =
  | 'loading'
  | 'ready'
  | 'speaking'
  | 'voice_failed'
  | 'lipsync_silent'
  | 'unavailable';

export function deriveAvatarRuntimeStatus(input: {
  compositionReady: boolean;
  compositionState: string;
  audio: AudioPlaybackSnapshot;
}): AvatarRuntimeStatus {
  if (!input.compositionReady) {
    return input.compositionState === 'loading' || input.compositionState === 'relaunch_pending'
      ? 'loading'
      : 'unavailable';
  }
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
