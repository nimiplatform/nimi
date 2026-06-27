import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_LOCAL_AGENT_SHELL_COMMANDS = Object.freeze({
  identity: NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity'],
  runtimeTrustedCaller: NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller'],
});
