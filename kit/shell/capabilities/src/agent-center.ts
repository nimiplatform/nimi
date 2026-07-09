import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_AGENT_CENTER_SHELL_COMMANDS = Object.freeze({
  avatarAssetImport: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
  avatarAssetValidate: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'],
  avatarAssetResolvePreview: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'],
  live2dAdapterImport: NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'],
  backgroundImport: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
  backgroundGet: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
  backgroundValidate: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
  backgroundRemove: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove'],
  agentResourcesRemove: NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove'],
  accountResourcesRemove: NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'],
});
