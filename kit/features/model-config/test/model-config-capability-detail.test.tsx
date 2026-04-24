// Wave 2 prerequisite test — routes ModelConfigCapabilityDetail by editorKind
// across the canonical capability catalog (P-CAPCAT-001..003). Each capability
// id exercises a different editorKind branch plus the null (no-editor) branch.

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelConfigCapabilityDetail } from '../src/ui.js';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import type {
  AppModelConfigSurface,
  SharedAIConfigService,
} from '@nimiplatform/nimi-kit/core/model-config';
import type { AIConfig, AIScopeRef } from '@nimiplatform/sdk/mod';

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

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: AIConfig = {
  scopeRef,
  capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
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
      apply: async () => ({ success: false, config: null, failureReason: 'stub', probeWarnings: [] }),
    },
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Provider stub that satisfies RouteModelPickerDataProvider shape. The modal
// mounts immediately and runs a data-fetch effect even when `open=false`, so
// listLocalModels/listConnectors must be real functions.
const providerStub = Object.freeze({
  listLocalModels: async () => [],
  listConnectors: async () => [],
  listConnectorModels: async () => [],
});

function makeSurface(capabilityId: string): AppModelConfigSurface {
  return {
    scopeRef,
    aiConfigService: stubService(),
    enabledCapabilities: [capabilityId],
    providerResolver: () => providerStub,
    projectionResolver: () => null,
    runtimeReady: true,
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
    expect(container?.textContent).toContain('ModelConfig.capability.textGenerate.title');
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
    // is not rendered, but the capability card title is.
    expect(container?.textContent).toContain('ModelConfig.capability.imageGenerate.title');
  });

  it('passes image companion slots and local assets through the shared detail editor', async () => {
    const imageConfig: AIConfig = {
      ...baseConfig,
      capabilities: {
        selectedBindings: {
          'image.generate': {
            source: 'local',
            connectorId: 'local',
            model: 'image-local',
          },
        },
        localProfileRefs: {},
        selectedParams: {
          'image.generate': {
            seed: 'seed-old',
            companionSlots: { vae_path: 'asset-vae' },
          },
        },
      },
    };
    const updates: AIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => imageConfig,
        update: (_scope, next) => updates.push(next),
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [],
        apply: async () => ({ success: false, config: null, failureReason: 'stub', probeWarnings: [] }),
      },
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('image.generate'),
      aiConfigService: service,
      localAssetSource: {
        list: () => [{
          localAssetId: 'asset-vae',
          assetId: 'VAE Asset',
          kind: 10,
          engine: 'test',
          status: 0,
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
    expect(container?.textContent).toContain('ModelConfig.capability.videoGenerate.title');
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
    expect(container?.textContent).toContain('ModelConfig.capability.audioTranscribe.title');
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
    expect(container?.textContent).toContain('ModelConfig.editor.audioSynthesize.voiceIdLabel');
    expect(container?.textContent).toContain('ModelConfig.capability.audioSynthesize.title');
  });

  it('routes voice_workflow.tts_v2v to VoiceWorkflowParamsEditor (editorKind=voice-workflow)', async () => {
    const surface = makeSurface('voice_workflow.tts_v2v');
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="voice_workflow.tts_v2v"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );
    expect(container?.textContent).toContain('ModelConfig.editor.voiceWorkflow.referenceTextLabel');
    expect(container?.textContent).toContain('ModelConfig.capability.voiceWorkflowTtsV2v.title');
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
    // Null editorKind: capability card renders, but no params-editor label appears.
    expect(container?.textContent).toContain('ModelConfig.capability.textEmbed.title');
    expect(container?.textContent).not.toContain('ModelConfig.editor.textGenerate.temperatureLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.audioTranscribe.languageLabel');
    expect(container?.textContent).not.toContain('ModelConfig.editor.voiceWorkflow.referenceTextLabel');
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
