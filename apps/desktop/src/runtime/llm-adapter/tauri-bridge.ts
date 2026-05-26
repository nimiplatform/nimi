import { hasTauriInvoke as hasTauriRuntime, invokeTauri } from '../tauri-api';

export function hasTauriInvoke() {
  return hasTauriRuntime();
}

export async function tauriInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error(`Tauri invoke unavailable for command: ${command}`);
  }
  return await invokeTauri<T>(command, payload);
}
