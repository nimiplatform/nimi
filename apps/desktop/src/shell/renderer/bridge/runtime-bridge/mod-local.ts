import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseRuntimeLocalManifestSummaries,
  type RuntimeLocalManifestSummary,
} from './types';

export async function listRuntimeLocalModManifests(): Promise<RuntimeLocalManifestSummary[]> {
  if (!hasTauriInvoke()) {
    return [];
  }

  return invokeChecked('runtime_mod_list_local_manifests', {}, parseRuntimeLocalManifestSummaries);
}

export async function readRuntimeLocalModEntry(path: string): Promise<string> {
  if (!hasTauriInvoke()) {
    throw new Error('runtime_mod_read_local_entry requires Tauri runtime');
  }

  return invokeChecked('runtime_mod_read_local_entry', {
    payload: {
      path,
    },
  }, (result) => {
    if (typeof result !== 'string') {
      throw new Error('runtime_mod_read_local_entry returned non-string payload');
    }
    return result;
  });
}
