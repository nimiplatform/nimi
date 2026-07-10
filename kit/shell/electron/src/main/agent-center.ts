import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createElectronCapabilityUnavailableError } from './errors.js';
import {
  importAvatarAsset,
  importLive2dAdapterManifest,
  resolveAvatarAssetPreview,
  validateAvatarAsset,
} from './agent-center-avatar.js';
import {
  getBackground,
  importBackground,
  removeBackground,
  validateBackground,
} from './agent-center-background.js';
import { parseElectronAgentCenterPayload, type AgentCenterDispatchCommand } from './agent-center-contract.js';
import { removeAccountResources, removeAgentResources } from './agent-center-resources.js';
import type { NimiElectronStandardShellHost } from './types.js';

type AgentCenterDispatchHandler = (
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) => Promise<unknown>;

const AGENT_CENTER_DISPATCH = {
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']]: importAvatarAsset,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate']]: validateAvatarAsset,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview']]: resolveAvatarAssetPreview,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport']]: importLive2dAdapterManifest,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']]: importBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet']]: getBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate']]: validateBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove']]: removeBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove']]: removeAgentResources,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']]: removeAccountResources,
} as const satisfies Readonly<Record<AgentCenterDispatchCommand, AgentCenterDispatchHandler>>;

export async function dispatchElectronAgentCenterCommand(input: {
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
}): Promise<unknown> {
  const { command, host, payload } = input;
  if (isElectronAgentCenterCommand(command)) {
    const handler = AGENT_CENTER_DISPATCH[command];
    return handler(host, parseElectronAgentCenterPayload(command, payload), command);
  }
  throw createElectronCapabilityUnavailableError(command);
}

export function isElectronAgentCenterCommand(command: string): command is AgentCenterDispatchCommand {
  return Object.hasOwn(AGENT_CENTER_DISPATCH, command);
}
