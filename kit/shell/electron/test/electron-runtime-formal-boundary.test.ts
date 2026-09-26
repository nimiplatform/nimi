import { describe, expect, it, vi } from 'vitest';
import {
  GetAppAIConfigRequest,
  OverwriteAppAIConfigRequest,
  ListAppAIConfigOptionsRequest,
  InvokeRealmUnaryRequest,
} from '@nimiplatform/sdk/runtime/host';
import {
  createNimiElectronDesktopControlHostForBinding,
  type NimiElectronDesktopControlBinding,
} from '../src/main/desktop-control-host.js';
import { invokeElectronRuntimeUnary, openElectronRuntimeStream } from '../src/main/runtime.js';

function fixture(avatar = false) {
  const nativeUnary = vi.fn(async () => ({ status: 'ok' as const, value: new Uint8Array() }));
  const nativeOpen = vi.fn(async () => ({ status: 'ok' as const, value: { streamId: 'native-stream' } }));
  const nativeNext = vi.fn(async () => ({ status: 'ok' as const, completed: true as const }));
  const nativeClose = vi.fn(async () => ({ status: 'ok' as const, value: { closed: true } }));
  const release = vi.fn(async () => ({ status: 'ok' as const, value: { released: true } }));
  const binding = {
    desktopMachineProductUnary: nativeUnary, desktopAccountProductUnary: nativeUnary, desktopBundledAvatarUnary: nativeUnary,
    desktopAccountProductClientStream: nativeUnary, desktopBundledAvatarClientStream: nativeUnary,
    desktopFirstPartyProductUnaryCancel: release, desktopFirstPartyProductUnaryRelease: release,
    desktopMachineProductStreamOpen: nativeOpen, desktopAccountProductStreamOpen: nativeOpen, desktopBundledAvatarStreamOpen: nativeOpen,
    desktopFirstPartyProductStreamNext: nativeNext, desktopBundledAvatarStreamNext: nativeNext,
    desktopFirstPartyProductStreamClose: nativeClose, desktopBundledAvatarStreamClose: nativeClose,
  } as NimiElectronDesktopControlBinding;
  const desktopControlHost = createNimiElectronDesktopControlHostForBinding(binding);
  const common = {
    appId: avatar ? 'nimi.avatar' : 'nimi.desktop', event: {}, runtimeEndpoint: 'protected-desktop-control',
    desktopControlHost, desktopSenderAuthorized: !avatar, bundledAvatarProfile: avatar,
  };
  return {
    nativeUnary, nativeOpen, nativeNext, nativeClose, release,
    unary: (methodId: string, bytes = new Uint8Array()) => invokeElectronRuntimeUnary({
      ...common, command: 'runtime-unary', payload: { methodId, requestBytesBase64: Buffer.from(bytes).toString('base64') },
    }),
    stream: (methodId: string) => openElectronRuntimeStream({
      ...common, command: 'runtime-stream-open', desktopProtectedOnly: true, streams: new Map(),
      eventNamespace: 'test', eventChannelPrefix: 'test:',
      payload: { methodId, streamId: 'caller-stream', requestBytesBase64: '' },
    }),
    assertNoNative: () => {
      for (const call of [nativeUnary, nativeOpen, nativeNext, nativeClose, release]) expect(call).not.toHaveBeenCalled();
    },
  };
}

const formalUnaryMethods = [
  ...['ListIntegrationCatalog', 'ListIntegrationConnections', 'InvokeIntegrationCall', 'GetIntegrationCall',
    'ListIntegrationCalls', 'CancelIntegrationCall', 'RegisterIntegrationProvider', 'UnregisterIntegrationProvider',
    'PollIntegrationProvider', 'CompleteIntegrationProvider', 'GetIntegrationManagement', 'PutIntegrationConnection',
    'RemoveIntegrationConnection', 'SetIntegrationPermission'].map(name => `/nimi.runtime.v1.RuntimeIntegrationService/${name}`),
  ...['PutAppActivity', 'ListAppActivities', 'MarkAppActivityRead', 'CompleteAppActivityOpenRequest', 'ResolveAppActivityOpenLaunch']
    .map(name => `/nimi.runtime.v1.RuntimeAppActivityService/${name}`),
  ...['OpenVideoSession', 'SubmitVideoSessionFrame', 'ReadVideoSessionResult', 'CloseVideoSession']
    .map(name => `/nimi.runtime.v1.RuntimeAiVideoSessionService/${name}`),
  '/nimi.runtime.v1.RuntimeAgentService/GetAgentPresentationAsset',
  '/nimi.runtime.v1.RuntimeAgentService/ResolveDesktopAgentReference',
];
const formalRealmMethods = [
  'listWorldCores', 'createWorldCore', 'getWorldCreationEligibility', 'getWorldCore', 'replaceWorldCore',
  'listWorldCharacters', 'getWorldCharacter', 'createWorldCharacter', 'replaceWorldCharacter',
  'listWorldEntities', 'getWorldEntity', 'createWorldEntity', 'listWorldRelationships', 'getWorldRelationship',
  'listPersonaCharacters', 'getPersonaCharacter', 'createPersonaCharacter', 'replacePersonaCharacter', 'deletePersonaCharacter',
].map(name => `WorldCoreController_${name}`);
const configMethods = ['GetAppAIConfig', 'OverwriteAppAIConfig', 'ListAppAIConfigOptions'] as const;
function configRequest(method: typeof configMethods[number], appId?: string): Uint8Array {
  const owner = appId === undefined ? undefined : { owner: { oneofKind: 'app' as const, app: { appId } } };
  if (method === 'GetAppAIConfig') return GetAppAIConfigRequest.toBinary(GetAppAIConfigRequest.create({ owner }));
  if (method === 'OverwriteAppAIConfig') return OverwriteAppAIConfigRequest.toBinary(OverwriteAppAIConfigRequest.create({ config: { owner } }));
  return ListAppAIConfigOptionsRequest.toBinary(ListAppAIConfigOptionsRequest.create({ owner }));
}

