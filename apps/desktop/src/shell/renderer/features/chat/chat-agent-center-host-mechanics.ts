import {
  createAgentCenterShellHostMechanics,
  type AgentCenterHostCommittedPreviewInput,
  type AgentCenterHostMechanics,
} from '@nimiplatform/kit/features/agent-center';
import type { AgentCenterShellBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import type { DesktopRendererAvatarHandoffPort } from '../../renderer/avatar-handoff-port.js';

/**
 * Binds native placement to the current canonical Agent handle. Selection and
 * preview remain Host mechanics; the shared Manager owns every product commit.
 */
export function createDesktopAgentCenterHostMechanics(input: {
  readonly agentHandle: string;
  readonly shell: AgentCenterShellBridge;
  readonly avatarHandoff: DesktopRendererAvatarHandoffPort;
}): AgentCenterHostMechanics {
  const selection = createAgentCenterShellHostMechanics(input.shell);
  const preview = input.avatarHandoff.preview;
  return Object.freeze({
    ...selection,
    ...(preview ? {
      async resolveCommittedPreview(committed: AgentCenterHostCommittedPreviewInput) {
        return preview({
          agentHandle: input.agentHandle,
          avatarAssetRef: committed.avatarAssetRef,
          backendKind: committed.backendKind,
          presentationRevision: committed.presentationRevision,
        });
      },
    } : {}),
  });
}
