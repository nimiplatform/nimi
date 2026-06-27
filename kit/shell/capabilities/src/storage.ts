import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_STORAGE_SHELL_COMMANDS = Object.freeze({
  readJson: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
  writeJson: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
});
