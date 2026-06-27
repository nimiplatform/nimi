import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_AUTH_SHELL_COMMANDS = Object.freeze({
  sessionLoad: NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad'],
  sessionSave: NIMI_STANDARD_SHELL_COMMANDS['auth.sessionSave'],
  sessionClear: NIMI_STANDARD_SHELL_COMMANDS['auth.sessionClear'],
});
