import { describe, expect, it } from 'vitest';
import {
  findLocalAssetForTargetRef,
  localRuntimeRefCandidates,
  resolveModelConfigLocalRuntimeStatus,
} from '../src/headless.js';
import type { LocalAssetEntry } from '../src/types.js';
import type {
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAIScopeRef,
  NimiJsonObject,
} from '@nimiplatform/kit/core/sdk-contract';

const scopeRef: NimiAIScopeRef = { kind: 'app', ownerId: 'tester', surfaceId: 'app-lab' };

function localRuntimeTargetRef(value: string): NimiAIConfigTargetRef {
  return {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: value,
  };
}

function configWithImageTarget(
  targetRef: NimiAIConfigTargetRef,
  selectedParams: NimiJsonObject = {},
): NimiAIConfig {
  return {
    scopeRef,
    capabilities: {
      logicalModelIds: {},
      targetRefs: { 'image.generate': targetRef },
      selectedComponents: {},
      selectedParams: { 'image.generate': selectedParams },
    },
    profileOrigin: null,
  };
}

function asset(input: Partial<LocalAssetEntry>): LocalAssetEntry {
  return {
    localAssetId: input.localAssetId ?? 'asset-1',
    assetId: input.assetId ?? 'semantic-1',
    kind: input.kind ?? 'image',
    engine: input.engine ?? 'media',
    status: input.status ?? 'active',
    family: input.family,
    modelFamily: input.modelFamily,
    artifactRoles: input.artifactRoles,
    metadata: input.metadata,
  };
}

describe('model config local runtime status helpers', () => {
  it('expands durable local-runtime refs into local asset matching candidates', () => {
    expect(localRuntimeRefCandidates('local-runtime:asset-1')).toEqual(expect.arrayContaining([
      'local-runtime:asset-1',
      'asset-1',
    ]));
    expect(localRuntimeRefCandidates('profile:kind:asset-2')).toEqual(expect.arrayContaining([
      'profile:kind:asset-2',
      'profile',
      'kind',
      'asset-2',
    ]));
  });

  it('finds local assets by profile binding and semantic asset ids', () => {
    const targetRef = localRuntimeTargetRef('local-runtime:asset-1');
    const assets = [
      asset({ localAssetId: 'other', assetId: 'semantic-other' }),
      asset({ localAssetId: 'asset-1', assetId: 'semantic-1' }),
    ];

    expect(findLocalAssetForTargetRef(assets, targetRef)?.assetId).toBe('semantic-1');
    expect(findLocalAssetForTargetRef(assets, localRuntimeTargetRef('semantic-1'))?.localAssetId).toBe('asset-1');
  });

  it('blocks image generation when the main local asset is not runnable', () => {
    const status = resolveModelConfigLocalRuntimeStatus({
      capabilityId: 'image.generate',
      config: configWithImageTarget(localRuntimeTargetRef('asset-1')),
      targetRef: localRuntimeTargetRef('asset-1'),
      assets: [asset({ status: 'imported' })],
    });

    expect(status).toMatchObject({
      supported: false,
      tone: 'attention',
      badgeLabel: 'Needs setup',
      title: 'Local model setup required',
    });
    expect(status?.detail).toContain('imported');
  });

  it('blocks image generation when required companion slots are missing', () => {
    const status = resolveModelConfigLocalRuntimeStatus({
      capabilityId: 'image.generate',
      config: configWithImageTarget(localRuntimeTargetRef('image-main'), { modelFamily: 'ideogram4' }),
      targetRef: localRuntimeTargetRef('image-main'),
      assets: [asset({ localAssetId: 'image-main', family: 'ideogram4' })],
    });

    expect(status).toMatchObject({
      supported: false,
      badgeLabel: 'Needs setup',
      title: 'Required companion models missing',
    });
  });

  it('returns null when local runtime setup has no extra blocking status', () => {
    const status = resolveModelConfigLocalRuntimeStatus({
      capabilityId: 'image.generate',
      config: configWithImageTarget(localRuntimeTargetRef('asset-1'), {
        companionSlots: {
          vae_path: 'vae-1',
          llm_path: 'llm-1',
        },
      }),
      targetRef: localRuntimeTargetRef('asset-1'),
      assets: [
        asset({ status: 'active' }),
        asset({ localAssetId: 'vae-1', assetId: 'vae-semantic', kind: 'vae', status: 'active' }),
        asset({ localAssetId: 'llm-1', assetId: 'llm-semantic', kind: 'chat', status: 'installed' }),
      ],
    });

    expect(status).toBeNull();
  });
});