describe('raw Runtime bridge formal App boundary', () => {
  it.each(formalUnaryMethods)('blocks %s before any native call', async method => {
    for (const avatar of [false, true]) {
      const f = fixture(avatar);
      await expect(f.unary(method)).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
      f.assertNoNative();
    }
  });

  it.each(['OpenAppActivity', 'SubscribeAppActivityChanges', 'SubscribeAppActivityOpenRequests'])('blocks %s before native stream Open', async method => {
    for (const avatar of [false, true]) {
      const f = fixture(avatar);
      await expect(f.stream(`/nimi.runtime.v1.RuntimeAppActivityService/${method}`)).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-stream-not-admitted' });
      f.assertNoNative();
    }
  });

  it.each(configMethods)('blocks empty/self/invalid %s owners but preserves the explicit Desktop manager', async method => {
    const methodId = `/nimi.runtime.v1.RuntimeAiService/${method}`;
    for (const owner of [undefined, '', 'nimi.desktop', ' nimi.other ']) {
      const f = fixture();
      await expect(f.unary(methodId, configRequest(method, owner))).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
      f.assertNoNative();
    }
    const manager = fixture();
    await expect(manager.unary(methodId, configRequest(method, 'nimi.other'))).resolves.toEqual({ responseBytesBase64: '' });
    expect(manager.nativeUnary).toHaveBeenCalledOnce();
    // Runtime does not give Avatar the Desktop manager branch.
    const avatar = fixture(true);
    await expect(avatar.unary(methodId, configRequest(method, 'nimi.other'))).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
    avatar.assertNoNative();
  });

  it.each(formalRealmMethods)('blocks exact formal Realm method %s inside its protobuf envelope', async methodId => {
    const f = fixture(true);
    const bytes = InvokeRealmUnaryRequest.toBinary(InvokeRealmUnaryRequest.create({ methodId, requestJson: '{}' }));
    await expect(f.unary('/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary', bytes)).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
    f.assertNoNative();
  });

  it.each([...configMethods.map(method => `/nimi.runtime.v1.RuntimeAiService/${method}`), '/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary'])('refuses malformed dynamic request %s without native dispatch', async method => {
    for (const avatar of [false, true]) {
      const f = fixture(avatar);
      await expect(f.unary(method, Uint8Array.of(0x0a, 0x7f))).rejects.toMatchObject({ reasonCode: 'electron-desktop-runtime-method-not-admitted' });
      f.assertNoNative();
    }
  });

  it('keeps the nonformal broker operation even when its JSON mentions a formal method', async () => {
    const f = fixture(true);
    const bytes = InvokeRealmUnaryRequest.toBinary(InvokeRealmUnaryRequest.create({
      methodId: 'WorldCoreController_discoverPersonaCharacters', requestJson: '{"query":{"text":"WorldCoreController_createWorldCore"}}',
    }));
    await expect(f.unary('/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary', bytes)).resolves.toEqual({ responseBytesBase64: '' });
    expect(f.nativeUnary).toHaveBeenCalledOnce();
  });

  it('preserves independent Desktop Scenario unary and stream principals', async () => {
    const f = fixture();
    await expect(f.unary('/nimi.runtime.v1.RuntimeAiService/ExecuteScenario')).resolves.toEqual({ responseBytesBase64: '' });
    await expect(f.stream('/nimi.runtime.v1.RuntimeAiService/StreamScenario')).resolves.toEqual({ streamId: 'caller-stream' });
    await vi.waitFor(() => expect(f.nativeNext).toHaveBeenCalledOnce());
    expect(f.nativeUnary).toHaveBeenCalledOnce();
    expect(f.nativeOpen).toHaveBeenCalledOnce();
  });
});
