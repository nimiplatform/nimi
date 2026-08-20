import { invoke, toShellBridgeNimiError, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

export async function invokeLabCommand<T>(command: string, args?: JsonObject): Promise<T> {
  try {
    return await invoke(command, args || {}) as T;
  } catch (error) {
    throw toShellBridgeNimiError(error);
  }
}
