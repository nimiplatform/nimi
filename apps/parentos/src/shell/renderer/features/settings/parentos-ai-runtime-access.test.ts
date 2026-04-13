import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import { ensureParentosCapabilityRuntimeAccess } from './parentos-ai-runtime.js';

const {
  ensureParentOSBootstrapReadyMock,
  runtimeReadyMock,
  registerAppMock,
  getMeMock,
  getPlatformClientMock,
} = vi.hoisted(() => ({
  ensureParentOSBootstrapReadyMock: vi.fn(),
  runtimeReadyMock: vi.fn(),
  registerAppMock: vi.fn(),
  getMeMock: vi.fn(),
  getPlatformClientMock: vi.fn(),
}));

vi.mock('../../infra/parentos-bootstrap.js', () => ({
  ensureParentOSBootstrapReady: ensureParentOSBootstrapReadyMock,
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: getPlatformClientMock,
}));

describe('ensureParentosCapabilityRuntimeAccess', () => {
  beforeEach(() => {
    ensureParentOSBootstrapReadyMock.mockReset().mockResolvedValue(undefined);
    runtimeReadyMock.mockReset().mockResolvedValue(undefined);
    registerAppMock.mockReset().mockResolvedValue({
      accepted: true,
      reasonCode: 1,
    });
    getMeMock.mockReset().mockResolvedValue({
      id: 'user-1',
      displayName: 'Parent User',
    });
    getPlatformClientMock.mockReset().mockReturnValue({
      runtime: {
        ready: runtimeReadyMock,
        auth: {
          registerApp: registerAppMock,
        },
      },
      realm: {
        services: {
          MeService: {
            getMe: getMeMock,
          },
        },
      },
    });

    useAppStore.setState({
      auth: {
        status: 'authenticated',
        user: {
          id: 'user-1',
          displayName: 'Parent User',
        },
        token: 'token-1',
        refreshToken: 'refresh-1',
      },
      aiConfig: null,
      cloudAIConfig: null,
      runtimeDefaults: null,
    });
  });

  it('skips runtime auth preparation for local routes', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'local',
              connectorId: '',
              model: 'qwen3',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    await ensureParentosCapabilityRuntimeAccess('text.generate');

    expect(ensureParentOSBootstrapReadyMock).not.toHaveBeenCalled();
    expect(runtimeReadyMock).not.toHaveBeenCalled();
    expect(registerAppMock).not.toHaveBeenCalled();
    expect(getMeMock).not.toHaveBeenCalled();
  });

  it('registers the app and refreshes realm auth once for cloud routes', async () => {
    useAppStore.setState({
      cloudAIConfig: {
        available: true,
        providerApiKey: 'sk-inline',
        providerEndpoint: 'https://api.deepseek.com/v1',
        providerModel: 'deepseek-chat',
        providerType: 'openai_compat',
      },
    });

    await ensureParentosCapabilityRuntimeAccess('text.generate');
    await ensureParentosCapabilityRuntimeAccess('text.generate');

    expect(ensureParentOSBootstrapReadyMock).toHaveBeenCalledTimes(2);
    expect(runtimeReadyMock).toHaveBeenCalledTimes(1);
    expect(registerAppMock).toHaveBeenCalledTimes(1);
    expect(getMeMock).toHaveBeenCalledTimes(1);
  });
});
