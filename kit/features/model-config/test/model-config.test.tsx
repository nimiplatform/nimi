import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    readonly onOpenCloudConnectorConfiguration?: () => void;
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ModelConfigAIConfigSurface
        context={{ owner: 'app-ai-config', consumer: 'nimi-first-party', appId: 'test.app' }}
        capabilityContracts={['text.generate']}
        capabilities={[{
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
        }]}
        cloudAIConfig={options.cloudAIConfig || {
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
            providerModelTarget: { provider: 'provider-test', providerModelId: 'cloud-model' },
          }],
          listAuthorizationOptions: async () => ({
            connectors: [{ connectorId: 'connector-test', label: 'Test account', provider: 'provider-test' }],
            grants: [],
          }),
          createGrant: async () => ({
            grantId: 'grant-test',
            connectorId: 'connector-test',
            status: 'active',
            createdAt: '2026-08-07T00:00:00.000Z',
            revokedAt: null,
          }),
        }}
        onOpenMachineConfiguration={onOpenMachineConfiguration}
        onOpenCloudConnectorConfiguration={options.onOpenCloudConnectorConfiguration}
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
  it('projects selected, broken, and feature-mismatch machine context without owning it', () => {
    const selections = projectModelConfigLocalSelections({
      selections: [
        { capabilityContract: 'text.generate', configurationId: 'text-local' },
        { capabilityContract: 'audio.transcribe', configurationId: 'missing' },
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

  it('restores the model hub and delegates Local model changes to Machine Local AI', async () => {
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => undefined);
    const onOpenMachineConfiguration = vi.fn();
    const node = await renderSurface(onOverwrite, onOpenMachineConfiguration);

    expect(node.textContent).toContain('AI Model');
    expect(node.textContent).toContain('Machine text model');
    expect(node.textContent).not.toContain('Portable defaults');
    expect(node.textContent).not.toContain('Required features');

    const capability = node.querySelector(
      '[data-nimi-model-config-capability="text.generate"]',
    ) as HTMLButtonElement;
    act(() => { capability.click(); });
    const trigger = node.querySelector(
      '[data-testid="model-config-model-trigger:text.generate"]',
    ) as HTMLButtonElement;
    expect(trigger.textContent).toContain('Machine text model');
    act(() => { trigger.click(); });
    await flush();

    const routePicker = document.body.querySelector(
      '[data-nimi-model-picker-presentation="route"]',
    ) as HTMLElement;
    expect(routePicker.textContent).toContain('Local');
    expect(routePicker.textContent).toContain('Cloud');
    const openMachine = Array.from(routePicker.querySelectorAll('button')).find((button) => (
      button.textContent?.trim() === 'Open Local AI Configurations'
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
      providerModelTarget: { provider: 'provider-test', providerModelId: 'cloud-model' },
    }]);
    const node = await renderSurface(vi.fn(async () => undefined), vi.fn(), {
      cloudAIConfig: {
        listImplementations,
        listTargets,
        listAuthorizationOptions: async () => ({
          connectors: [{ connectorId: 'connector-test', label: 'Work account', provider: 'provider-test' }],
          grants: [],
        }),
        createGrant: async () => ({
          grantId: 'grant-test',
          connectorId: 'connector-test',
          status: 'active',
          createdAt: '2026-08-07T00:00:00.000Z',
          revokedAt: null,
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
        listAuthorizationOptions: async () => ({ connectors: [], grants: [] }),
        createGrant: vi.fn(),
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
