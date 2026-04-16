import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import {
  ensureParentosLocalRuntimeReady,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
  resolveParentosImageTextRuntimeConfig,
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
  loadParentosRuntimeRouteOptionsMock: vi.fn(async (capability: string): Promise<any> => ({
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

  it('preserves cloud text bindings for ParentOS surfaces', () => {
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
      model: 'gpt-5.4',
      route: 'cloud',
      connectorId: 'openai-main',
      temperature: undefined,
      topP: undefined,
      maxTokens: 1000,
      timeoutMs: undefined,
    });
  });

  it('preserves cloud STT bindings for ParentOS surfaces', () => {
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
      model: 'gpt-4o-mini-transcribe',
      route: 'cloud',
      connectorId: 'openai-main',
      language: 'zh-CN',
      responseFormat: undefined,
      timestamps: undefined,
      diarization: undefined,
      speakerCount: undefined,
      prompt: undefined,
      timeoutMs: undefined,
    });
  });

  it('resolves explicit local text runtime config to a qualified local selector', async () => {
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

  it('reroutes OCR text surfaces to an image-capable local model when the selected local model is text-only', async () => {
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
    loadParentosRuntimeRouteOptionsMock.mockResolvedValueOnce({
      capability: 'text.generate',
      selected: null,
      resolvedDefault: {
        source: 'local',
        connectorId: '',
        model: 'gemma-4-vision',
        modelId: 'gemma-4-vision',
        localModelId: 'local-gemma-vision',
        provider: 'llama',
        engine: 'llama',
      },
      local: {
        defaultEndpoint: 'http://127.0.0.1:1234/v1',
        models: [
          {
            localModelId: 'local-qwen3',
            label: 'qwen3',
            engine: 'llama',
            model: 'qwen3',
            modelId: 'qwen3',
            provider: 'llama',
            endpoint: 'http://127.0.0.1:1234/v1',
            status: 'active',
            goRuntimeLocalModelId: 'local-qwen3',
            goRuntimeStatus: 'active',
            capabilities: ['text.generate'],
          },
          {
            localModelId: 'local-gemma-vision',
            label: 'gemma-4-vision',
            engine: 'llama',
            model: 'gemma-4-vision',
            modelId: 'gemma-4-vision',
            provider: 'llama',
            endpoint: 'http://127.0.0.1:1234/v1',
            status: 'active',
            goRuntimeLocalModelId: 'local-gemma-vision',
            goRuntimeStatus: 'active',
            capabilities: ['text.generate', 'text.generate.vision'],
          },
        ],
      },
      connectors: [],
    } as any);

    await expect(resolveParentosImageTextRuntimeConfig('parentos.profile.checkup-ocr', { maxTokens: 800 })).resolves.toEqual({
      model: 'llama/gemma-4-vision',
      route: 'local',
      connectorId: undefined,
      temperature: undefined,
      topP: undefined,
      maxTokens: 800,
      timeoutMs: undefined,
      localModelId: 'local-gemma-vision',
    });
  });

  it('fails closed when no image-capable OCR text model is available', async () => {
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
    loadParentosRuntimeRouteOptionsMock.mockResolvedValueOnce({
      capability: 'text.generate',
      selected: null,
      resolvedDefault: undefined,
      local: {
        defaultEndpoint: 'http://127.0.0.1:1234/v1',
        models: [{
          localModelId: 'local-qwen3',
          label: 'qwen3',
          engine: 'llama',
          model: 'qwen3',
          modelId: 'qwen3',
          provider: 'llama',
          endpoint: 'http://127.0.0.1:1234/v1',
          status: 'active',
          goRuntimeLocalModelId: 'local-qwen3',
          goRuntimeStatus: 'active',
          capabilities: ['text.generate'],
        }],
      },
      connectors: [],
    } as any);

    await expect(resolveParentosImageTextRuntimeConfig('parentos.profile.checkup-ocr', { maxTokens: 800 })).rejects.toThrow(
      '当前 AI 智能识别模型不支持图片识别，请在 AI 设置中为“智能识别”单独选择支持视觉输入的模型后重试。',
    );
  });

  it('prefers the dedicated vision binding over the generic chat binding for OCR', async () => {
    useAppStore.setState({
      aiConfig: {
        scopeRef: PARENTOS_AI_SCOPE_REF,
        capabilities: {
          selectedBindings: {
            'text.generate': {
              source: 'cloud',
              connectorId: 'chat-main',
              model: 'gemini-3.1-flash-lite-preview',
            },
            'text.generate.vision': {
              source: 'cloud',
              connectorId: 'vision-main',
              model: 'gemini-3.1-pro-vision',
            },
          },
          localProfileRefs: {},
          selectedParams: {
            'text.generate': {
              maxTokens: 1200,
            },
          },
        },
        profileOrigin: null,
      },
    });
    loadParentosRuntimeRouteOptionsMock.mockResolvedValueOnce({
      capability: 'text.generate',
      selected: {
        source: 'cloud',
        connectorId: 'vision-main',
        model: 'gemini-3.1-pro-vision',
        provider: 'google',
      },
      resolvedDefault: {
        source: 'cloud',
        connectorId: 'vision-main',
        model: 'gemini-3.1-pro-vision',
        provider: 'google',
      },
      local: {
        defaultEndpoint: 'http://127.0.0.1:1234/v1',
        models: [],
      },
      connectors: [
        {
          id: 'vision-main',
          label: 'Google',
          provider: 'google',
          models: ['gemini-3.1-pro-vision'],
          modelCapabilities: {
            'gemini-3.1-pro-vision': ['text.generate', 'text.generate.vision'],
          },
          modelProfiles: [],
        },
      ],
    } as any);

    await expect(resolveParentosImageTextRuntimeConfig('parentos.profile.checkup-ocr')).resolves.toEqual({
      model: 'cloud/gemini-3.1-pro-vision',
      route: 'cloud',
      connectorId: 'vision-main',
      temperature: undefined,
      topP: undefined,
      maxTokens: 1200,
      timeoutMs: undefined,
      localModelId: undefined,
    });
  });

  it('resolves explicit local STT runtime config to a qualified local selector', async () => {
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
          selectedParams: {},
        },
        profileOrigin: null,
      },
    });

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

  it('keeps automatic runtime resolution untouched when no explicit route binding exists', async () => {
    await expect(resolveParentosTextRuntimeConfig('parentos.advisor', { maxTokens: 1000 })).resolves.toEqual({
      model: 'auto',
      temperature: undefined,
      topP: undefined,
      maxTokens: 1000,
      timeoutMs: undefined,
    });
  });

  it('resolves ParentOS text runtime config to a qualified cloud selector when configured', async () => {
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

    await expect(resolveParentosTextRuntimeConfig('parentos.advisor', { maxTokens: 1000 })).resolves.toEqual({
      model: 'cloud/gpt-5.4',
      route: 'cloud',
      connectorId: 'openai-main',
      temperature: undefined,
      topP: undefined,
      maxTokens: 1000,
      timeoutMs: undefined,
    });
  });

  it('resolves ParentOS STT runtime config to a qualified cloud selector when configured', async () => {
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

    await expect(resolveParentosSpeechTranscribeRuntimeConfig('parentos.journal.voice-observation', {
      language: 'zh-CN',
    })).resolves.toEqual({
      model: 'cloud/gpt-4o-mini-transcribe',
      route: 'cloud',
      connectorId: 'openai-main',
      language: 'zh-CN',
      responseFormat: undefined,
      timestamps: undefined,
      diarization: undefined,
      speakerCount: undefined,
      prompt: undefined,
      timeoutMs: undefined,
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

  it('uses the shared warm timeout when callers do not provide one', async () => {
    await ensureParentosLocalRuntimeReady({
      route: 'local',
      localModelId: 'local-qwen3',
    });

    expect(warmLocalAssetMock).toHaveBeenCalledWith({
      localAssetId: 'local-qwen3',
      timeoutMs: PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS,
    });
  });
});
