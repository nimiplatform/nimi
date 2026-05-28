import { hasTauriInvoke as hasTauriRuntimeInvoke, invokeTauri } from '../tauri-api';

export function hasTauriInvoke() {
  return hasTauriRuntimeInvoke();
}

export async function tauriInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  if (!hasTauriRuntimeInvoke()) {
    throw new Error(`Tauri invoke unavailable for command: ${command}`);
  }
  return await invokeTauri<T>(command, payload);
}
