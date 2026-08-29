import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
  NimiPortableAppAIConfig,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  ModelConfigCurrentMachineLocalAction,
  type ModelConfigCurrentMachineLocalActionProps,
} from '../src/components/model-config-current-machine-local-action.js';
import type { ModelConfigListOptions, ModelConfigOverwrite } from '../src/types.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function selectedResult(capabilityContract: string): Extract<NimiAIConfigOptionsResult, { readonly kind: 'local-loadouts' }> {
  return {
    kind: 'local-loadouts',
    options: [{
      loadoutRef: `loadout:${capabilityContract}`,
      label: `Selected ${capabilityContract}`,
      capabilityContract,
      implementation: {
        implementationId: `implementation:${capabilityContract}`,
        driverId: 'driver.local',
        driverDialect: 'driver.local/v1',
      },
      supportedFeatures: [],
      state: 'ready',
      reasons: [],
    }],
    truncated: false,
  };
}

function localLoadoutCapabilityContract(query: NimiAIConfigOptionsQuery): string {
  if (query.kind !== 'local-loadouts') throw new Error(`unexpected options query: ${query.kind}`);
  return query.capabilityContract;
}

function committedOverwrite(): ModelConfigOverwrite {
  return vi.fn(async (input) => ({
    outcome: 'committed' as const,
    config: { capabilities: [...input.capabilities] } as NimiPortableAppAIConfig,
    revision: '2',
  }));
}

async function renderAction(props: ModelConfigCurrentMachineLocalActionProps): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await rerenderAction(props);
  return container;
}

async function rerenderAction(props: ModelConfigCurrentMachineLocalActionProps): Promise<void> {
  await act(async () => {
    root?.render(<ModelConfigCurrentMachineLocalAction {...props} />);
    await Promise.resolve();
  });
}

async function clickAction(node: HTMLElement): Promise<void> {
  const button = node.querySelector('[data-testid="model-config-current-machine-local-action"]') as HTMLButtonElement;
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function baseProps(input: {
  readonly listOptions: ModelConfigListOptions;
  readonly onOverwrite: ModelConfigOverwrite;
  readonly ownerKey?: string;
}): ModelConfigCurrentMachineLocalActionProps {
  return {
    ownerKey: input.ownerKey || 'app-ai-config:test.app',
    capabilityContracts: ['text.generate'],
    capabilities: [],
    revision: '1',
    listOptions: input.listOptions,
    onOverwrite: input.onOverwrite,
  };
}

describe('Model Config current-machine Local action candidate', () => {
  it('shows fail-closed unavailable state when owner inputs are incomplete', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>();
    const onOverwrite = committedOverwrite();
    const node = await renderAction({
      ownerKey: 'app-ai-config:test.app',
      capabilityContracts: ['text.generate'],
      capabilities: undefined,
      revision: undefined,
      listOptions,
      onOverwrite,
    });
    const button = node.querySelector('[data-testid="model-config-current-machine-local-action"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(node.querySelector('[data-nimi-model-config-current-machine-local-action="unavailable"]')).toBeTruthy();
    expect(node.textContent).toContain('unavailable');
    expect(listOptions).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('reads only deduplicated explicit contracts and presents committed state after one CAS', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => selectedResult(localLoadoutCapabilityContract(query)));
    const onOverwrite = committedOverwrite();
    const node = await renderAction({
      ...baseProps({ listOptions, onOverwrite }),
      capabilityContracts: [' text.generate ', 'text.generate', 'image.generate'],
    });
    await clickAction(node);
    expect(listOptions).toHaveBeenCalledTimes(2);
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Current on-device models are now used.');
  });

  it('presents no-selection without mutation', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async () => ({
      kind: 'local-loadouts', options: [], truncated: false,
    }));
    const onOverwrite = committedOverwrite();
    const node = await renderAction(baseProps({ listOptions, onOverwrite }));
    await clickAction(node);
    expect(node.textContent).toContain('No on-device model is selected');
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('keeps a failed read retryable and rereads only after an explicit retry', async () => {
    let attempts = 0;
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => {
      attempts += 1;
      if (attempts === 1) throw new Error('Runtime unavailable');
      return selectedResult(localLoadoutCapabilityContract(query));
    });
    const onOverwrite = committedOverwrite();
    const node = await renderAction(baseProps({ listOptions, onOverwrite }));
    await clickAction(node);
    expect(node.textContent).toContain('Current on-device models could not be applied.');
    expect(node.textContent).toContain('Retry');
    expect(onOverwrite).not.toHaveBeenCalled();
    await clickAction(node);
    expect(listOptions).toHaveBeenCalledTimes(2);
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Current on-device models are now used.');
  });

  it('preserves and presents returned conflict current state without retry', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => selectedResult(localLoadoutCapabilityContract(query)));
    const current = {
      capabilities: [{
        capabilityContract: 'image.generate', requiredFeatures: [],
        route: { oneofKind: 'local' as const, local: {} },
      }],
    } as NimiPortableAppAIConfig;
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => ({
      outcome: 'conflict', config: current, revision: '9', reasonCode: 'AI_CONFIG_REVISION_CONFLICT',
    }));
    const node = await renderAction(baseProps({ listOptions, onOverwrite }));
    await clickAction(node);
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(node.textContent).toContain('Your draft was kept');
    expect(node.textContent).toContain('Current revision 9: image.generate: on-device');
  });

  it('fences an old owner epoch before CAS when the surface rebinds during reads', async () => {
    let resolveOldRead!: (result: NimiAIConfigOptionsResult) => void;
    const listOptionsA = vi.fn<ModelConfigListOptions>(() => new Promise((resolve) => { resolveOldRead = resolve; }));
    const overwriteA = committedOverwrite();
    const listOptionsB = vi.fn<ModelConfigListOptions>(async (query) => selectedResult(localLoadoutCapabilityContract(query)));
    const overwriteB = committedOverwrite();
    const node = await renderAction(baseProps({ listOptions: listOptionsA, onOverwrite: overwriteA, ownerKey: 'app-ai-config:app.a' }));

    const button = node.querySelector('[data-testid="model-config-current-machine-local-action"]') as HTMLButtonElement;
    await act(async () => { button.click(); await Promise.resolve(); });
    await rerenderAction(baseProps({ listOptions: listOptionsB, onOverwrite: overwriteB, ownerKey: 'app-ai-config:app.b' }));
    await act(async () => {
      resolveOldRead(selectedResult('text.generate'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(overwriteA).not.toHaveBeenCalled();
    expect(overwriteB).not.toHaveBeenCalled();
    expect(node.textContent).not.toContain('now used');
  });

  it.each([
    'app-ai-config:test.app',
    'shared-local-agent-ai-config',
  ])('binds the action only to the supplied manager for %s', async (ownerKey) => {
    const activeList = vi.fn<ModelConfigListOptions>(async (query) => selectedResult(localLoadoutCapabilityContract(query)));
    const activeOverwrite = committedOverwrite();
    const otherList = vi.fn<ModelConfigListOptions>();
    const otherOverwrite = committedOverwrite();
    const node = await renderAction(baseProps({ listOptions: activeList, onOverwrite: activeOverwrite, ownerKey }));
    await clickAction(node);
    expect(activeList).toHaveBeenCalledTimes(1);
    expect(activeOverwrite).toHaveBeenCalledTimes(1);
    expect(otherList).not.toHaveBeenCalled();
    expect(otherOverwrite).not.toHaveBeenCalled();
  });
});
