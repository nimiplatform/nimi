import { describe, expect, it, vi } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from '../src/main/host.js';
import * as desktopControl from '../src/main/desktop-control-host.js';
import { ResolveDesktopAgentReferenceResponse, OpenLocalAppConversationResponse } from '../../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge } from './electron-shell-test-utils.js';

describe('Home formal owners after an interrupted quit', () => {
  it('restores named Agent resolution and conversation entry without reviving old resource scopes', async () => {
    const reference = { agentHandle: `agent_ref_${'a'.repeat(43)}`, agentBinding: `agent_binding_${'b'.repeat(43)}`, activityAgentRef: 'agr_partner', displayName: 'Partner' };
    const unary = vi.fn(async ({ methodId }: { methodId: string }) => {
      if (methodId.endsWith('/ResolveDesktopAgentReference')) return ResolveDesktopAgentReferenceResponse.toBinary({ reference });
      if (methodId.endsWith('/OpenLocalAppConversation')) return OpenLocalAppConversationResponse.toBinary({ conversationAnchorId: 'anchor-1' });
      throw new Error(`Unexpected method ${methodId}`);
    });
    const factory = vi.spyOn(desktopControl, 'createNimiElectronDesktopControlHost').mockReturnValue({
      accountProductUnary: unary, bundledAvatarUnary: unary,
    } as unknown as desktopControl.NimiElectronDesktopControlHost);
    const ipcMain = new FakeIpcMain();
    const { event } = createInvokeEvent();
    const bridge = registerNimiElectronRuntimeBridge({
      appId: 'nimi.desktop', runtimeEndpoint: 'protected-desktop-control',
      allowedOrigins: ['http://localhost:1430'], ipcMain,
      standardShellHost: { allowAllStandardShellCommands: true },
      desktopHost: { authorizeSender: candidate => candidate === event, subscribeSenderInvalidation: () => () => {} },
      bundledAvatarHost: {
        rendererUrl: 'http://localhost:1427/', authorizeSender: () => false,
        subscribeSenderInvalidation: () => () => {},
        standardShellHost: { allowAllStandardShellCommands: true },
      },
    });
    const resolve = () => bridge.resolveDesktopAgentReference!({ localAgentRef: 'partner' });
    const openConversation = () => invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationOpen'], payload: { payload: { agentHandle: reference.agentHandle } },
    });
    const oldAvatar = bridge.bundledAvatarLocalAppHost!;
    try {
      expect(await bridge.restoreFormalAppResources!()).toBe(false);
      await expect(resolve()).resolves.toEqual({ reference });
      await bridge.disposeFormalAppResources!();
      // Reproduce the reported symptom: Runtime is healthy but the surviving
      // Home bridge still points at an owner permanently closed during quit.
      await expect(resolve()).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
      expect(await bridge.restoreFormalAppResources!()).toBe(true);
      await expect(resolve()).resolves.toEqual({ reference });
      await expect(openConversation()).resolves.toMatchObject({ conversationAnchorId: 'anchor-1' });
      expect(bridge.bundledAvatarLocalAppHost).not.toBe(oldAvatar);
      await expect(oldAvatar.assetWriteOpen({ relativePath: 'old.txt' })).rejects.toMatchObject({ reasonCode: 'runtime-service-unavailable' });
      const fresh = await bridge.bundledAvatarLocalAppHost!.assetWriteOpen({ relativePath: 'fresh.txt' });
      await bridge.bundledAvatarLocalAppHost!.assetWriteAbort({ streamId: fresh.streamId });
      expect(await bridge.restoreFormalAppResources!()).toBe(false);
      await bridge.disposeFormalAppResources!();
      bridge.unregister();
      await expect(bridge.restoreFormalAppResources!()).rejects.toThrow('runtime-bridge-unregistered');
    } finally {
      bridge.unregister();
      factory.mockRestore();
    }
  });
});
