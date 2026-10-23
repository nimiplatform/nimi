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
