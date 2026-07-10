import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  BridgeError,
  clearAgentCenterRegisteredDialogPathsForTest,
  createAgentCenterShellBridge,
  importAgentCenterBackground,
  removeAgentCenterAccountResources,
  resolveAgentCenterAvatarAssetPreview,
  validateAgentCenterAvatarAsset,
} from '../src/bridge/index.js';
import { TAURI_STANDARD_COMMAND_ALIASES } from '../src/bridge/tauri-api.js';

type AgentCenterBridgeTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: (eventName: string, handler: (event: { payload: unknown }) => void) => () => void;
  };
  __NIMI_TAURI_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: () => () => void;
  };
};

const localAgentScope = {
  hostScope: 'local-agent' as const,
  accountId: 'account-1',
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'runtime-source:local',
  localAgentRef: 'local-agent:ren',
};

const accountScope = {
  hostScope: 'account' as const,
  accountId: 'account-1',
};

async function withElectronInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as AgentCenterBridgeTestGlobal;
  const previous = root.__NIMI_ELECTRON_TEST__;
  root.__NIMI_ELECTRON_TEST__ = { invoke, listen: () => () => undefined };
  clearAgentCenterRegisteredDialogPathsForTest();
  try {
    return await run();
  } finally {
    clearAgentCenterRegisteredDialogPathsForTest();
    root.__NIMI_ELECTRON_TEST__ = previous;
  }
}

async function withTauriInvoke<T>(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const root = globalThis as AgentCenterBridgeTestGlobal;
  const previous = root.__NIMI_TAURI_TEST__;
  root.__NIMI_TAURI_TEST__ = { invoke, listen: () => () => undefined };
  try {
    return await run();
  } finally {
    root.__NIMI_TAURI_TEST__ = previous;
  }
}

