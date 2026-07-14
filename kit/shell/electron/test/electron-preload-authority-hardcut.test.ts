import { describe, expect, it } from 'vitest';

import { installNimiElectronRuntimeBridge } from '../src/preload/index.js';

describe('Electron preload protected-authority hardcut', () => {
  it('exposes only invoke/listen and no protected local-app material', () => {
    let exposed: unknown;
    installNimiElectronRuntimeBridge({
      contextBridge: { exposeInMainWorld: (_key, value) => { exposed = value; } },
      ipcRenderer: { invoke: async () => ({ ok: true, value: null }), on: () => {}, removeListener: () => {} },
    });
    expect(Object.keys(exposed as object).sort()).toEqual(['invoke', 'listen']);
    expect(JSON.stringify(exposed)).not.toMatch(/endpoint|token|principal|record|grant|session|proof|trust/i);
  });
});
