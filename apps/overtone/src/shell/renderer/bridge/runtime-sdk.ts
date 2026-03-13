import { Runtime } from '@nimiplatform/sdk/runtime';

let instance: Runtime | null = null;

export function getRuntimeInstance(): Runtime {
  if (!instance) {
    instance = new Runtime({
      appId: 'nimi.overtone',
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
      defaults: {
        callerKind: 'third-party-app',
        callerId: 'app:nimi.overtone',
        surfaceId: 'overtone.studio',
      },
    });
  }
  return instance;
}
