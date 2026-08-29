import {
  createAgentCenterShellHostMechanics,
  type AgentCenterHostCommittedPreviewInput,
  type AgentCenterHostMechanics,
  type AgentCenterShellAppearanceBridge,
} from '@nimiplatform/kit/features/agent-center';
import type { DesktopRendererAvatarHandoffPort } from '../../renderer/avatar-handoff-port.js';

/**
 * Binds native placement to the exact canonical Conversation anchor. Selection and
 * preview remain Host mechanics; the shared Manager owns every product commit.
 */
export function createDesktopAgentCenterHostMechanics(input: {
  readonly conversationAnchorId?: string | null;
  readonly shell: AgentCenterShellAppearanceBridge;
  readonly avatarHandoff: DesktopRendererAvatarHandoffPort;
}): AgentCenterHostMechanics {
  const selection = createAgentCenterShellHostMechanics({
    pickAvatarAssetMaterial: (kind) => input.shell.pickAvatarAssetMaterial(kind),
    ...(input.shell.pickBackgroundAssetMaterial ? {
      pickBackgroundAssetMaterial: () => input.shell.pickBackgroundAssetMaterial!(),
    } : {}),
  });
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
