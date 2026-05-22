import type { PlatformClient } from '@nimiplatform/sdk';
import { getStudioPlatformClient } from '@renderer/app-shell/studio-platform.js';
export { hasTauriIpcRuntime } from '@renderer/app-shell/tauri-runtime.js';

export async function createStudioRuntimeClient(): Promise<PlatformClient['runtime'] | null> {
  try {
    return getStudioPlatformClient().runtime;
  } catch {
    return null;
  }
}
