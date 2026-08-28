import type {
  DesktopAvatarPreviewProjectionInput,
  DesktopAvatarPreviewProjectionResult,
} from '../bridge/runtime-bridge/chat-agent-avatar-preview-projection.js';

export type DesktopAvatarLiveInstance = {
  readonly avatarInstanceId: string;
  readonly agentHandle: string;
  readonly launchSource: string | null;
};

export interface DesktopRendererAvatarHandoffPort {
  available(): boolean;
  list(agentHandle: string): Promise<DesktopAvatarLiveInstance[]>;
  preview?: (
    input: DesktopAvatarPreviewProjectionInput,
  ) => Promise<DesktopAvatarPreviewProjectionResult>;
  launch(input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly avatarInstanceId: string;
    readonly launchSource: string;
  }): Promise<{ readonly opened: boolean }>;
  close(input: {
    readonly avatarInstanceId: string;
    readonly closedBy?: string;
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
    list: unavailable,
    launch: unavailable,
    close: unavailable,
  });
}
