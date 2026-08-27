import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiAIConfigEffectiveSelection,
  type NimiCapabilityAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import { CAPABILITY_DEFAULT_FIELDS } from '../src/capability-defaults.js';
import { ModelConfigAIConfigSurface } from '../src/components/model-config-ai-config-surface.js';
import type { ModelConfigListOptions, ModelConfigOverwrite } from '../src/types.js';
import {
  modelConfigCapabilityPosture,
  modelConfigMissingRequiredFeatures,
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
  onOpenMachineLoadout = vi.fn(),
  options: {
    readonly listOptions?: ModelConfigListOptions;
    readonly initialCapabilityContract?: string;
    readonly onOpenOwnerConfiguration?: () => void;
    readonly capabilityContracts?: readonly string[];
    readonly allowedRoutes?: readonly ('local' | 'cloud')[];
    readonly capabilities?: readonly NimiCapabilityAIConfigIntent[];
    readonly effectiveSelections?: readonly NimiAIConfigEffectiveSelection[] | null;
    readonly loading?: boolean;
    readonly loadError?: string | null;
    readonly capabilitiesUnavailable?: boolean;
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', appId: 'test.app' }}
        capabilityContracts={options.capabilityContracts || ['text.generate']}
        allowedRoutes={options.allowedRoutes}
        initialCapabilityContract={options.initialCapabilityContract}
        capabilities={options.capabilitiesUnavailable ? undefined : options.capabilities || [{
          capabilityContract: 'text.generate',
          requiredFeatures: [],
          defaults: undefined,
          route: { oneofKind: 'local', local: {} },
        }]}
        revision="1"
        listOptions={options.listOptions || (async (query) => query.kind === 'local-loadouts' ? ({
          kind: query.kind, options: [{
            loadoutRef: 'machine-text',
            label: 'Machine text model',
            capabilityContract: 'text.generate',
            implementation: { implementationId: 'local-text', driverId: 'local', driverDialect: 'test/local/v1' },
            state: 'ready',
            supportedFeatures: [],
            reasons: [],
          }], truncated: false,
        }) : query.kind === 'cloud-connectors' ? ({
          kind: query.kind,
          options: [{ connectorRef: 'connector-test', label: 'Test account', provider: 'provider-test', state: 'ready', reasons: [] }],
          truncated: false,
        }) : ({
          kind: query.kind,
          options: [{
            connectorRef: query.connectorRef, label: 'Cloud Model', capabilityContract: query.capabilityContract,
            implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
            providerModelTarget: { provider: 'provider-test', providerModelId: 'cloud-model', remoteModelCatalogId: 'rmc-cloud-model' },
            supportedFeatures: [], state: 'ready', reasons: [],
          }],
          truncated: false,
        }))}
        effectiveSelections={options.effectiveSelections === null ? undefined : options.effectiveSelections || [{
          capabilityContract: 'text.generate',
          state: 'ready',
          resource: {
            oneofKind: 'local',
            local: {
              loadoutRef: 'machine-text',
              label: 'Machine text model',
              capabilityContract: 'text.generate',
              implementation: { implementationId: 'local-text', driverId: 'local', driverDialect: 'test/local/v1' },
              supportedFeatures: [],
              state: 'ready',
              reasons: [],
            },
          },
          reasons: [],
        }]}
        loading={options.loading}
        loadError={options.loadError}
        onOpenMachineLoadout={onOpenMachineLoadout}
        onOpenOwnerConfiguration={options.onOpenOwnerConfiguration}
        onOverwrite={onOverwrite}
      />,
    );
    await Promise.resolve();
  });
  return container;
}

