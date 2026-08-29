import { describe, expect, it, vi } from 'vitest';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
  type NimiAIConfigLocalLoadoutOption,
  type NimiPortableAppAIConfig,
  type NimiPortableAppAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  ModelConfigCurrentMachineLocalActionError,
  runModelConfigCurrentMachineLocalAction,
} from '../src/current-machine-local-action.js';
import type { ModelConfigListOptions, ModelConfigOverwrite } from '../src/types.js';

function localOption(
  capabilityContract: string,
  state: NimiAIConfigLocalLoadoutOption['state'] = 'ready',
): NimiAIConfigLocalLoadoutOption {
  return {
    loadoutRef: `loadout:${capabilityContract}`,
    label: `Selected ${capabilityContract}`,
    capabilityContract,
    implementation: {
      implementationId: `implementation:${capabilityContract}`,
      driverId: 'driver.local',
      driverDialect: 'driver.local/v1',
    },
    supportedFeatures: ['stream'],
    state,
    reasons: state === 'blocked' ? ['AI_LOADOUT_BLOCKED'] : [],
  };
}

function optionsFor(selected: ReadonlySet<string>): ModelConfigListOptions {
  return vi.fn(async (query) => {
    if (query.kind !== 'local-loadouts') throw new Error('unexpected query');
    return {
      kind: 'local-loadouts' as const,
      options: selected.has(query.capabilityContract) ? [localOption(query.capabilityContract)] : [],
      truncated: false,
    };
  });
}

function committedOverwrite(revision = '2'): ModelConfigOverwrite {
  return vi.fn(async (input) => ({
    outcome: 'committed' as const,
    config: { capabilities: [...input.capabilities] } as NimiPortableAppAIConfig,
    revision,
  }));
}

function cloudIntent(
  capabilityContract: string,
  requiredFeatures: readonly string[] = [],
  defaults?: Readonly<Record<string, unknown>>,
): NimiPortableAppAIConfigIntent {
  return createNimiCloudAIConfigCapabilityIntent({
    capabilityContract,
    connectorRef: 'connector:work',
    requiredFeatures,
    ...(defaults ? { defaults } : {}),
    implementation: {
      implementationId: `implementation:${capabilityContract}`,
      driverId: 'driver.cloud',
      driverDialect: 'driver.cloud/v1',
    },
    providerModelTarget: {
      provider: 'provider',
      providerModelId: `model:${capabilityContract}`,
      remoteModelCatalogId: `catalog:${capabilityContract}`,
    },
  });
}

