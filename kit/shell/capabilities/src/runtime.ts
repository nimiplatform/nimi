import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_RUNTIME_SHELL_COMMANDS = Object.freeze({
  unary: NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'],
  streamOpen: NIMI_STANDARD_SHELL_COMMANDS['runtime.streamOpen'],
  streamClose: NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose'],
});
