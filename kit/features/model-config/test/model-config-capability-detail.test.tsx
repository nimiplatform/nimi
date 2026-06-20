// Wave 2 prerequisite test — routes ModelConfigCapabilityDetail by editorKind
// across the canonical capability catalog (P-CAPCAT-001..003). Each capability
// id exercises a different editorKind branch plus the null (no-editor) branch.

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelConfigCapabilityDetail } from '../src/ui.js';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import type {
  AppModelConfigSurface,
  SharedAIConfigService,
} from '@nimiplatform/kit/core/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker';
import type { NimiAIConfig, NimiAIScopeRef } from '@nimiplatform/kit/core/sdk-contract';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await flush();
    await flush();
  });
}

const scopeRef: NimiAIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: NimiAIConfig = {
  scopeRef,
  capabilities: { targetRefs: {}, selectedParams: {} },
  profileOrigin: null,
};

function stubService(): SharedAIConfigService {
  return {
    aiConfig: {
      get: () => baseConfig,
      update: () => undefined,
      subscribe: () => () => undefined,
    },
    aiProfile: {
      list: async () => [],
      previewApply: async () => { throw new Error('stub'); },
      apply: async () => ({
        success: false,
        config: null,
        failureReason: 'stub',
        outcome: 'failed',
        probeWarnings: [],
      }),
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function requirementDeclaration(capability: string) {
  return {
    requirementId: `desktop.chat.${capability}`,
    scopeRef,
    requiredSlices: [{
      requirementSliceId: `req.${capability}`,
      capability,
      profileSliceRef: `slice.${capability}`,
      readinessPolicy: 'required' as const,
    }],
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

function makeSurface(capabilityId: string): AppModelConfigSurface {
  return {
    scopeRef,
    aiConfigService: stubService(),
    requirementDeclaration: requirementDeclaration(capabilityId),
    providerResolver: () => null,
    projectionResolver: () => null,
    i18n: { t: (key) => key },
  };
}

function wrap(node: ReactNode): ReactNode {
  return <TooltipProvider>{node}</TooltipProvider>;
}

describe('ModelConfigCapabilityDetail editorKind routing', () => {
  it('routes text.generate to TextGenerateParamsEditor (editorKind=text)', async () => {
    const surface = makeSurface('text.generate');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="text.generate"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.editor.textGenerate.temperatureLabel');
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
    expect(container?.textContent).toContain('Click to change model');
  });

  it('hydrates local runtime target display from the route model picker provider label', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            targetId: 'llama',
            profileId: '01KTEX08DS2GR9HJ1X3R459P1B',
            readinessRef: 'runtime-route:local:llama:01KTEX08DS2GR9HJ1X3R459P1B',
          },
        },
        selectedParams: {},
      },
    };
    const provider: RouteModelPickerDataProvider = {
      listLocalModels: async () => [{
        localModelId: '01KTEX08DS2GR9HJ1X3R459P1B',
        modelId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
        label: 'gemma-4-26B-A4B-it-Q8_0',
        engine: 'llama',
        status: 'active',
        capabilities: ['text.generate'],
      }],
      listConnectors: async () => [],
      listConnectorModels: async () => [],
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('text.generate'),
      providerResolver: () => provider,
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="text.generate"
          surface={surface}
          config={localConfig}
        />,
      ),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    expect(container?.textContent).toContain('gemma-4-26B-A4B-it-Q8_0');
    expect(container?.textContent).not.toContain('01KTEX08DS2GR9HJ1X3R459P1B');
  });

  it('renders active local-import models as model name plus configured source metadata', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            targetId: 'llama',
            profileId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
            readinessRef: 'runtime-route:local:llama:local-import/gemma-4-26B-A4B-it-Q8_0',
          },
        },
        selectedParams: {},
      },
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('text.generate'),
      projectionResolver: () => ({
        supported: true,
        tone: 'ready',
        badgeLabel: 'Bound',
        title: 'Target configured',
        detail: null,
      }),
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="text.generate"
          surface={surface}
          config={localConfig}
        />,
      ),
    );

    const trigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('gemma-4-26B-A4B-it-Q8_0'));
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain('gemma-4-26B-A4B-it-Q8_0');
    expect(trigger?.textContent).not.toContain('local-import/gemma-4-26B-A4B-it-Q8_0');
    expect(trigger?.className).toContain('hover:border-emerald-400');

    const detail = Array.from(trigger?.querySelectorAll('p') || [])
      .find((node) => node.textContent?.includes('local-import'));
    expect(detail?.textContent).toBe('local-import · configured');
    expect(detail?.className).toContain('text-emerald-600');
  });

  it('marks selected active models as setup pending when the injected projection is blocked', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            targetId: 'image',
            profileId: 'local-import/z_image_turbo-Q4_K',
            readinessRef: 'runtime-route:local:image:local-import/z_image_turbo-Q4_K',
          },
        },
        selectedParams: {},
      },
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('image.generate'),
      projectionResolver: () => ({
        supported: false,
        tone: 'attention',
        badgeLabel: 'Needs setup',
        title: 'Required setup missing',
        detail: 'Confirm local assets before running.',
      }),
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={localConfig}
        />,
      ),
    );

    const trigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('z_image_turbo-Q4_K'));
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain('setup pending');
    const detail = Array.from(trigger?.querySelectorAll('p') || [])
      .find((node) => node.textContent?.includes('setup pending'));
    expect(detail?.className).toContain('text-amber-600');
    expect(container?.textContent).toContain('Required setup missing');
  });

  it('does not expose opaque local runtime ids while provider hydration is unavailable', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            targetId: 'llama',
            profileId: '01KTEX08DS2GR9HJ1X3R459P1B',
            readinessRef: 'runtime-route:local:llama:01KTEX08DS2GR9HJ1X3R459P1B',
          },
        },
        selectedParams: {},
      },
    };
    const provider: RouteModelPickerDataProvider = {
      listLocalModels: async () => [],
      listConnectors: async () => [],
      listConnectorModels: async () => [],
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('text.generate'),
      providerResolver: () => provider,
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="text.generate"
          surface={surface}
          config={localConfig}
        />,
      ),
    );
    await act(async () => {
      await flush();
      await flush();
    });

    expect(container?.textContent).toContain('Local runtime model');
    expect(container?.textContent).not.toContain('01KTEX08DS2GR9HJ1X3R459P1B');
  });

  it('does not render connector ids under the active model selector', async () => {
    const cloudConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'image.generate': {
            kind: 'cloud-connector',
            connectorId: '01KV2PF5ZWB6KS2SP17B2E8JTB',
            providerModelId: 'gemini-3.1-flash-image-preview',
          },
        },
        selectedParams: {},
      },
    };
    const surface = makeSurface('image.generate');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={cloudConfig}
        />,
      ),
    );

    expect(container?.textContent).toContain('gemini-3.1-flash-image-preview');
    expect(container?.textContent).not.toContain('01KV2PF5ZWB6KS2SP17B2E8JTB');
  });

  it('routes image.generate to ImageParamsEditor (editorKind=image)', async () => {
    const surface = makeSurface('image.generate');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    // Image editor has showEditorWhen='local'; without a local binding the body
    // is not rendered, but setup projection remains visible.
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
    expect(container?.textContent).toContain('Setup required');
  });

  it('passes image companion slots and local assets through the shared detail editor', async () => {
    const imageConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            readinessRef: 'readiness:image-local',
          },
        },
        selectedParams: {
          'image.generate': {
            seed: 'seed-old',
            companionSlots: { vae_path: 'asset-vae' },
          },
        },
      },
    };
    const updates: NimiAIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => imageConfig,
        update: (_scope, next) => updates.push(next),
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [],
        previewApply: async () => { throw new Error('stub'); },
        apply: async () => ({
          success: false,
          config: null,
          failureReason: 'stub',
          outcome: 'failed',
          probeWarnings: [],
        }),
      },
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('image.generate'),
      aiConfigService: service,
      localAssetSource: {
        list: () => [{
          localAssetId: 'asset-vae',
          assetId: 'VAE Asset',
          kind: 'vae',
          engine: 'test',
          status: 'active',
        }],
        loading: false,
      },
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={imageConfig}
        />,
      ),
    );

    expect(container?.textContent).toContain('VAE Asset');
    expect(container?.textContent).not.toContain('ModelConfig.editor.common.previewBadgeLabel');
    const seedInput = Array.from(container?.querySelectorAll('input') || [])
      .find((input) => input.value === 'seed-old');
    expect(seedInput).toBeTruthy();
    await act(async () => {
      setInputValue(seedInput as HTMLInputElement, 'seed-new');
      await flush();
    });

    const nextParams = updates[0]?.capabilities.selectedParams['image.generate'] as Record<string, unknown> | undefined;
    expect(nextParams?.seed).toBe('seed-new');
    expect(nextParams?.companionSlots).toEqual({ vae_path: 'asset-vae' });
  });

  it('routes video.generate to VideoParamsEditor (editorKind=video)', async () => {
    const surface = makeSurface('video.generate');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="video.generate"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
  });

  it('routes audio.transcribe to AudioTranscribeParamsEditor (editorKind=audio-transcribe)', async () => {
    const surface = makeSurface('audio.transcribe');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="audio.transcribe"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.editor.audioTranscribe.languageLabel');
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
  });

  it('routes audio.synthesize to AudioSynthesizeParamsEditor (editorKind=audio-synthesize)', async () => {
    const surface = makeSurface('audio.synthesize');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="audio.synthesize"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.editor.audioSynthesize.voiceRefLabel');
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
  });

  it('keeps long selected TTS model labels inside the capability card trigger', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        targetRefs: {
          'audio.synthesize': {
            kind: 'local-runtime',
            targetId: 'speech',
            profileId: 'local.tts.qwen3-tts-customvoice-0.6b.safetensors',
            readinessRef: 'runtime-route:local:speech:local.tts.qwen3-tts-customvoice-0.6b.safetensors',
          },
        },
        selectedParams: {},
      },
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('audio.synthesize'),
      projectionResolver: () => ({
        supported: false,
        tone: 'attention',
        badgeLabel: 'Needs setup',
        title: 'Local speech setup required',
        detail: 'Confirm local speech runtime assets before running.',
      }),
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="audio.synthesize"
          surface={surface}
          config={localConfig}
          activeModelHint={null}
        />,
      ),
    );

    const card = container?.firstElementChild as HTMLElement | null;
    expect(card?.className).toContain('min-w-0');
    expect(card?.className).toContain('max-w-full');
    expect(card?.className).toContain('overflow-hidden');

    const trigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('qwen3-tts-customvoice'));
    expect(trigger).toBeTruthy();
    expect(trigger?.className).toContain('min-w-0');
    expect(trigger?.className).toContain('max-w-full');
    expect(trigger?.className).toContain('overflow-hidden');
    const label = trigger?.querySelector('p');
    expect(label?.className).toContain('truncate');
  });

  it('routes voice_workflow.voice_clone to VoiceWorkflowParamsEditor (editorKind=voice-workflow)', async () => {
    const surface = makeSurface('voice_workflow.voice_clone');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="voice_workflow.voice_clone"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.editor.voiceWorkflow.referenceTextLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.voiceWorkflow.voiceDesignPromptLabel');
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
  });

  it('routes voice_workflow.voice_design to design-specific VoiceWorkflowParamsEditor fields', async () => {
    const surface = makeSurface('voice_workflow.voice_design');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="voice_workflow.voice_design"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.editor.voiceWorkflow.voiceDesignPromptLabel');
    expect(container?.textContent).toContain('ModelConfig.editor.voiceWorkflow.previewTextLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.voiceWorkflow.referenceAssetLabel');
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
  });

  it('renders no params editor for text.embed (editorKind=null)', async () => {
    const surface = makeSurface('text.embed');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="text.embed"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    // Null editorKind: model selector renders, but no params-editor label appears.
    expect(container?.textContent).toContain('ModelConfig.hub.activeModelLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.textGenerate.temperatureLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.audioTranscribe.languageLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.voiceWorkflow.referenceTextLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.voiceWorkflow.voiceDesignPromptLabel');
  });

  it('returns null for an unknown capability id (catalog miss)', async () => {
    const surface = makeSurface('nope.unknown');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="nope.unknown"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent ?? '').toBe('');
  });
});
