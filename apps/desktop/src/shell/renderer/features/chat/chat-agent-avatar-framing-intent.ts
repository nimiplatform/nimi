import type { AvatarLive2dFramingIntent } from '@nimiplatform/kit/features/avatar/live2d';
import type { AvatarVrmFramingIntent } from '@nimiplatform/kit/features/avatar/vrm';

export type ChatAgentAvatarFramingIntent = 'conversation' | 'companion' | 'full-body';

export function resolveChatAgentAvatarVrmFramingIntent(
  intent: ChatAgentAvatarFramingIntent,
): AvatarVrmFramingIntent {
  switch (intent) {
    case 'companion':
      return 'bottom-companion';
    case 'full-body':
      return 'full-body';
    case 'conversation':
    default:
      return 'head-shoulders';
  }
}

export function resolveChatAgentAvatarLive2dFramingIntent(
  intent: ChatAgentAvatarFramingIntent,
): AvatarLive2dFramingIntent {
  switch (intent) {
    case 'companion':
      return 'bottom-companion';
    case 'full-body':
      return 'full-body';
    case 'conversation':
    default:
      return 'head-shoulders';
  }
}
