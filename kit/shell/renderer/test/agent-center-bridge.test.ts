import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  BridgeError,
  createAgentCenterShellBridge,
  importAgentCenterBackground,
  importAgentCenterResourcePack,
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
  it('exposes identity-free material custody and the bounded public Zhiyu placement', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    const resourcePackBytes = Uint8Array.from([7, 8, 9]);

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
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport']) {
        return {
          role: 'resource-pack', fileName: 'technical-pack-a.nimipack', mediaType: 'application/vnd.nimi.resource-pack+zip',
          content: resourcePackBytes, sha256: 'c'.repeat(64),
          custodyRef: 'agent-center-import-custody:resource-pack',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackOpenZhiyu']) {
        return { status: 'ready', reasonCode: 'zhiyu-resource-pack-placement-ready' };
      }
      throw new Error(`unexpected command ${command}`);
    }, async () => {
      const bridge = createAgentCenterShellBridge();
      expect(Object.keys(bridge).sort()).toEqual([
        'openResourcePackInZhiyu',
        'pickAvatarAssetMaterial',
        'pickBackgroundAssetMaterial',
        'pickResourcePackMaterial',
      ]);
      await expect(bridge.pickAvatarAssetMaterial('vrm')).resolves.toMatchObject({
        role: 'avatar', backendKind: 'vrm', mediaType: 'model/gltf-binary',
      });
      await expect(bridge.pickBackgroundAssetMaterial()).resolves.toMatchObject({
        role: 'background', mediaType: 'image/png',
      });
      const resourcePack = await bridge.pickResourcePackMaterial();
      expect(resourcePack).toMatchObject({
        role: 'resource-pack',
        fileName: 'technical-pack-a.nimipack',
        mediaType: 'application/vnd.nimi.resource-pack+zip',
      });
      resourcePackBytes[0] = 255;
      expect(resourcePack?.content).toEqual(Uint8Array.from([7, 8, 9]));
      await expect(bridge.openResourcePackInZhiyu('conversation-anchor-1')).resolves.toEqual({
        status: 'ready',
        reasonCode: 'zhiyu-resource-pack-placement-ready',
      });
    });

    expect(calls).toEqual([
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
        payload: { payload: { backendKind: 'vrm' } },
      },
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
        payload: { payload: {} },
      },
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport'],
        payload: { payload: {} },
      },
      {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackOpenZhiyu'],
        payload: { payload: { conversationAnchorId: 'conversation-anchor-1' } },
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
    await expect(importAgentCenterResourcePack({
      sourcePath: 'fixtures/unregistered/example.nimipack',
    } as never)).rejects.toBeInstanceOf(BridgeError);
  });

  it('returns null without invoking an import when selection is canceled', async () => {
    const calls: string[] = [];
    await withElectronInvoke(async (command) => {
      calls.push(command);
      return null;
    }, async () => {
      await expect(createAgentCenterShellBridge().pickAvatarAssetMaterial('vrm')).resolves.toBeNull();
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
      await expect(createAgentCenterShellBridge().pickAvatarAssetMaterial('vrm')).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'renderer-standard-shell-result-invalid',
      });
    });
  });

  it('keeps the target-only Resource Pack picker out of global Tauri aliases', () => {
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']])
      .toBe('agent_center_avatar_asset_import');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']])
      .toBe('agent_center_background_import');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport']])
      .toBeUndefined();
  });
});