describe('Model Config current-machine Local action', () => {
  it('deduplicates only explicit contracts, reads each once, and preserves uncovered intent', async () => {
    const text = cloudIntent('text.generate', ['stream'], { temperature: 0.2 });
    const uncovered = cloudIntent('audio.synthesize', ['voice']);
    const listOptions = optionsFor(new Set(['text.generate', 'image.generate']));
    const onOverwrite = committedOverwrite();

    const result = await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: [' text.generate ', 'text.generate', 'image.generate'],
      capabilities: [text, uncovered],
      revision: 'revision-1',
      listOptions,
      onOverwrite,
    });

    expect(listOptions).toHaveBeenCalledTimes(2);
    expect(listOptions).toHaveBeenNthCalledWith(1, { kind: 'local-loadouts', capabilityContract: 'text.generate' });
    expect(listOptions).toHaveBeenNthCalledWith(2, { kind: 'local-loadouts', capabilityContract: 'image.generate' });
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    const overwrite = vi.mocked(onOverwrite).mock.calls[0][0];
    expect(overwrite.expectedRevision).toBe('revision-1');
    expect(overwrite.capabilities.map((entry) => entry.capabilityContract)).toEqual([
      'text.generate', 'audio.synthesize', 'image.generate',
    ]);
    expect(overwrite.capabilities[0].route.oneofKind).toBe('local');
    expect(overwrite.capabilities[0].requiredFeatures).toEqual(['stream']);
    expect(runtimeAIConfigStructToJson(overwrite.capabilities[0].defaults)).toEqual({ temperature: 0.2 });
    expect(overwrite.capabilities[1]).toEqual(uncovered);
    expect(result.outcome).toBe('committed');
    expect(result.selectedCapabilityContracts).toEqual(['text.generate', 'image.generate']);
  });

  it('does not mutate when no explicit capability has a machine selection', async () => {
    const current = [cloudIntent('text.generate')];
    const onOverwrite = committedOverwrite();
    const result = await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: current, revision: '1',
      listOptions: optionsFor(new Set()), onOverwrite,
    });
    expect(result).toEqual({ outcome: 'no-selection', selectedCapabilityContracts: [] });
    expect(onOverwrite).not.toHaveBeenCalled();
    expect(current[0].route.oneofKind).toBe('cloud');
  });

  it('does not write a canonical no-op', async () => {
    const onOverwrite = committedOverwrite();
    const result = await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'],
      capabilities: [createNimiLocalAIConfigCapabilityIntent({
        capabilityContract: 'text.generate', requiredFeatures: ['stream'], defaults: { temperature: 0.3 },
      })],
      revision: '1', listOptions: optionsFor(new Set(['text.generate'])), onOverwrite,
    });
    expect(result).toEqual({ outcome: 'no-change', selectedCapabilityContracts: ['text.generate'] });
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('issues all explicit reads and zero mutation when one read rejects', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => {
      if (query.capabilityContract === 'image.generate') throw new Error('Runtime unavailable');
      return { kind: 'local-loadouts', options: [localOption(query.capabilityContract)], truncated: false };
    });
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate', 'image.generate'], capabilities: [], revision: '1',
      listOptions, onOverwrite,
    })).rejects.toThrow('Runtime unavailable');
    expect(listOptions).toHaveBeenCalledTimes(2);
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('rejects a mismatched result kind with zero mutation', async () => {
    const listOptions = vi.fn(async () => ({
      kind: 'cloud-connectors', options: [], truncated: false,
    })) as unknown as ModelConfigListOptions;
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '1', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_LOCAL_OPTIONS', capabilityContract: 'text.generate' });
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('rejects a truncated result with zero mutation', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => ({
      kind: 'local-loadouts', options: [localOption(query.capabilityContract)], truncated: true,
    }));
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '1', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_LOCAL_OPTIONS' });
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('rejects duplicate current selections with zero mutation', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => ({
      kind: 'local-loadouts',
      options: [localOption(query.capabilityContract), localOption(query.capabilityContract)],
      truncated: false,
    }));
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '1', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_LOCAL_OPTIONS' });
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('rejects an option for another contract with zero mutation', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async () => ({
      kind: 'local-loadouts', options: [localOption('image.generate')], truncated: false,
    }));
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '1', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_LOCAL_OPTIONS', capabilityContract: 'text.generate' });
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('rejects malformed current selection metadata with zero mutation', async () => {
    const listOptions = vi.fn(async () => ({
      kind: 'local-loadouts',
      options: [{ ...localOption('text.generate'), implementation: { implementationId: '', driverId: '', driverDialect: '' } }],
      truncated: false,
    })) as unknown as ModelConfigListOptions;
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '1', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_LOCAL_OPTIONS' });
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('rejects duplicate current owner intents before option reads', async () => {
    const current = createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'text.generate' });
    const listOptions = optionsFor(new Set(['text.generate']));
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [current, current], revision: '1', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_CURRENT_CONFIG' });
    expect(listOptions).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('withholds reads and mutation for incomplete eligibility inputs', async () => {
    const listOptions = optionsFor(new Set(['text.generate']));
    const onOverwrite = committedOverwrite();
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: [' ', ''], capabilities: [], revision: '1', listOptions, onOverwrite,
    })).rejects.toBeInstanceOf(ModelConfigCurrentMachineLocalActionError);
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '', listOptions, onOverwrite,
    })).rejects.toMatchObject({ code: 'INVALID_ACTION_INPUT' });
    expect(listOptions).not.toHaveBeenCalled();
    expect(onOverwrite).not.toHaveBeenCalled();
  });

  it('returns typed conflict current state and preserves the complete draft without retry', async () => {
    const currentConfig = { capabilities: [cloudIntent('image.generate')] } as NimiPortableAppAIConfig;
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => ({
      outcome: 'conflict', config: currentConfig, revision: '7', reasonCode: 'AI_CONFIG_REVISION_CONFLICT',
    }));
    const result = await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [cloudIntent('text.generate')], revision: '6',
      listOptions: optionsFor(new Set(['text.generate'])), onOverwrite,
    });
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: 'conflict', config: currentConfig, revision: '7',
      reasonCode: 'AI_CONFIG_REVISION_CONFLICT', selectedCapabilityContracts: ['text.generate'],
    });
    expect(result.outcome === 'conflict' ? result.draftCapabilities[0].route.oneofKind : null).toBe('local');
  });

  it('performs at most one overwrite and propagates an owner rejection', async () => {
    const onOverwrite = vi.fn<ModelConfigOverwrite>(async () => { throw new Error('owner rejected'); });
    await expect(runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate', 'image.generate'], capabilities: [], revision: '1',
      listOptions: optionsFor(new Set(['text.generate', 'image.generate'])), onOverwrite,
    })).rejects.toThrow('owner rejected');
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });

  it('freezes the owner snapshot before asynchronous option reads', async () => {
    const current = [cloudIntent('text.generate', ['original'])];
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => {
      (current[0] as { requiredFeatures: string[] }).requiredFeatures.push('late-mutation');
      current.push(cloudIntent('audio.synthesize'));
      return { kind: 'local-loadouts', options: [localOption(query.capabilityContract)], truncated: false };
    });
    const onOverwrite = committedOverwrite();
    await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: current, revision: '1', listOptions, onOverwrite,
    });
    const draft = vi.mocked(onOverwrite).mock.calls[0][0].capabilities;
    expect(draft.map((intent) => intent.capabilityContract)).toEqual(['text.generate']);
    expect(draft[0].requiredFeatures).toEqual(['original']);
  });

  it('appends missing selected intents in explicit-contract order', async () => {
    const onOverwrite = committedOverwrite();
    await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['video.generate', 'text.generate', 'image.generate'],
      capabilities: [cloudIntent('audio.synthesize')], revision: '1',
      listOptions: optionsFor(new Set(['image.generate', 'video.generate', 'text.generate'])), onOverwrite,
    });
    expect(vi.mocked(onOverwrite).mock.calls[0][0].capabilities.map((intent) => intent.capabilityContract)).toEqual([
      'audio.synthesize', 'video.generate', 'text.generate', 'image.generate',
    ]);
  });

  it('treats a blocked but real machine selection as selected without copying its metadata', async () => {
    const listOptions = vi.fn<ModelConfigListOptions>(async (query) => ({
      kind: 'local-loadouts', options: [localOption(query.capabilityContract, 'blocked')], truncated: false,
    }));
    const onOverwrite = committedOverwrite();
    await runModelConfigCurrentMachineLocalAction({
      capabilityContracts: ['text.generate'], capabilities: [], revision: '1', listOptions, onOverwrite,
    });
    const intent = vi.mocked(onOverwrite).mock.calls[0][0].capabilities[0];
    expect(intent).toEqual(createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'text.generate' }));
    expect(JSON.stringify(intent)).not.toContain('loadout:text.generate');
  });
});
