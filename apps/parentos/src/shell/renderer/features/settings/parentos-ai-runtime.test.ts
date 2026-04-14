import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import {
  ensureParentosLocalRuntimeReady,
  resolveParentosSpeechTranscribeRuntimeConfig,
  resolveParentosSpeechTranscribeConfig,
  resolveParentosSpeechTranscribeSurfaceConfig,
  resolveParentosTextRuntimeConfig,
  resolveParentosTextGenerateConfig,
  resolveParentosTextSurfaceConfig,
} from './parentos-ai-runtime.js';

const {
  warmLocalAssetMock,
  loadParentosRuntimeRouteOptionsMock,
  getPlatformClientMock,
} = vi.hoisted(() => ({
  warmLocalAssetMock: vi.fn(async () => ({})),
  loadParentosRuntimeRouteOptionsMock: vi.fn(async (capability: string) => ({
    capability,
    selected: null,
    resolvedDefault: capability === 'audio.transcribe'
      ? {
        source: 'local',
        connectorId: '',
        model: 'whisper-large-v3',
        modelId: 'whisper-large-v3',
        localModelId: 'local-whisper-large-v3',
        provider: 'speech',
        engine: 'speech',
        endpoint: 'http://127.0.0.1:1234/v1',
        goRuntimeLocalModelId: 'local-whisper-large-v3',
        goRuntimeStatus: 'active',
      }
      : {
        source: 'local',
        connectorId: '',
        model: 'qwen3',
        modelId: 'qwen3',
        localModelId: 'local-qwen3',
        provider: 'llama',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:1234/v1',
        goRuntimeLocalModelId: 'local-qwen3',
        goRuntimeStatus: 'active',
      },
    local: {
      defaultEndpoint: 'http://127.0.0.1:1234/v1',
      models: [],
    },
    connectors: [],
  })),
  getPlatformClientMock: vi.fn(() => ({
    runtime: {
      local: {
        warmLocalAsset: vi.fn(async () => ({})),
      },
    },
  })),
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => getPlatformClientMock(),
}));

vi.mock('../../infra/parentos-runtime-route-options.js', () => ({
  loadParentosRuntimeRouteOptions: loadParentosRuntimeRouteOptionsMock,
}));

describe('parentos-ai-runtime', () => {
  beforeEach(() => {
    useAppStore.setState({ aiConfig: null });
    warmLocalAssetMock.mockReset();
    loadParentosRuntimeRouteOptionsMock.mockClear();
    getPlatformClientMock.mockClear();
    getPlatformClientMock.mockReturnValue({
      runtime: {
        local: {
          warmLocalAsset: warmLocalAssetMock,
        },
      },
    });
  });

  it('merges text capability defaults with stored runtime config', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'local',
              connectorId: '',
              model: 'gemma-4',
            },
          },
          localProfileRefs: {},
          selectedParams: {
            'text.generate': {
              temperature: 0.2,
              maxTokens: 900,
            },
          },
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosTextGenerateConfig({ temperature: 0.7, topP: 0.9, maxTokens: 1024 })).toEqual({
      model: 'gemma-4',
      route: 'local',
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 900,
      timeoutMs: undefined,
    });
  });

  it('merges speech transcribe defaults with stored runtime config', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'audio.transcribe': {
              source: 'local',
              connectorId: '',
              model: 'whisper-large-v3',
            },
          },
          localProfileRefs: {},
          selectedParams: {
            'audio.transcribe': {
              prompt: '儿童成长记录',
              diarization: true,
              speakerCount: 2,
            },
          },
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosSpeechTranscribeConfig({ language: 'zh-CN', responseFormat: 'text', timestamps: false })).toEqual({
      model: 'whisper-large-v3',
      route: 'local',
      language: 'zh-CN',
      responseFormat: 'text',
      timestamps: false,
      diarization: true,
      speakerCount: 2,
      prompt: '儿童成长记录',
      timeoutMs: undefined,
    });
  });

  it('forces governed text surfaces onto the local route', () => {
    useAppStore.setState({
      aiConfig: {
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
      },
    });

    expect(resolveParentosTextSurfaceConfig('parentos.advisor', { maxTokens: 1000 })).toEqual({
      model: 'auto',
      route: 'local',
      connectorId: undefined,
      temperature: undefined,
      topP: undefined,
      maxTokens: 1000,
      timeoutMs: undefined,
    });
  });

  it('forces governed STT surfaces onto the local route', () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'audio.transcribe': {
              source: 'cloud',
              connectorId: 'openai-main',
              model: 'gpt-4o-mini-transcribe',
            },
          },
          localProfileRefs: {},
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

    expect(resolveParentosSpeechTranscribeSurfaceConfig('parentos.journal.voice-observation', {
      language: 'zh-CN',
    })).toEqual({
      model: 'auto',
      route: 'local',
      connectorId: undefined,
      language: 'zh-CN',
      responseFormat: undefined,
      timestamps: undefined,
      diarization: undefined,
      speakerCount: undefined,
      prompt: undefined,
      timeoutMs: undefined,
    });
  });

  it('resolves governed text runtime config to a qualified local selector', async () => {
    await expect(resolveParentosTextRuntimeConfig('parentos.advisor', { maxTokens: 1000 })).resolves.toEqual({
      model: 'llama/qwen3',
      route: 'local',
      connectorId: undefined,
      temperature: undefined,
      topP: undefined,
      maxTokens: 1000,
      timeoutMs: undefined,
      localModelId: 'local-qwen3',
    });
  });

  it('resolves governed STT runtime config to a qualified local selector', async () => {
    await expect(resolveParentosSpeechTranscribeRuntimeConfig('parentos.journal.voice-observation', {
      language: 'zh-CN',
    })).resolves.toEqual({
      model: 'speech/whisper-large-v3',
      route: 'local',
      connectorId: undefined,
      language: 'zh-CN',
      responseFormat: undefined,
      timestamps: undefined,
      diarization: undefined,
      speakerCount: undefined,
      prompt: undefined,
      timeoutMs: undefined,
      localModelId: 'local-whisper-large-v3',
    });
  });

  it('warms local ParentOS runtime assets when a local model id is present', async () => {
    await ensureParentosLocalRuntimeReady({
      route: 'local',
      localModelId: 'local-qwen3',
      timeoutMs: 60000,
    });

    expect(warmLocalAssetMock).toHaveBeenCalledWith({
      localAssetId: 'local-qwen3',
      timeoutMs: 60000,
    });
  });
});
