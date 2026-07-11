import { describe, expect, it } from 'vitest';

import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';

describe('Electron preload installed launch binding hardcut', () => {
  it('does not expose argv-supplied installed launch authority to the renderer', () => {
    const originalArgv = [...process.argv];
    const binding = Buffer.from(JSON.stringify({
      appId: 'community.nimi.fixture',
      appInstanceId: 'forged.instance',
      deviceId: 'forged.device',
      launchHostId: 'forged.host',
      launchNonce: 'forged.nonce',
      releaseDescriptorRef: 'forged.release',
      realmBaseUrl: 'https://forged.realm.example',
    })).toString('base64url');
    process.argv.push(`--nimi-installed-app-launch-binding=${binding}`);

    let exposed: unknown;
    try {
      installNimiElectronRuntimeBridge({
        contextBridge: {
          exposeInMainWorld: (_apiKey, value) => {
            exposed = value;
          },
        },
        ipcRenderer: {
          invoke: async () => ({ ok: true, value: null }),
          on: () => {},
          removeListener: () => {},
        },
      });
    } finally {
      process.argv.splice(0, process.argv.length, ...originalArgv);
    }

    expect(exposed).not.toHaveProperty('installedAppLaunchBinding');
  });
});
