import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiCapabilityAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import { CAPABILITY_DEFAULT_FIELDS } from '../src/capability-defaults.js';
import { ModelConfigAIConfigSurface } from '../src/components/model-config-ai-config-surface.js';
import type { ModelConfigCloudAIConfigModule, ModelConfigOverwrite } from '../src/types.js';
import {
  modelConfigCapabilityPosture,
  modelConfigMissingRequiredFeatures,
  projectModelConfigLocalSelections,
} from '../src/projection.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSurface(
  onOverwrite: ModelConfigOverwrite,
  onOpenMachineConfiguration = vi.fn(),
  options: {
    readonly cloudAIConfig?: ModelConfigCloudAIConfigModule;
    readonly consumer?: 'nimi-first-party' | 'third-party-app';
    readonly initialCapabilityContract?: string;
    readonly onOpenCloudConnectorConfiguration?: () => void;
    readonly onOpenOwnerConfiguration?: () => void;
    readonly capabilityContracts?: readonly string[];
    readonly capabilities?: readonly NimiCapabilityAIConfigIntent[];
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', consumer: options.consumer || 'nimi-first-party', appId: 'test.app' }}
        capabilityContracts={options.capabilityContracts || ['text.generate']}
        initialCapabilityContract={options.initialCapabilityContract}
        capabilities={options.capabilities || [{
          capabilityContract: 'text.generate',
          requiredFeatures: [],
          defaults: undefined,
          route: { oneofKind: 'local', local: {} },
        }]}
        localSelections={[{
          capabilityContract: 'text.generate',
          state: 'selected',
          configurationId: 'machine-text',
          displayName: 'Machine text model',
          supportedFeatures: [],
          reasons: [],
          effectiveDefaults: { temperature: '0.8', seed: 'random' },
        }]}
        cloudAIConfig={Object.hasOwn(options, 'cloudAIConfig') ? options.cloudAIConfig : {
          listImplementations: async () => [{
            optionId: 'cloud-test',
            label: 'Cloud Test',
            provider: 'provider-test',
            implementation: {
              implementationId: 'cloud-test',
              driverId: 'nimillm',
              driverDialect: 'openai',
            },
          }],
          listTargets: async () => [{
            targetId: 'cloud-model',
            label: 'Cloud Model',
            provider: 'provider-test',
            providerModelTarget: {
              provider: 'provider-test',
              providerModelId: 'cloud-model',
              remoteModelCatalogId: 'rmc-cloud-model',
            },
          }],
          listAuthorizationOptions: async () => ({
            connectors: [{ connectorId: 'connector-test', label: 'Test account', provider: 'provider-test' }],
          }),
        }}
        onOpenMachineConfiguration={onOpenMachineConfiguration}
        onOpenCloudConnectorConfiguration={options.onOpenCloudConnectorConfiguration}
        onOpenOwnerConfiguration={options.onOpenOwnerConfiguration}
        onOverwrite={onOverwrite}
      />,
    );
    await Promise.resolve();
  });
  return container;
}

async function selectField(node: HTMLElement, ariaLabel: string, optionLabel: string): Promise<void> {
  const trigger = node.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger.click(); await Promise.resolve(); });
  await flush();
  const option = Array.from(document.body.querySelectorAll('[role="option"]'))
    .find((entry) => entry.textContent?.includes(optionLabel)) as HTMLElement;
  expect(option).toBeTruthy();
  await act(async () => { option.click(); await Promise.resolve(); });
  await flush();
}

