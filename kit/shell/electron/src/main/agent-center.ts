import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { importAvatarAsset } from './agent-center-avatar.js';
import { importBackground } from './agent-center-background.js';
import { importResourcePack } from './agent-center-resource-pack.js';
import { parseElectronAgentCenterPayload, type AgentCenterDispatchCommand } from './agent-center-contract.js';
import {
  NimiElectronShellHostError,
  type NimiElectronShellUiCommandInput,
  type NimiElectronStandardShellHost,
} from './types.js';

type AgentCenterDispatchHandler = (
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
  input: NimiElectronShellUiCommandInput,
) => Promise<unknown>;

const AGENT_CENTER_DISPATCH = {
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']]: importAvatarAsset,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']]: importBackground,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport']]: importResourcePack,
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackOpenZhiyu']]: openResourcePackInZhiyu,
} as const satisfies Readonly<Record<AgentCenterDispatchCommand, AgentCenterDispatchHandler>>;

export async function dispatchElectronAgentCenterCommand(input: {
  readonly appId: string;
  readonly event: NimiElectronShellUiCommandInput['event'];
  readonly host: NimiElectronStandardShellHost | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly command: string;
  readonly runtimeEndpoint: string;
}): Promise<unknown> {
  const { command, host, payload } = input;
  if (isElectronAgentCenterCommand(command)) {
    if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport']
      && input.appId !== 'nimi.zhiyu') {
      throw new NimiElectronShellHostError({
        code: 'forbidden-renderer-access',
        message: 'Resource Pack file selection is available only from the exact Zhiyu host.',
        reasonCode: 'electron-agent-center-resource-pack-target-required',
        actionHint: 'open_resource_pack_picker_from_zhiyu',
        details: { appId: input.appId, command },
      });
    }
    const handler: AgentCenterDispatchHandler = AGENT_CENTER_DISPATCH[command];
    return handler(host, parseElectronAgentCenterPayload(command, payload), command, {
      command,
      event: input.event,
      appId: input.appId,
      runtimeEndpoint: input.runtimeEndpoint,
    });
  }
  throw createElectronCapabilityUnavailableError(command);
}

async function openResourcePackInZhiyu(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
  input: NimiElectronShellUiCommandInput,
): Promise<unknown> {
  if (!host?.agentCenterResourcePackPlacement) {
    throw new NimiElectronShellHostError({
      code: 'capability-unavailable',
      message: 'Agent Center Resource Pack placement is unavailable on this Host.',
      reasonCode: 'electron-agent-center-resource-pack-placement-unavailable',
      actionHint: 'retry_zhiyu_resource_pack_placement',
      details: { command },
    });
  }
  return host.agentCenterResourcePackPlacement({
    conversationAnchorId: String(payload.conversationAnchorId),
  }, input);
}

export function isElectronAgentCenterCommand(command: string): command is AgentCenterDispatchCommand {
  return Object.hasOwn(AGENT_CENTER_DISPATCH, command);
}
