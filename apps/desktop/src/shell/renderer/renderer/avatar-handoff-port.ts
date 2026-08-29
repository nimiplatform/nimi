import type {
  DesktopAvatarPreviewProjectionInput,
  DesktopAvatarPreviewProjectionResult,
} from '../bridge/runtime-bridge/chat-agent-avatar-preview-projection.js';

export interface DesktopRendererAvatarHandoffPort {
  available(): boolean;
  preview?: (
    input: DesktopAvatarPreviewProjectionInput,
  ) => Promise<DesktopAvatarPreviewProjectionResult>;
  launch(input: {
    readonly agentHandle: string;
    readonly conversationAnchorId?: string | null;
    readonly avatarInstanceId: string;
    readonly launchSource: string;
  }): Promise<{ readonly opened: boolean }>;
}

export function createUnavailableDesktopRendererAvatarHandoffPort(
  reason = 'DESKTOP_RENDERER_AVATAR_HANDOFF_UNAVAILABLE',
): DesktopRendererAvatarHandoffPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return Object.freeze({
    available: () => false,
    launch: unavailable,
  });
}
