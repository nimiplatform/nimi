import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  BridgeError,
  createAgentCenterShellBridge,
  importAgentCenterBackground,
} from '../src/bridge/index.js';
import { TAURI_STANDARD_COMMAND_ALIASES } from '../src/bridge/tauri-api.js';

type AgentCenterBridgeTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
};

async function withElectronInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as AgentCenterBridgeTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  try {
    return await run();
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
}

describe('renderer Agent Center Host mechanics bridge', () => {
  const handle = `agent_ref_${'a'.repeat(43)}`;
  it('exposes only handle-scoped selection and temporary material custody', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];

    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']) {
        return {
          role: 'avatar', fileName: 'avatar.vrm', mediaType: 'model/gltf-binary',
          content: Uint8Array.from([1, 2, 3]), sha256: 'a'.repeat(64),
          custodyRef: 'agent-center-import-custody:vrm', backendKind: 'vrm',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']) {
        return {
          role: 'background', fileName: 'background.png', mediaType: 'image/png',
          content: Uint8Array.from([4, 5, 6]), sha256: 'b'.repeat(64),
          custodyRef: 'agent-center-import-custody:background',
        };
      }
      throw new Error(`unexpected command ${command}`);
    }, async () => {
      const bridge = createAgentCenterShellBridge();
      expect(Object.keys(bridge).sort()).toEqual(['pickAvatarAssetMaterial', 'pickBackgroundAssetMaterial']);
      await expect(bridge.pickAvatarAssetMaterial('vrm', handle)).resolves.toMatchObject({
        role: 'avatar', backendKind: 'vrm', mediaType: 'model/gltf-binary',
      });
      await expect(bridge.pickBackgroundAssetMaterial()).resolves.toMatchObject({
        role: 'background', mediaType: 'image/png',
      });
    });

    expect(calls).toEqual([
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
        payload: { payload: { backendKind: 'vrm', agentHandle: handle } },
      },
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
        payload: { payload: {} },
      },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/sourcePath|accountId|ownerUserId|runtimeSourceRef|localAgentRef/u);
  });

  it('rejects renderer attempts to add a raw source path', async () => {
    const rejection = importAgentCenterBackground({ sourcePath: 'fixtures/unregistered/background.png' } as never);
    await expect(rejection).rejects.toBeInstanceOf(BridgeError);
    await expect(rejection).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-agent-center-payload-invalid',
      source: 'renderer',
    });
  });

  it('returns null without invoking an import when selection is canceled', async () => {
    const calls: string[] = [];
    await withElectronInvoke(async (command) => {
      calls.push(command);
      return null;
    }, async () => {
      await expect(createAgentCenterShellBridge().pickAvatarAssetMaterial('vrm', handle)).resolves.toBeNull();
    });
    expect(calls).toEqual([NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']]);
  });

  it('fails closed on expanded Host material results', async () => {
    await withElectronInvoke(async (command) => {
      void command;
      return {
        role: 'avatar', fileName: 'avatar.vrm', mediaType: 'model/gltf-binary',
        content: Uint8Array.from([1]), sha256: 'a'.repeat(64),
        custodyRef: 'custody:avatar', backendKind: 'vrm', localAgentRef: 'forbidden',
      };
    }, async () => {
      await expect(createAgentCenterShellBridge().pickAvatarAssetMaterial('vrm', handle)).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'renderer-standard-shell-result-invalid',
      });
    });
  });

  it('maps only the two Host material imports through Tauri aliases', () => {
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']])
      .toBe('agent_center_avatar_asset_import');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']])
      .toBe('agent_center_background_import');
  });
});
