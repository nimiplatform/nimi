import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { RuntimeOptions } from '@nimiplatform/sdk/runtime';

export type NimiAppRuntimeHostKind = 'node' | 'electron' | 'tauri';

const RUNTIME_BRIDGE_NAMESPACE = 'runtime_bridge';

export function resolveNimiAppRuntimeHostKind(): NimiAppRuntimeHostKind {
  if (isNodeRuntime()) {
    return 'node';
  }
  return hasElectronRuntime() ? 'electron' : 'tauri';
}

export function createNimiAppRuntimeTransportConfig(): RuntimeOptions['transport'] | undefined {
  const hostKind = resolveNimiAppRuntimeHostKind();
  if (hostKind === 'node') {
    return undefined;
  }
  if (hostKind === 'electron') {
    return {
      type: 'electron-ipc',
    };
  }
  return {
    type: 'tauri-ipc',
    commandNamespace: RUNTIME_BRIDGE_NAMESPACE,
    eventNamespace: RUNTIME_BRIDGE_NAMESPACE,
  };
}

function isNodeRuntime(): boolean {
  if (typeof window !== 'undefined') {
    return false;
  }
  const maybeProcess = (globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } };
  }).process;
  return Boolean(maybeProcess?.versions?.node);
}