describe('public Model Config contract', () => {
  it('matches the Runtime defaults allowlist for every editable capability', () => {
    const paths = (capability: string): string[] => {
      const walk = (fields: typeof CAPABILITY_DEFAULT_FIELDS[string], prefix = ''): string[] => fields.flatMap((field) => {
        const path = prefix ? `${prefix}.${field.key}` : field.key;
        return field.kind === 'object' ? walk(field.fields || [], path) : [path];
      });
      return walk(CAPABILITY_DEFAULT_FIELDS[capability] || []);
    };

    expect(paths('text.generate')).toEqual([
      'temperature', 'topP', 'topK', 'maxTokens', 'presencePenalty',
      'frequencyPenalty', 'seed', 'stop',
    ]);
    expect(paths('image.generate')).toEqual([
      'negative_prompt', 'n', 'size', 'aspect_ratio', 'quality', 'style', 'seed', 'response_format',
    ]);
    expect(paths('video.generate')).toEqual([
      'negative_prompt', 'options.resolution', 'options.ratio', 'options.durationSec',
      'options.frames', 'options.fps', 'options.seed', 'options.cameraFixed',
      'options.watermark', 'options.generateAudio', 'options.draft', 'options.serviceTier',
      'options.executionExpiresAfterSec', 'options.returnLastFrame',
    ]);
    expect(paths('audio.synthesize')).toEqual([
      'language', 'audio_format', 'sample_rate_hz', 'speed', 'pitch', 'volume', 'emotion',
      'timing_mode', 'voice_render_hints.stability', 'voice_render_hints.similarity_boost',
      'voice_render_hints.style', 'voice_render_hints.use_speaker_boost', 'voice_render_hints.speed',
    ]);
    expect(paths('audio.transcribe')).toEqual([
      'mime_type', 'language', 'timestamps', 'diarization', 'speaker_count', 'prompt', 'response_format',
    ]);
    expect(CAPABILITY_DEFAULT_FIELDS['text.embed']).toBeUndefined();
    expect(CAPABILITY_DEFAULT_FIELDS['voice_workflow.voice_clone']).toBeUndefined();
    expect(CAPABILITY_DEFAULT_FIELDS['voice_workflow.voice_design']).toBeUndefined();
  });

  it.each([
    'text.embed',
    'voice_workflow.voice_clone',
    'voice_workflow.voice_design',
  ])('does not render defaults for Runtime-rejected %s intents', async (capabilityContract) => {
    const node = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      capabilityContracts: [capabilityContract],
      capabilities: [createNimiLocalAIConfigCapabilityIntent({ capabilityContract })],
      initialCapabilityContract: capabilityContract,
    });

    expect(node.querySelector('[data-nimi-model-config-defaults]')).toBeNull();
    expect(node.textContent).not.toContain('Default parameters');
  });

  it('projects selected, broken, and feature-mismatch machine context without owning it', () => {
    const selections = projectModelConfigLocalSelections({
      selections: [
        { capabilityContract: 'text.generate', configurationId: 'text-local' },
        {
          capabilityContract: 'audio.transcribe',
          configurationId: 'missing',
          effectiveDefaults: { language: 'stale' },
        },
      ],
      configurations: [{
        configurationId: 'text-local',
        capabilityContract: 'text.generate',
        displayName: 'Local text',
        supportedFeatures: ['json.output'],
        interpretability: 'interpretable',
        requirementResolution: 'configured',
        reasons: [],
      }],
    });

    expect(selections.map((entry) => entry.state)).toEqual(['selected', 'broken']);
    const intent = {
      capabilityContract: 'text.generate',
      requiredFeatures: ['json.output', 'tool.use'],
      defaults: undefined,
      route: { oneofKind: 'local' as const, local: {} },
    };
    expect(modelConfigMissingRequiredFeatures(intent, selections[0])).toEqual(['tool.use']);
    expect(modelConfigCapabilityPosture(intent, selections[0])).toBe('local-feature-mismatch');
    expect(selections[0]?.effectiveDefaults).toBeNull();
    expect(selections[1]?.effectiveDefaults).toBeNull();
  });

  it('fails closed when a reloaded Cloud intent lacks exact catalog identity', () => {
    const incomplete = createNimiCloudAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
      providerModelTarget: {
        provider: 'provider-test',
        providerModelId: 'cloud-model',
        remoteModelCatalogId: 'rmc-cloud-model',
      },
    });
    if (incomplete.route.oneofKind !== 'cloud') throw new Error('expected Cloud intent fixture');
    delete incomplete.route.cloud.providerModelTarget!.fields.remoteModelCatalogId;
    expect(modelConfigCapabilityPosture(incomplete, null)).toBe('not-configured');
  });

  it('opens an explicitly requested capability detail on first mount', async () => {
    const node = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      initialCapabilityContract: 'text.generate',
    });

    expect(node.querySelector('[data-nimi-model-config-detail="text.generate"]')).toBeTruthy();
    expect(node.querySelector('[data-testid="model-config-model-trigger:text.generate"]')).toBeTruthy();
  });

  it('keeps a third-party App read-only and hands configuration to the Nimi owner surface', async () => {
    const onOpenOwnerConfiguration = vi.fn();
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => undefined);
    const node = await renderSurface(onOverwrite, vi.fn(), {
      cloudAIConfig: undefined,
      consumer: 'third-party-app',
      initialCapabilityContract: 'text.generate',
      onOpenOwnerConfiguration,
    });

    expect(node.querySelector('[data-nimi-model-config-read-only="true"]')).toBeTruthy();
    expect(node.querySelector('[data-testid="model-config-model-trigger:text.generate"]')).toBeNull();
    expect(node.querySelector('[data-testid="model-config-save:text.generate"]')).toBeNull();
    act(() => { (node.querySelector('[data-nimi-model-config-owner-handoff="true"]') as HTMLButtonElement).click(); });
    expect(onOpenOwnerConfiguration).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('can switch consumer ownership without changing one component hook order', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const capability = {
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      defaults: undefined,
      route: { oneofKind: 'local' as const, local: {} },
    };
    const localSelections = [{
      capabilityContract: 'text.generate',
      state: 'selected' as const,
      configurationId: 'machine-text',
      displayName: 'Machine text model',
      supportedFeatures: [],
      reasons: [],
      effectiveDefaults: null,
    }];
    const renderConsumer = async (consumer: 'nimi-first-party' | 'third-party-app') => {
      await act(async () => {
        root?.render(
          <ModelConfigAIConfigSurface
            context={{ owner: 'app-ai-config', consumer, appId: 'test.app' }}
            capabilityContracts={['text.generate']}
            initialCapabilityContract="text.generate"
            capabilities={[capability]}
            localSelections={localSelections}
            onOverwrite={async () => undefined}
          />,
        );
        await Promise.resolve();
      });
    };

    await renderConsumer('third-party-app');
    expect(container.querySelector('[data-nimi-model-config-read-only="true"]')).toBeTruthy();
    await renderConsumer('nimi-first-party');
    expect(container.querySelector('[data-testid="model-config-model-trigger:text.generate"]')).toBeTruthy();
  });

  it('commits canonical App AIConfig intent through the owner callback', async () => {
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => undefined);
    const node = await renderSurface(onOverwrite);
    const boundary = node.querySelector('[data-nimi-model-config-owner]') as HTMLElement;
    expect(boundary.getAttribute('data-nimi-model-config-owner')).toBe('app-ai-config');
    expect(boundary.getAttribute('data-nimi-model-config-app-id')).toBe('test.app');

    const capability = node.querySelector(
      '[data-nimi-model-config-capability="text.generate"]',
    ) as HTMLButtonElement;
    act(() => { capability.click(); });

    const save = node.querySelector(
      '[data-testid="model-config-save:text.generate"]',
    ) as HTMLButtonElement;
    await act(async () => { save.click(); await Promise.resolve(); });

    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onOverwrite.mock.calls[0]?.[0]).toEqual([{
      capabilityContract: 'text.generate',
      requiredFeatures: [],
      defaults: undefined,
      route: { oneofKind: 'local', local: {} },
    }]);
    expect(JSON.stringify(onOverwrite.mock.calls[0]?.[0])).not.toMatch(/modelId|targetRef|configurationId/u);
  });

  it('shows Driver-owned Local defaults and provider-owned Cloud placeholders without setting keys', async () => {
    const local = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      initialCapabilityContract: 'text.generate',
    });
    const localTemperature = local.querySelector('[data-nimi-default-parameter="temperature"] input') as HTMLInputElement;
    const localSeed = local.querySelector('[data-nimi-default-parameter="seed"] input') as HTMLInputElement;
    expect(localTemperature.placeholder).toBe('Not set · Engine default 0.8');
    expect(localSeed.placeholder).toBe('Not set · Engine default random');
    expect(localTemperature.value).toBe('');

    if (root) act(() => root?.unmount());
    local.remove();
    root = null;
    container = null;
    const cloud = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      capabilities: [createNimiCloudAIConfigCapabilityIntent({
        capabilityContract: 'text.generate',
        implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
        providerModelTarget: {
          provider: 'provider-test',
          providerModelId: 'cloud-model',
          remoteModelCatalogId: 'rmc-cloud-model',
        },
      })],
    });
    const cloudTemperature = cloud.querySelector('[data-nimi-default-parameter="temperature"] input') as HTMLInputElement;
    expect(cloudTemperature.placeholder).toBe('Not set · Provider decides');
    expect(cloudTemperature.value).toBe('');
  });

  it('saves typed defaults with explicit zero and false while dropping unknown keys', async () => {
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => undefined);
    const intent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'video.generate',
      defaults: {
        negativePrompt: 'blur',
        unknown: 'drop-me',
        options: { seed: 0, generate_audio: false, unknown: true },
      },
    });
    const node = await renderSurface(onOverwrite, vi.fn(), {
      capabilityContracts: ['video.generate'],
      capabilities: [intent],
      initialCapabilityContract: 'video.generate',
    });

    const defaults = node.querySelector('[data-nimi-model-config-defaults="video.generate"]') as HTMLDetailsElement;
    expect(defaults).toBeTruthy();
    act(() => { defaults.open = true; defaults.dispatchEvent(new Event('toggle', { bubbles: true })); });
    const seed = node.querySelector('[data-nimi-default-parameter="options.seed"] input') as HTMLInputElement;
    const generateAudio = node.querySelector('button[aria-label="options.generateAudio"]') as HTMLButtonElement;
    expect(seed.value).toBe('0');
    expect(generateAudio.textContent).toContain('False');

    const save = node.querySelector('[data-testid="model-config-save:video.generate"]') as HTMLButtonElement;
    await act(async () => { save.click(); await Promise.resolve(); });

    const saved = onOverwrite.mock.calls[0]?.[0][0];
    expect(saved).toBeTruthy();
    expect(runtimeAIConfigStructToJson(saved?.defaults)).toEqual({
      negative_prompt: 'blur',
      options: { seed: 0, generateAudio: false },
    });
  });

  it('restores the model hub and delegates Local model changes to Machine Local AI', async () => {
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => undefined);
    const onOpenMachineConfiguration = vi.fn();
    const node = await renderSurface(onOverwrite, onOpenMachineConfiguration);

    expect(node.textContent).toContain('Models');
    expect(node.textContent).toContain('Machine text model');
    expect(node.textContent).not.toContain('Default parameters');
    expect(node.textContent).not.toContain('Required features');

    const capability = node.querySelector(
      '[data-nimi-model-config-capability="text.generate"]',
    ) as HTMLButtonElement;
    act(() => { capability.click(); });
    expect(node.textContent).toContain('Default parameters');
    expect(node.textContent).not.toContain('Required features');
    const trigger = node.querySelector(
      '[data-testid="model-config-model-trigger:text.generate"]',
    ) as HTMLButtonElement;
    expect(trigger.textContent).toContain('Machine text model');
    act(() => { trigger.click(); });
    await flush();

    const routePicker = document.body.querySelector(
      '[data-nimi-model-picker-presentation="route"]',
    ) as HTMLElement;
    expect(routePicker.textContent).toContain('On-device');
    expect(routePicker.textContent).toContain('Cloud');
    const openMachine = Array.from(routePicker.querySelectorAll('button')).find((button) => (
      button.textContent?.trim() === 'Open on-device models'
    )) as HTMLButtonElement;
    act(() => { openMachine.click(); });

    expect(onOpenMachineConfiguration).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('loads Cloud targets only after choosing a configured Connector', async () => {
    const listImplementations = vi.fn(async () => [
      {
        optionId: 'cloud-test',
        label: 'Cloud Test',
        provider: 'provider-test',
        implementation: {
          implementationId: 'cloud-test',
          driverId: 'nimillm',
          driverDialect: 'openai',
        },
      },
      {
        optionId: 'cloud-other',
        label: 'Cloud Other',
        provider: 'provider-other',
        implementation: {
          implementationId: 'cloud-other',
          driverId: 'nimillm',
          driverDialect: 'openai',
        },
      },
    ]);
    const listTargets = vi.fn(async () => [{
      targetId: 'cloud-model',
      label: 'Cloud Model',
      provider: 'provider-test',
      providerModelTarget: {
        provider: 'provider-test',
        providerModelId: 'cloud-model',
        remoteModelCatalogId: 'rmc-cloud-model',
      },
    }]);
    const node = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      cloudAIConfig: {
        listImplementations,
        listTargets,
        listAuthorizationOptions: async () => ({
          connectors: [{ connectorId: 'connector-test', label: 'Work account', provider: 'provider-test' }],
        }),
      },
    });

    act(() => {
      (node.querySelector('[data-nimi-model-config-capability="text.generate"]') as HTMLButtonElement).click();
    });
    act(() => {
      (node.querySelector('[data-testid="model-config-model-trigger:text.generate"]') as HTMLButtonElement).click();
    });
    await flush();
    const cloud = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cloud') as HTMLButtonElement;
    act(() => { cloud.click(); });
    await flush();

    expect(document.body.querySelector('[data-nimi-model-picker-source="cloud"]')).toBeNull();
    expect(listImplementations).not.toHaveBeenCalled();
    expect(listTargets).not.toHaveBeenCalled();

    await selectField(document.body, 'Cloud Connector', 'Work account');
    expect(listImplementations).toHaveBeenCalledWith('text.generate');
    expect(listTargets).toHaveBeenCalledWith({
      capabilityContract: 'text.generate',
      provider: 'provider-test',
      connectorId: 'connector-test',
    });
    expect(document.body.querySelector('[data-nimi-model-picker-source="cloud"]')?.textContent).toContain('Cloud Model');
  });

  it('fails closed with no configured Connector and delegates Cloud setup', async () => {
    const onOpenCloudConnectorConfiguration = vi.fn();
    const listTargets = vi.fn(async () => []);
    const node = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      onOpenCloudConnectorConfiguration,
      cloudAIConfig: {
        listImplementations: vi.fn(async () => []),
        listTargets,
        listAuthorizationOptions: async () => ({ connectors: [] }),
      },
    });

    act(() => {
      (node.querySelector('[data-nimi-model-config-capability="text.generate"]') as HTMLButtonElement).click();
    });
    act(() => {
      (node.querySelector('[data-testid="model-config-model-trigger:text.generate"]') as HTMLButtonElement).click();
    });
    await flush();
    const cloud = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cloud') as HTMLButtonElement;
    act(() => { cloud.click(); });
    await flush();

    expect(document.body.textContent).toContain('No configured Cloud Connector is available.');
    expect(document.body.querySelector('[data-nimi-model-picker-source="cloud"]')).toBeNull();
    expect(listTargets).not.toHaveBeenCalled();
    const configure = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Configure Cloud Connectors') as HTMLButtonElement;
    act(() => { configure.click(); });
    expect(onOpenCloudConnectorConfiguration).toHaveBeenCalledTimes(1);
  });
});
