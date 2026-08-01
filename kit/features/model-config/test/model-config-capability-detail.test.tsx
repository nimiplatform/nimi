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
  capabilities: { logicalModelIds: {}, targetRefs: {}, selectedComponents: {}, selectedParams: {} },
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
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: '01KTEX08DS2GR9HJ1X3R459P1B',
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

  it('hydrates local runtime target display from v2 provider identity fields', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: '01KTEX08DS2GR9HJ1X3R459P1B',
          },
        },
        selectedParams: {},
      },
    };
    const provider: RouteModelPickerDataProvider = {
      listLocalModels: async () => [{
        localModelId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
        goRuntimeLocalModelId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
        profileBindingId: '01KTEX08DS2GR9HJ1X3R459P1B',
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
    expect(container?.textContent).not.toContain('Local runtime model');
    expect(container?.textContent).not.toContain('01KTEX08DS2GR9HJ1X3R459P1B');
  });

  it('hydrates the adjacent Runtime route projection while AIConfig remains the editable truth', async () => {
    const localModelId = '01KYSTRPKPAN8WWT102A6A8GH0';
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        logicalModelIds: { 'text.generate': localModelId },
      },
    };
    const routeIntent = {
        capability: 'text.generate',
        provider: '',
        model: localModelId,
        routePolicy: 'local' as const,
    };
    const provider: RouteModelPickerDataProvider = {
      listLocalModels: async () => [{
        localModelId,
        modelId: 'local-import/gemma-4-26B-A4B-it-Q8_0/01kystq3jhtwgvzarkwdfhfn38',
        label: 'local-import/gemma-4-26B-A4B-it-Q8_0/01kystq3jhtwgvzarkwdfhfn38',
        engine: 'llama',
        status: 'active',
        capabilities: ['text.generate'],
      }],
      listConnectors: async () => [],
      listConnectorModels: async () => [],
    };
    const surface: AppModelConfigSurface = {
      scopeRef,
      aiConfigService: {
        aiConfig: {
          get: () => localConfig,
          update: async () => undefined,
          subscribe: () => () => undefined,
        },
      },
      routeIntentResolver: () => routeIntent,
      requirementDeclaration: requirementDeclaration('text.generate'),
      providerResolver: () => provider,
      projectionResolver: () => null,
      i18n: { t: (key) => key },
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

    expect(container?.textContent).toContain('gemma-4-26B-A4B-it-Q8_0/01kystq3jhtwgvzarkwdfhfn38');
    expect(container?.textContent).not.toContain(localModelId);
  });

  it('renders active local-import models as model name plus configured source metadata', async () => {
    const localConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
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
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-import/z_image_turbo-Q4_K',
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
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: '01KTEX08DS2GR9HJ1X3R459P1B',
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
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'image.generate': {
            kind: 'cloud-connector',
            connectorId: '01KV2PF5ZWB6KS2SP17B2E8JTB',
            remoteModelCatalogId: 'remote-catalog:gemini:image-preview',
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

  it('does not direct-upsert a main model into blank image config and guides Profile apply', async () => {
    const updates: NimiAIConfig[] = [];
    const provider: RouteModelPickerDataProvider = {
      listLocalModels: async () => [{
        localModelId: 'runtime-public-z-image',
        modelId: 'local/z-image-turbo',
        label: 'Z Image Turbo',
        engine: 'stable-diffusion.cpp',
        status: 'installed',
        capabilities: ['image.generate'],
        readinessRef: 'runtime_readiness:v2:z-image',
      }],
      listConnectors: async () => [],
      listConnectorModels: async () => [],
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('image.generate'),
      aiConfigService: {
        ...stubService(),
        aiConfig: {
          get: () => baseConfig,
          update: (_scope, next) => { updates.push(next); },
          subscribe: () => () => undefined,
        },
      },
      providerResolver: () => provider,
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={baseConfig}
        />,
      ),
    );

    const trigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('Setup required'));
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.click();
      await flush();
      await flush();
    });
    const modelButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Z Image Turbo'));
    expect(modelButton).toBeTruthy();
    await act(async () => {
      modelButton?.click();
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(0);
    expect(container?.textContent).toContain('Apply an AI Profile first');
    expect(container?.textContent).toContain('component occurrence structure');
  });

  it('hydrates committed component slots and patches one INSTALLED durable selection without changing params or structure', async () => {
    const currentTarget = {
      kind: 'local-runtime' as const,
      version: 'v2' as const,
      readinessRef: 'readiness:vae-current',
    };
    const replacementTarget = {
      kind: 'local-runtime' as const,
      version: 'v2' as const,
      profileBindingId: '01KREPLACEMENTTARGET00000000',
    };
    const committedComponents = [
      {
        occurrenceId: 'vae-primary',
        order: 10,
        role: 'vae',
        componentKind: 'vae',
        logicalModelId: 'public/vae-current',
        targetRef: currentTarget,
        required: true,
        weight: '0.75',
        options: { precision: 'fp16' },
      },
      {
        occurrenceId: 'encoder-primary',
        order: 20,
        role: 'text_encoder',
        componentKind: 'text_encoder',
        logicalModelId: 'public/encoder-current',
        required: true,
      },
    ];
    const imageConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        logicalModelIds: { 'image.generate': 'public/image-main' },
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            readinessRef: 'readiness:image-local',
          },
        },
        selectedComponents: { 'image.generate': committedComponents },
        selectedParams: {
          'image.generate': { seed: 'seed-old', steps: '7' },
        },
      },
    };
    const updates: NimiAIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => imageConfig,
        update: (_scope, next) => { updates.push(next); },
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
    const privateAssetUlid = '01KPRIVATEASSET000000000000';
    const surface: AppModelConfigSurface = {
      ...makeSurface('image.generate'),
      aiConfigService: service,
      localAssetSource: {
        list: () => [
          {
            localAssetId: '01KCURRENTASSET00000000000',
            assetId: '01KCURRENTRECORD0000000000',
            logicalModelId: 'public/vae-current',
            displayName: 'Current VAE',
            kind: 'vae',
            engine: 'media',
            status: 'installed',
            artifactRoles: ['vae'],
            durableTargetRef: currentTarget,
          },
          {
            localAssetId: privateAssetUlid,
            assetId: '01KPRIVATERECORD0000000000',
            logicalModelId: 'public/vae-v2',
            displayName: 'VAE Two',
            kind: 'vae',
            engine: 'media',
            status: 'installed',
            artifactRoles: ['vae'],
            durableTargetRef: replacementTarget,
          },
          {
            localAssetId: '01KINCOMPATIBLE00000000000',
            assetId: '01KINCOMPATIBLERECORD000000',
            logicalModelId: 'public/clip-wrong-slot',
            displayName: 'Wrong CLIP component',
            kind: 'clip',
            engine: 'media',
            status: 'active',
            artifactRoles: ['clip_l'],
            durableTargetRef: {
              kind: 'local-runtime',
              version: 'v2',
              readinessRef: 'readiness:clip-wrong-slot',
            },
          },
          {
            localAssetId: '01KQWENASSET0000000000000',
            assetId: 'qwen3-companion',
            logicalModelId: 'public/encoder-v2',
            displayName: 'Qwen3-4B-Q4_K_M',
            kind: 'chat',
            engine: 'llama',
            status: 'active',
            durableTargetRef: {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: '01KQWENTARGET0000000000000',
            },
          },
          {
            localAssetId: '01KDORMANTASSET0000000000',
            assetId: '01KDORMANTRECORD000000000',
            logicalModelId: 'public/vae-dormant',
            displayName: 'Dormant VAE',
            kind: 'vae',
            engine: 'media',
            status: 'unhealthy',
            artifactRoles: ['vae'],
            durableTargetRef: {
              kind: 'local-runtime',
              version: 'v2',
              readinessRef: 'readiness:vae-dormant',
            },
          },
        ],
        loading: false,
      },
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={imageConfig}
          profileCapability={{
            capabilityId: 'image.generate',
            modelLabel: 'Z Image Turbo',
            components: [],
            parameterSummary: [],
          }}
        />,
      ),
    );

    expect(container?.textContent).toContain('Z Image Turbo');
    expect(container?.textContent).toContain('Current VAE');
    expect(container?.textContent).toContain('public/encoder-current');
    expect(container?.textContent).toContain('vae · vae');
    expect(container?.textContent).toContain('text_encoder · text_encoder');
    expect(container?.textContent).toContain('Currently unavailable');
    expect(container?.querySelectorAll('[data-nimi-model-config-component-slot]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain(privateAssetUlid);
    expect(document.body.textContent).not.toContain('01KPRIVATERECORD0000000000');

    const currentTrigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('Current VAE'));
    expect(currentTrigger).toBeTruthy();
    await act(async () => {
      currentTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(document.body.textContent).not.toContain('Wrong CLIP component');
    const dormantButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Dormant VAE')) as HTMLButtonElement | undefined;
    expect(dormantButton?.disabled).toBe(true);
    dormantButton?.click();
    expect(updates).toHaveLength(0);

    const currentButton = Array.from(document.body.querySelectorAll('[role="dialog"] button'))
      .find((button) => button.textContent?.includes('Current VAE')) as HTMLButtonElement | undefined;
    expect(currentButton?.disabled).toBe(false);

    const replacementButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('VAE Two')) as HTMLButtonElement | undefined;
    expect(replacementButton?.disabled).toBe(false);
    await act(async () => {
      replacementButton?.click();
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.capabilities.selectedParams['image.generate']).toEqual({ seed: 'seed-old', steps: '7' });
    const patchedComponents = updates[0]?.capabilities.selectedComponents['image.generate'];
    expect(patchedComponents).toHaveLength(2);
    expect(patchedComponents?.[0]).toEqual({
      ...committedComponents[0],
      logicalModelId: 'public/vae-v2',
      targetRef: replacementTarget,
    });
    expect(patchedComponents?.[1]).toEqual(committedComponents[1]);
    expect(patchedComponents?.map((component) => component.occurrenceId)).toEqual([
      'vae-primary',
      'encoder-primary',
    ]);

    const encoderTrigger = Array.from(container?.querySelectorAll('button') || [])
      .find((button) => button.textContent?.includes('public/encoder-current'));
    expect(encoderTrigger).toBeTruthy();
    await act(async () => {
      encoderTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    const qwenButton = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Qwen3-4B-Q4_K_M')) as HTMLButtonElement | undefined;
    expect(qwenButton?.disabled).toBe(false);
    await act(async () => {
      qwenButton?.click();
      await flush();
      await flush();
    });
    expect(updates).toHaveLength(2);
    expect(updates[1]?.capabilities.selectedComponents['image.generate']?.[1]).toMatchObject({
      logicalModelId: 'public/encoder-v2',
      targetRef: {
        kind: 'local-runtime',
        profileBindingId: '01KQWENTARGET0000000000000',
      },
    });
  });

  it('surfaces async host persistence failures instead of projecting a successful save', async () => {
    const imageConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            readinessRef: 'readiness:image-local',
          },
        },
        selectedParams: {
          'image.generate': { seed: 'seed-old' },
        },
      },
    };
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => imageConfig,
        update: async () => {
          throw new Error('host save failed');
        },
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

    const seedInput = Array.from(container?.querySelectorAll('input') || [])
      .find((input) => input.value === 'seed-old');
    expect(seedInput).toBeTruthy();
    await act(async () => {
      setInputValue(seedInput as HTMLInputElement, 'seed-new');
      await flush();
      await flush();
    });

    expect(container?.textContent).toContain('AI config save failed');
    expect(container?.textContent).toContain('host save failed');
  });

  it('serializes async capability writes and reads fresh base after the previous write resolves', async () => {
    let currentConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            readinessRef: 'readiness:image-local',
          },
        },
        selectedParams: {
          'image.generate': { seed: 'seed-start' },
        },
      },
    };
    let getCalls = 0;
    const updates: NimiAIConfig[] = [];
    const resolvers: Array<() => void> = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => {
          getCalls += 1;
          return currentConfig;
        },
        update: (_scope, next) => new Promise<void>((resolve) => {
          updates.push(next);
          resolvers.push(() => {
            currentConfig = next;
            resolve();
          });
        }),
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
    };
    await render(
      wrap(
        <ModelConfigCapabilityDetail
          capabilityId="image.generate"
          surface={surface}
          config={currentConfig}
        />,
      ),
    );

    const seedInput = Array.from(container?.querySelectorAll('input') || [])
      .find((input) => input.value === 'seed-start');
    expect(seedInput).toBeTruthy();
    await act(async () => {
      setInputValue(seedInput as HTMLInputElement, 'seed-one');
      await flush();
    });
    expect(getCalls).toBe(1);
    expect(updates).toHaveLength(1);

    await act(async () => {
      setInputValue(seedInput as HTMLInputElement, 'seed-two');
      await flush();
    });
    expect(getCalls).toBe(1);
    expect(updates).toHaveLength(1);

    await act(async () => {
      resolvers[0]?.();
      await flush();
      await flush();
    });
    expect(getCalls).toBe(2);
    expect(updates).toHaveLength(2);

    await act(async () => {
      resolvers[1]?.();
      await flush();
      await flush();
    });
    const finalParams = currentConfig.capabilities.selectedParams['image.generate'] as Record<string, unknown>;
    expect(finalParams.seed).toBe('seed-two');
  });

  it('does not infer portable image composition from private local-runtime target strings', async () => {
    const imageConfig: NimiAIConfig = {
      ...baseConfig,
      capabilities: {
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:local-ideogram4',
          },
        },
        selectedParams: {
          'image.generate': {},
        },
      },
    };
    const surface: AppModelConfigSurface = {
      ...makeSurface('image.generate'),
      localAssetSource: {
        list: () => [
          {
            localAssetId: 'local-ideogram4',
            assetId: 'local-import/ideogram4-Q4_0',
            kind: 'image',
            engine: 'media',
            status: 'active',
            family: 'ideogram4',
          },
          {
            localAssetId: 'local-ideogram4-uncond',
            assetId: 'local-import/ideogram4_uncond-Q4_0',
            kind: 'image',
            engine: 'media',
            status: 'active',
            artifactRoles: ['uncond_diffusion_model'],
          },
        ],
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

    expect(container?.querySelector('[data-nimi-image-component-slots="0"]')).toBeTruthy();
    expect(container?.textContent).not.toContain('Uncond diffusion');
    expect(container?.textContent).not.toContain('local-import/ideogram4_uncond-Q4_0');
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
        ...baseConfig.capabilities,
        logicalModelIds: {},
        targetRefs: {
          'audio.synthesize': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local.tts.qwen3-tts-customvoice-0.6b.safetensors',
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
