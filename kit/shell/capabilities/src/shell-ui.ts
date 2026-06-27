import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_STANDARD_SHELL_UI_COMMANDS = {
  confirmDialog: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
  startWindowDrag: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
  focusMainWindow: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
} as const;
