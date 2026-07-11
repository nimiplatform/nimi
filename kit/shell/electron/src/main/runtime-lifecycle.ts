import type { ElectronRuntimeBridgeCommandNames } from './types.js';

export function isElectronExternallyManagedRuntimeCommand(
  command: string,
  commandNames: ElectronRuntimeBridgeCommandNames,
): boolean {
  return command === commandNames.start
    || command === commandNames.restart;
}
