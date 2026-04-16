import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAppSetting = vi.fn();
const mockSetAppSetting = vi.fn();

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getAppSetting: mockGetAppSetting,
  setAppSetting: mockSetAppSetting,
}));

vi.mock('../../bridge/ulid.js', () => ({
  isoNow: () => '2026-04-10T10:00:00.000Z',
}));

const {
  PARENTOS_AI_SCOPE_REF,
  loadPersistedParentosAIConfig,
  parsePersistedParentosAIConfig,
  savePersistedParentosAIConfig,
} = await import('./parentos-ai-config.js');

describe('parentos-ai-config persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes a persisted ParentOS AI config payload', () => {
    const parsed = parsePersistedParentosAIConfig(JSON.stringify({
      scopeRef: PARENTOS_AI_SCOPE_REF,
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'cloud',
            connectorId: 'connector-1',
            model: 'gpt-5.4',
            provider: 'openai',
          },
          'text.generate.vision': {
            source: 'cloud',
            connectorId: 'connector-vision',
            model: 'gpt-5.4-vision',
            provider: 'openai',
          },
          'audio.transcribe': null,
        },
        localProfileRefs: {
          'text.generate': {
            modId: 'core:runtime',
            profileId: 'profile-1',
          },
        },
        selectedParams: {
          'text.generate': {
            temperature: 0.2,
          },
        },
      },
      profileOrigin: {
        profileId: 'profile-1',
        title: 'Recommended',
        appliedAt: '2026-04-10T09:00:00.000Z',
      },
    }));

    expect(parsed).toEqual({
      scopeRef: PARENTOS_AI_SCOPE_REF,
      capabilities: {
        selectedBindings: {
          'text.generate': expect.objectContaining({
            source: 'cloud',
            connectorId: 'connector-1',
            model: 'gpt-5.4',
            provider: 'openai',
          }),
          'text.generate.vision': expect.objectContaining({
            source: 'cloud',
            connectorId: 'connector-vision',
            model: 'gpt-5.4-vision',
            provider: 'openai',
          }),
          'audio.transcribe': null,
        },
        localProfileRefs: {
          'text.generate': {
            modId: 'core:runtime',
            profileId: 'profile-1',
          },
        },
        selectedParams: {
          'text.generate': {
            temperature: 0.2,
          },
        },
      },
      profileOrigin: {
        profileId: 'profile-1',
        title: 'Recommended',
        appliedAt: '2026-04-10T09:00:00.000Z',
      },
    });
  });

  it('returns null when the persisted scope does not match ParentOS', async () => {
    mockGetAppSetting.mockResolvedValue(JSON.stringify({
      scopeRef: {
        kind: 'app',
        ownerId: 'desktop',
        surfaceId: 'chat',
      },
      capabilities: {
        selectedBindings: {},
        localProfileRefs: {},
        selectedParams: {},
      },
      profileOrigin: null,
    }));

    await expect(loadPersistedParentosAIConfig()).resolves.toBeNull();
  });

  it('persists the normalized config into app settings', async () => {
    await savePersistedParentosAIConfig({
      scopeRef: PARENTOS_AI_SCOPE_REF,
      capabilities: {
        selectedBindings: {
          'text.generate.vision': {
            source: 'cloud',
            connectorId: 'openai-vision',
            model: 'gpt-5.4-vision',
          },
          'audio.transcribe': {
            source: 'local',
            connectorId: '',
            model: 'whisper-large-v3',
          },
        },
        localProfileRefs: {},
        selectedParams: {},
      },
      profileOrigin: null,
    });

    expect(mockSetAppSetting).toHaveBeenCalledTimes(1);
    expect(mockSetAppSetting).toHaveBeenCalledWith(
      'parentos.ai.config',
      JSON.stringify({
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate.vision': {
              source: 'cloud',
              connectorId: 'openai-vision',
              model: 'gpt-5.4-vision',
            },
            'audio.transcribe': {
              source: 'local',
              connectorId: '',
              model: 'whisper-large-v3',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      }),
      '2026-04-10T10:00:00.000Z',
    );
  });

  it('preserves persisted cloud bindings for ParentOS capability settings', () => {
    const parsed = parsePersistedParentosAIConfig(JSON.stringify({
      scopeRef: PARENTOS_AI_SCOPE_REF,
      capabilities: {
        selectedBindings: {
          'text.generate': {
            source: 'cloud',
            connectorId: 'openai-main',
            model: 'gpt-5.4',
          },
        },
        localProfileRefs: {},
        selectedParams: {},
      },
      profileOrigin: null,
    }));

    expect(parsed?.capabilities.selectedBindings['text.generate']).toEqual({
      source: 'cloud',
      connectorId: 'openai-main',
      model: 'gpt-5.4',
    });
  });
});
