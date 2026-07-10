const RETIRED_ELECTRON_AUTH_SESSION_COMMAND_SET: ReadonlySet<string> = new Set([
  'nimi.shell.auth.session.load',
  'nimi.shell.auth.session.save',
  'nimi.shell.auth.session.clear',
]);

export function isElectronRuntimeAccountCustodyCommand(command: string): boolean {
  return RETIRED_ELECTRON_AUTH_SESSION_COMMAND_SET.has(command);
}
