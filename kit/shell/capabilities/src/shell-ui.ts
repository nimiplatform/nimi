import { NIMI_STANDARD_SHELL_COMMANDS } from './commands.js';

export const NIMI_STANDARD_SHELL_UI_COMMANDS = {
  confirmDialog: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
  startWindowDrag: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
  focusMainWindow: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
  chromeBind: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.chromeBind'],
  chromeStateSet: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.chromeStateSet'],
  chromeCommand: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.chromeCommand'],
  chromeUnbind: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.chromeUnbind'],
} as const;
