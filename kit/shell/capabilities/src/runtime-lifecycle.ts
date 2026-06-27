import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_RUNTIME_LIFECYCLE_SHELL_COMMANDS = Object.freeze({
  status: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
  start: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start'],
  stop: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.stop'],
  restart: NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
});
