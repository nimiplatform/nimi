import { invoke, toShellBridgeNimiError } from '@nimiplatform/kit/shell/renderer/bridge';

export async function invokeTesterCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke(command, args || {}) as T;
  } catch (error) {
    throw toShellBridgeNimiError(error);
  }
}
