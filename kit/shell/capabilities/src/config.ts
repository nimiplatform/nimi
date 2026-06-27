import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_CONFIG_SHELL_COMMANDS = Object.freeze({
  get: NIMI_STANDARD_SHELL_COMMANDS['config.get'],
  set: NIMI_STANDARD_SHELL_COMMANDS['config.set'],
});