describe('renderer Agent Center shell bridge', () => {
  it('wraps every standard Agent Center command and sources import paths from file-dialog.open', async () => {
    const calls: Array<{ readonly command: string; readonly payload: unknown }> = [];
    const selectedPaths = [
      'fixtures/picked/live2d',
      'fixtures/picked/avatar.vrm',
      'fixtures/picked/adapter.json',
      'fixtures/picked/background.png',
    ];

    await withElectronInvoke(async (command, payload) => {
      calls.push({ command, payload });
      if (command === NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']) {
        return { canceled: false, paths: [selectedPaths.shift()] };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']) {
        const record = payload as { payload?: { backendKind?: string } };
        return {
          avatarAssetRef: `agent-center-avatar:agent-1/${record.payload?.backendKind}`,
          backendKind: record.payload?.backendKind,
          validationStatus: 'valid',
          backendCapabilityProfileRef: 'avatar-backend-profile:live2d-v1',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate']) {
        return {
          avatarAssetRef: 'agent-center-avatar:agent-1/live2d',
          backendKind: 'live2d',
          validationStatus: 'valid',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview']) {
        return {
          avatarAssetRef: 'agent-center-avatar:agent-1/live2d',
          backendKind: 'live2d',
          previewArtifactRef: 'agent-center-preview:agent-1/live2d',
          previewImageRef: 'agent-center-preview-image:agent-1/live2d',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport']) {
        return {
          avatarAssetRef: 'agent-center-avatar:agent-1/live2d',
          live2dAdapterManifestRef: 'agent-center-sidecar:agent-1/adapter',
          live2dAdapterManifestSource: 'external_sidecar_manifest',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']) {
        return {
          backgroundAssetRef: 'agent-center-background:account-1/background',
          validationStatus: 'valid',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet']) {
        return {
          backgroundAssetRef: 'agent-center-background:account-1/background',
          url: 'nimi-shell-file://agent-center/background',
          mimeType: 'image/png',
        };
      }
      if (command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate']) {
        return {
          backgroundAssetRef: 'agent-center-background:account-1/background',
          validationStatus: 'valid',
        };
      }
      if (
        command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove']
        || command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove']
        || command === NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']
      ) {
        return { removed: true };
      }
      throw new Error(`unexpected command ${command}`);
    }, async () => {
      const bridge = createAgentCenterShellBridge();
      await expect(bridge.importLive2dAvatarAsset(localAgentScope)).resolves.toMatchObject({
        avatarAssetRef: 'agent-center-avatar:agent-1/live2d',
      });
      await expect(bridge.importVrmAvatarAsset(localAgentScope)).resolves.toMatchObject({
        avatarAssetRef: 'agent-center-avatar:agent-1/vrm',
      });
      await expect(bridge.validateAvatarAsset({ ...localAgentScope, avatarAssetRef: 'live2d_111111111111' })).resolves.toMatchObject({
        validationStatus: 'valid',
      });
      await expect(bridge.resolveAvatarAssetPreview({ ...localAgentScope, avatarAssetRef: 'live2d_111111111111' })).resolves.toMatchObject({
        previewArtifactRef: 'agent-center-preview:agent-1/live2d',
      });
      await expect(bridge.importLive2dAdapterManifest({ ...localAgentScope, avatarAssetRef: 'live2d_111111111111' })).resolves.toMatchObject({
        live2dAdapterManifestRef: 'agent-center-sidecar:agent-1/adapter',
      });
      await expect(bridge.importBackground(localAgentScope)).resolves.toMatchObject({
        backgroundAssetRef: 'agent-center-background:account-1/background',
      });
      await expect(bridge.getBackground({ ...localAgentScope, backgroundAssetRef: 'bg_111111111111' })).resolves.toMatchObject({
        url: 'nimi-shell-file://agent-center/background',
      });
      await expect(bridge.validateBackground({ ...localAgentScope, backgroundAssetRef: 'bg_111111111111' })).resolves.toMatchObject({
        validationStatus: 'valid',
      });
      await expect(bridge.removeBackground({ ...localAgentScope, backgroundAssetRef: 'bg_111111111111' })).resolves.toEqual({ removed: true });
      await expect(bridge.removeAgentResources(localAgentScope)).resolves.toEqual({ removed: true });
      await expect(bridge.removeAccountResources(accountScope)).resolves.toEqual({ removed: true });
    });

    expect(calls.map((call) => call.command).filter((command) => command !== NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'])).toEqual([
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove'],
      NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'],
    ]);
    const agentCenterCalls = calls.filter((call) => call.command !== NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']);
    for (const call of agentCenterCalls.slice(0, -1)) {
      expect(call.payload).toMatchObject({ payload: localAgentScope });
    }
    expect(agentCenterCalls.at(-1)?.payload).toEqual({ payload: accountScope });
    expect(calls.some((call) => call.command.startsWith('agent_center_'))).toBe(false);
  });

  it('rejects import calls whose source path was not returned by file-dialog.open', async () => {
    const rejection = importAgentCenterBackground({
      ...localAgentScope,
      sourcePath: 'fixtures/unregistered/background.png',
    });
    await expect(rejection).rejects.toBeInstanceOf(BridgeError);
    await expect(rejection).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'renderer-agent-center-source-not-from-file-dialog',
      actionHint: 'select_agent_center_import_source_with_standard_file_dialog',
      source: 'renderer',
    });

    for (const malformed of [
      validateAgentCenterAvatarAsset(undefined as never),
      importAgentCenterBackground({ ...localAgentScope, sourcePath: 42 as never }),
    ]) {
      await expect(malformed).rejects.toBeInstanceOf(BridgeError);
      await expect(malformed).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'renderer-agent-center-payload-invalid',
        actionHint: 'provide_valid_agent_center_payload',
        source: 'renderer',
      });
    }
  });

  it('rejects unknown fields and non-canonical scope identifiers before host invocation', async () => {
    for (const createMalformed of [
      () => validateAgentCenterAvatarAsset({
        ...localAgentScope,
        avatarAssetRef: 'live2d_111111111111',
        displayName: 'retired renderer truth',
      } as never),
      () => importAgentCenterBackground({
        ...localAgentScope,
        sourcePath: 'fixtures/unregistered/background.png',
        select: true,
      } as never),
      () => removeAgentCenterAccountResources({
        ...accountScope,
        localAgentRef: 'local-agent:ren',
      } as never),
      () => validateAgentCenterAvatarAsset({
        ...localAgentScope,
        localAgentRef: 'ren',
        avatarAssetRef: 'live2d_111111111111',
      }),
      () => resolveAgentCenterAvatarAssetPreview({
        ...localAgentScope,
        avatarAssetRef: 'live2d_111111111111',
        backendKind: 'vrm',
      }),
    ]) {
      await expect(createMalformed()).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'renderer-agent-center-payload-invalid',
      });
    }
  });

  it('normalizes Tauri JSON-string envelopes and malformed host results into complete BridgeError envelopes', async () => {
    const tauriEnvelope = {
      code: 'not-found',
      reasonCode: 'tauri-agent-center-avatar-not-found',
      actionHint: 'reimport_agent_center_avatar',
      source: 'tauri',
    } as const;
    await withTauriInvoke(async () => {
      throw JSON.stringify(tauriEnvelope);
    }, async () => {
      const rejection = validateAgentCenterAvatarAsset({
        ...localAgentScope,
        avatarAssetRef: 'live2d_111111111111',
      });
      await expect(rejection).rejects.toBeInstanceOf(BridgeError);
      await expect(rejection).rejects.toMatchObject(tauriEnvelope);
    });

    await withElectronInvoke(async () => ({}), async () => {
      const rejection = validateAgentCenterAvatarAsset({
        ...localAgentScope,
        avatarAssetRef: 'live2d_111111111111',
      });
      await expect(rejection).rejects.toBeInstanceOf(BridgeError);
      await expect(rejection).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'renderer-standard-shell-result-invalid',
        actionHint: 'inspect_standard_shell_host_result',
        source: 'renderer',
      });
    });
  });

  it('does not expose config operations and maps Tauri aliases behind standard command names', () => {
    const bridge = createAgentCenterShellBridge() as unknown as Record<string, unknown>;
    expect(bridge.configGet).toBeUndefined();
    expect(bridge.configSet).toBeUndefined();
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']]).toBe('agent_center_avatar_asset_import');
    expect(TAURI_STANDARD_COMMAND_ALIASES[NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']]).toBe('agent_center_account_resources_remove');
  });
});
