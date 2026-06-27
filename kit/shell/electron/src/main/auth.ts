import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const ELECTRON_RUNTIME_ACCOUNT_CUSTODY_COMMAND_SET: ReadonlySet<string> = new Set([
  NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad'],
  NIMI_STANDARD_SHELL_COMMANDS['auth.sessionSave'],
  NIMI_STANDARD_SHELL_COMMANDS['auth.sessionClear'],
]);

export function isElectronRuntimeAccountCustodyCommand(command: string): boolean {
  return ELECTRON_RUNTIME_ACCOUNT_CUSTODY_COMMAND_SET.has(command);
}