function committedOverwrite() {
  return vi.fn(async (input: Parameters<ModelConfigOverwrite>[0]) => ({
    outcome: 'committed' as const,
    config: { capabilities: [...input.capabilities] },
    revision: '2',
  }));
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
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      capabilityContracts: [capabilityContract],
      capabilities: [createNimiLocalAIConfigCapabilityIntent({
        capabilityContract,
      })],
      initialCapabilityContract: capabilityContract,
    });

    expect(node.querySelector('[data-nimi-model-config-defaults]')).toBeNull();
    expect(node.textContent).not.toContain('Default parameters');
  });

  it('derives feature mismatch from the host-supplied bounded selection projection', () => {
    const selection: NimiAIConfigEffectiveSelection = {
      capabilityContract: 'text.generate',
      state: 'ready',
      resource: {
        oneofKind: 'local',
        local: {
          loadoutRef: 'text-local',
          label: 'Local text',
          capabilityContract: 'text.generate',
          implementation: { implementationId: 'text-local', driverId: 'local', driverDialect: 'test/local/v1' },
          supportedFeatures: ['json.output'],
          state: 'ready',
          reasons: [],
        },
      },
      reasons: [],
    };
    const intent = {
      capabilityContract: 'text.generate',
      requiredFeatures: ['json.output', 'tool.use'],
      defaults: undefined,
      route: { oneofKind: 'local' as const, local: {} },
    };
    expect(modelConfigMissingRequiredFeatures(intent, selection)).toEqual(['tool.use']);
    expect(modelConfigCapabilityPosture(intent, selection)).toBe('local-feature-mismatch');
  });

  it('keeps a shared local intent configured when machine Loadouts are not observable', () => {
    const intent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      requiredFeatures: [],
    });

    expect(modelConfigCapabilityPosture(intent, undefined)).toBe('local-configured');
    expect(modelConfigCapabilityPosture(intent, null)).toBe('local-configuration-unavailable');
  });

  it.each([
    ['missing', 'cloud-selection-missing'],
    ['blocked', 'cloud-configuration-blocked'],
    ['unavailable', 'cloud-configuration-unavailable'],
  ] as const)('projects an observed Cloud %s state without reporting it configured', (state, posture) => {
    const intent = createNimiCloudAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      connectorRef: 'connector-test',
      implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
      providerModelTarget: {
        provider: 'provider-test',
        providerModelId: 'cloud-model',
        remoteModelCatalogId: 'rmc-cloud-model',
      },
    });
    expect(modelConfigCapabilityPosture(intent, {
      capabilityContract: 'text.generate',
      state,
      resource: null,
      reasons: ['test-reason'],
    })).toBe(posture);
  });

  it('fails closed when a reloaded Cloud intent lacks exact catalog identity', () => {
    const incomplete = createNimiCloudAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      connectorRef: 'connector-test',
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
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
    });

    expect(node.querySelector('[data-nimi-model-config-detail="text.generate"]')).toBeTruthy();
    expect(node.querySelector('[data-testid="model-config-model-trigger:text.generate"]')).toBeTruthy();
  });

  it('lets a covered third-party App edit through the same manager and keeps Desktop handoff optional', async () => {
    const onOpenOwnerConfiguration = vi.fn();
    const onOverwrite = committedOverwrite();
    const node = await renderSurface(onOverwrite, vi.fn(), {
      initialCapabilityContract: 'text.generate',
      onOpenOwnerConfiguration,
    });

    expect(node.querySelector('[data-nimi-model-config-read-only="true"]')).toBeNull();
    expect(node.querySelector('[data-testid="model-config-model-trigger:text.generate"]')).toBeTruthy();
    expect(node.querySelector('[data-testid="model-config-save:text.generate"]')).toBeTruthy();
    expect(node.querySelector('[data-nimi-model-config-owner-handoff="true"]')).toBeNull();
    expect(onOpenOwnerConfiguration).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('lets an App product narrow the editor to Local without querying or exposing Cloud choices', async () => {
    const listOptions = vi.fn(async () => ({
      kind: 'local-loadouts',
      options: [],
      truncated: false,
    })) as unknown as ModelConfigListOptions;
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      allowedRoutes: ['local'],
      listOptions,
    });

    const trigger = node.querySelector('[data-testid="model-config-model-trigger:text.generate"]') as HTMLButtonElement;
    await act(async () => { trigger.click(); await Promise.resolve(); });
    await flush();

    expect(document.body.textContent).not.toContain('Cloud');
    expect(listOptions).not.toHaveBeenCalled();
  });

  it('keeps a new Local route neutral until its committed effective projection exists', async () => {
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      allowedRoutes: ['local'],
      capabilities: [],
      effectiveSelections: [],
    });

    const trigger = node.querySelector('[data-testid="model-config-model-trigger:text.generate"]') as HTMLButtonElement;
    await act(async () => { trigger.click(); await Promise.resolve(); });
    await flush();

    const picker = document.body.querySelector(
      '[data-nimi-model-picker-presentation="route"]',
    ) as HTMLElement;
    expect(picker.textContent).toContain('Use the model selected under On-device models.');
    expect(picker.textContent).not.toContain('The on-device model selection could not be loaded.');

    const local = picker.querySelector('[data-nimi-model-picker-source="local"]') as HTMLButtonElement;
    await act(async () => { local.click(); await Promise.resolve(); });
    await flush();
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Use selection',
    ) as HTMLButtonElement;
    await act(async () => { confirm.click(); await Promise.resolve(); });
    await flush();

    expect(node.textContent).toContain('Use the model selected under On-device models.');
    expect(node.textContent).not.toContain('The on-device model selection could not be loaded.');
  });

  it('commits canonical App AIConfig intent through the owner callback', async () => {
    const onOverwrite = committedOverwrite();
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
    expect(onOverwrite.mock.calls[0]?.[0]).toEqual({
      expectedRevision: '1',
      capabilities: [{
        capabilityContract: 'text.generate',
        requiredFeatures: [],
        route: { oneofKind: 'local', local: {} },
      }],
    });
    expect(JSON.stringify(onOverwrite.mock.calls[0]?.[0])).not.toMatch(/modelId|targetRef|loadoutId/u);
  });

  it('clears one capability by omitting it from the same whole-object CAS Save', async () => {
    const onOverwrite = committedOverwrite();
    const sibling = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'audio.transcribe',
    });
    const node = await renderSurface(onOverwrite, vi.fn(), {
      capabilityContracts: ['text.generate', 'audio.transcribe'],
      capabilities: [
        createNimiLocalAIConfigCapabilityIntent({
          capabilityContract: 'text.generate',
        }),
        sibling,
      ],
      initialCapabilityContract: 'text.generate',
    });

    const clear = node.querySelector('[data-testid="model-config-clear:text.generate"]') as HTMLButtonElement;
    await act(async () => { clear.click(); await Promise.resolve(); });

    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onOverwrite.mock.calls[0]?.[0]).toEqual({
      expectedRevision: '1',
      capabilities: [sibling],
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the last-known edit base visible during a failed background refresh', async () => {
    const onOverwrite = committedOverwrite();
    const sibling = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'audio.transcribe',
    });
    const node = await renderSurface(onOverwrite, vi.fn(), {
      capabilityContracts: ['text.generate', 'audio.transcribe'],
      capabilities: [
        createNimiLocalAIConfigCapabilityIntent({
          capabilityContract: 'text.generate',
        }),
        sibling,
      ],
      initialCapabilityContract: 'text.generate',
      loading: true,
      loadError: 'Refresh failed',
    });

    expect(node.textContent).toContain('Refresh failed');
    expect(node.querySelector('[data-nimi-model-config-detail="text.generate"]')).toBeTruthy();
    expect(node.querySelector('.nimi-skeleton')).toBeNull();

    const clear = node.querySelector('[data-testid="model-config-clear:text.generate"]') as HTMLButtonElement;
    await act(async () => { clear.click(); await Promise.resolve(); });
    expect(onOverwrite.mock.calls[0]?.[0].capabilities).toEqual([sibling]);
  });

  it('does not project an unavailable initial read as not configured', async () => {
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      capabilitiesUnavailable: true,
      loadError: 'Initial read failed',
    });

    expect(node.textContent).toContain('Initial read failed');
    expect(node.textContent).not.toContain('Not configured');
    expect(node.querySelector('[data-nimi-model-config-detail="text.generate"]')).toBeNull();
    expect(node.querySelector('[data-nimi-model-config-capability-grid]')).toBeNull();
    expect(node.querySelector('[data-testid="model-config-save:text.generate"]')).toBeNull();
  });

  it('does not present an absent or non-Local effective projection as a missing machine selection', async () => {
    const absent = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      effectiveSelections: [],
    });
    expect(absent.textContent).toContain('The on-device model selection could not be loaded.');
    expect(absent.textContent).not.toContain('No on-device model is selected for this capability.');

    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;

    const nonLocal = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      effectiveSelections: [{
        capabilityContract: 'text.generate',
        state: 'ready',
        resource: {
          oneofKind: 'cloud',
          cloud: {
            connector: {
              connectorRef: 'connector-test', label: 'Test account', provider: 'provider-test', state: 'ready', reasons: [],
            },
            target: {
              connectorRef: 'connector-test', label: 'Cloud Model', capabilityContract: 'text.generate',
              implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
              providerModelTarget: { provider: 'provider-test', providerModelId: 'cloud-model', remoteModelCatalogId: 'rmc-cloud-model' },
              supportedFeatures: [], state: 'ready', reasons: [],
            },
          },
        },
        reasons: [],
      }],
    });
    expect(nonLocal.textContent).toContain('The on-device model selection could not be loaded.');
    expect(nonLocal.textContent).not.toContain('No on-device model is selected for this capability.');
  });

  it('preserves the local draft after CAS conflict and retries with the returned revision', async () => {
    const calls: Parameters<ModelConfigOverwrite>[0][] = [];
    const initialIntent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      defaults: { temperature: 0.2 },
    });
    const concurrentIntent = createNimiLocalAIConfigCapabilityIntent({
      capabilityContract: 'text.generate',
      defaults: { temperature: 0.4 },
    });

    function ConflictHarness() {
      const [snapshot, setSnapshot] = useState({
        capabilities: [initialIntent],
        revision: '1',
      });
      const overwrite: ModelConfigOverwrite = async (input) => {
        calls.push(input);
        if (calls.length === 1) {
          setSnapshot({ capabilities: [concurrentIntent], revision: '2' });
          return {
            outcome: 'conflict',
            config: { capabilities: [concurrentIntent] },
            revision: '2',
            reasonCode: 'AI_CONFIG_REVISION_CONFLICT',
          };
        }
        setSnapshot({ capabilities: [...input.capabilities], revision: '3' });
        return {
          outcome: 'committed',
          config: { capabilities: [...input.capabilities] },
          revision: '3',
        };
      };
      return (
        <ModelConfigAIConfigSurface
          context={{ owner: 'app-ai-config', appId: 'test.app' }}
          capabilityContracts={['text.generate']}
          initialCapabilityContract="text.generate"
          capabilities={snapshot.capabilities}
          revision={snapshot.revision}
          effectiveSelections={[]}
          listOptions={async (query) => ({ kind: query.kind, options: [], truncated: false }) as never}
          onOverwrite={overwrite}
        />
      );
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root?.render(<ConflictHarness />); await Promise.resolve(); });

    const temperature = container.querySelector(
      '[data-nimi-default-parameter="temperature"] input',
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(temperature, '0.7');
      temperature.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    expect(temperature.value).toBe('0.7');

    const save = container.querySelector('[data-testid="model-config-save:text.generate"]') as HTMLButtonElement;
    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();
    expect(container.textContent).toContain('Configuration changed elsewhere');
    expect(container.textContent).toContain('Current revision 2: On-device');
    expect(temperature.value).toBe('0.7');

    await act(async () => { save.click(); await Promise.resolve(); });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.expectedRevision).toBe('2');
    expect(runtimeAIConfigStructToJson(calls[1]?.capabilities[0]?.defaults)).toEqual({ temperature: 0.7 });
  });

  it('keeps unset defaults route-neutral without inventing effective values', async () => {
    const local = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
    });
    const localTemperature = local.querySelector('[data-nimi-default-parameter="temperature"] input') as HTMLInputElement;
    const localSeed = local.querySelector('[data-nimi-default-parameter="seed"] input') as HTMLInputElement;
    expect(localTemperature.placeholder).toBe('Not set');
    expect(localSeed.placeholder).toBe('Not set');
    expect(localTemperature.value).toBe('');

    if (root) act(() => root?.unmount());
    local.remove();
    root = null;
    container = null;
    const cloud = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      capabilities: [createNimiCloudAIConfigCapabilityIntent({
        capabilityContract: 'text.generate',
        connectorRef: 'connector-test',
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
    const onOverwrite = committedOverwrite();
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

    const saved = onOverwrite.mock.calls[0]?.[0].capabilities[0];
    expect(saved).toBeTruthy();
    expect(runtimeAIConfigStructToJson(saved?.defaults)).toEqual({
      negative_prompt: 'blur',
      options: { seed: 0, generateAudio: false },
    });
  });

  it('restores the model hub and delegates Local model changes to machine Loadouts', async () => {
    const onOverwrite = committedOverwrite();
    const onOpenMachineLoadout = vi.fn();
    const node = await renderSurface(onOverwrite, onOpenMachineLoadout);

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

    expect(onOpenMachineLoadout).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('loads Cloud targets only after choosing a configured Connector', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => {
      if (query.kind === 'local-loadouts') return { kind: query.kind, options: [], truncated: false };
      if (query.kind === 'cloud-connectors') return {
        kind: query.kind,
        options: [{ connectorRef: 'connector-test', label: 'Work account', provider: 'provider-test', state: 'ready', reasons: [] }],
        truncated: false,
      };
      return {
        kind: query.kind,
        options: [{
          connectorRef: query.connectorRef, label: 'Cloud Model', capabilityContract: query.capabilityContract,
          implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
          providerModelTarget: { provider: 'provider-test', providerModelId: 'cloud-model', remoteModelCatalogId: 'rmc-cloud-model' },
          supportedFeatures: [], state: 'ready', reasons: [],
        }],
        truncated: false,
      };
    });
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      listOptions,
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
    expect(listOptions.mock.calls.some(([query]) => query.kind === 'cloud-targets')).toBe(false);

    await selectField(document.body, 'Cloud Connector', 'Work account');
    expect(listOptions).toHaveBeenCalledWith({
      kind: 'cloud-targets', capabilityContract: 'text.generate', connectorRef: 'connector-test',
    });
    expect(document.body.querySelector('[data-nimi-model-picker-source="cloud"]')?.textContent).toContain('Cloud Model');
  });

  it('keeps Connector-scoped Cloud targets distinct when they share one remote catalog', async () => {
    const onOverwrite = committedOverwrite();
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => {
      if (query.kind === 'local-loadouts') return { kind: query.kind, options: [], truncated: false };
      if (query.kind === 'cloud-connectors') return {
        kind: query.kind,
        options: [{ connectorRef: 'connector-dashscope', label: 'DashScope', provider: 'dashscope', state: 'ready', reasons: [] }],
        truncated: false,
      };
      const target = (providerModelId: string) => ({
        connectorRef: query.connectorRef,
        label: providerModelId,
        capabilityContract: query.capabilityContract,
        implementation: { implementationId: 'dashscope', driverId: 'nimillm', driverDialect: 'dashscope' },
        providerModelTarget: {
          provider: 'dashscope',
          providerModelId,
          remoteModelCatalogId: 'remote-model-catalog-dashscope',
        },
        supportedFeatures: [],
        state: 'ready' as const,
        reasons: [],
      });
      return {
        kind: query.kind,
        options: [target('qwen3-tts-flash'), target('qwen3-tts-flash-2025-11-27')],
        truncated: false,
      };
    });
    const node = await renderSurface(onOverwrite, vi.fn(), {
      listOptions,
      initialCapabilityContract: 'audio.synthesize',
      capabilityContracts: ['audio.synthesize'],
      capabilities: [],
      effectiveSelections: null,
      allowedRoutes: ['cloud'],
    });

    act(() => {
      (node.querySelector('[data-testid="model-config-model-trigger:audio.synthesize"]') as HTMLButtonElement).click();
    });
    await flush();
    await selectField(document.body, 'Cloud Connector', 'DashScope');

    const selectedTarget = Array.from(document.body.querySelectorAll(
      '[data-nimi-model-picker-source="cloud"]',
    )).find((entry) => entry.textContent?.includes('qwen3-tts-flash-2025-11-27')) as HTMLButtonElement;
    expect(selectedTarget).toBeTruthy();
    act(() => { selectedTarget.click(); });
    const confirm = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Use selection') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    act(() => { confirm.click(); });
    await flush();

    act(() => {
      (node.querySelector('[data-testid="model-config-save:audio.synthesize"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(onOverwrite).toHaveBeenCalledTimes(1);
    const saved = onOverwrite.mock.calls[0]?.[0].capabilities.find(
      (intent) => intent.capabilityContract === 'audio.synthesize',
    );
    expect(saved?.route.oneofKind).toBe('cloud');
    expect(runtimeAIConfigStructToJson(
      saved?.route.oneofKind === 'cloud' ? saved.route.cloud.providerModelTarget : undefined,
    )).toMatchObject({
      provider: 'dashscope',
      providerModelId: 'qwen3-tts-flash-2025-11-27',
      remoteModelCatalogId: 'remote-model-catalog-dashscope',
    });
  });

  it('keeps a persisted Cloud intent configured without inventing Connector ownership', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async () => ({ kind: 'local-loadouts', options: [], truncated: false }));
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      initialCapabilityContract: 'text.generate',
      capabilities: [createNimiCloudAIConfigCapabilityIntent({
        capabilityContract: 'text.generate',
        connectorRef: 'connector-test',
        implementation: { implementationId: 'cloud-test', driverId: 'nimillm', driverDialect: 'openai' },
        providerModelTarget: {
          provider: 'provider-test',
          providerModelId: 'cloud-model',
          remoteModelCatalogId: 'rmc-cloud-model',
        },
      })],
      effectiveSelections: null,
      listOptions,
    });
    await flush();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(listOptions).not.toHaveBeenCalled();
    const trigger = node.querySelector('[data-testid="model-config-model-trigger:text.generate"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain('set up');
    expect(trigger.textContent).not.toContain('setup needed');
    expect(node.textContent).toContain('connector-test');
  });

  it('fails closed with no configured Connector without adding a permission handoff', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => ({
      kind: query.kind,
      options: [],
      truncated: false,
    }) as never);
    const node = await renderSurface(committedOverwrite(), vi.fn(), {
      listOptions,
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
    expect(document.body.textContent).not.toContain('permission');
  });

  it('applies the kit focus ring to capability grid and machine loadout link buttons', async () => {
    const node = await renderSurface(committedOverwrite());
    const capability = node.querySelector(
      '[data-nimi-model-config-capability="text.generate"]',
    ) as HTMLButtonElement;
    expect(capability.className).toContain('focus-visible:ring');

    act(() => { capability.click(); });
    await flush();

    const openMachine = Array.from(node.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Open on-device models') as HTMLButtonElement;
    expect(openMachine).toBeTruthy();
    expect(openMachine.className).toContain('focus-visible:ring');
  });
});
