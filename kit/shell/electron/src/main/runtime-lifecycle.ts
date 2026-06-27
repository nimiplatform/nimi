import type { ElectronRuntimeBridgeCommandNames } from './types.js';

export function isElectronExternallyManagedRuntimeCommand(
  command: string,
  commandNames: ElectronRuntimeBridgeCommandNames,
): boolean {
  return command === commandNames.start
    || command === commandNames.stop
    || command === commandNames.restart
    || command === commandNames.config_set;
}
