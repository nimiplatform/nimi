import {
  createAgentCenterShellHostMechanics,
  type AgentCenterHostCommittedPreviewInput,
  type AgentCenterHostMechanics,
} from '@nimiplatform/kit/features/agent-center';
import type { AgentCenterShellBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import type { DesktopRendererAvatarHandoffPort } from '../../renderer/avatar-handoff-port.js';

/**
 * Binds native placement to the exact canonical Conversation anchor. Selection and
 * preview remain Host mechanics; the shared Manager owns every product commit.
 */
export function createDesktopAgentCenterHostMechanics(input: {
  readonly conversationAnchorId?: string | null;
  readonly shell: AgentCenterShellBridge;
  readonly avatarHandoff: DesktopRendererAvatarHandoffPort;
}): AgentCenterHostMechanics {
  const selection = createAgentCenterShellHostMechanics(input.shell);
  const preview = input.avatarHandoff.preview;
  return Object.freeze({
    ...selection,
    ...(preview && input.conversationAnchorId ? {
      async resolveCommittedPreview(committed: AgentCenterHostCommittedPreviewInput) {
        return preview({
          conversationAnchorId: input.conversationAnchorId!,
          avatarAssetRef: committed.avatarAssetRef,
          backendKind: committed.backendKind,
          presentationRevision: committed.presentationRevision,
        });
      },
    } : {}),
  });
}
