import { describe, expect, it, vi } from 'vitest';
import {
  ReasonCode,
  VoiceAssetStatus,
  VoiceCreationSource,
  createNimiError,
  isNimiError,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeVoiceCatalog,
  type RuntimeVoiceCatalogRuntime,
} from '../src/runtime-voice-catalog.js';

describe('Runtime voice reference catalog', () => {
  it('lists owner-scoped voice_asset_id references without execution truth', async () => {
    const listVoiceAssets = vi.fn(async () => ({
      assets: [{
        voiceAssetId: 'voice-asset-1',
        appId: 'app.test',
        subjectUserId: 'user.test',
        creationSource: VoiceCreationSource.REFERENCE_AUDIO,
        status: VoiceAssetStatus.ACTIVE,
      }],
      nextPageToken: 'next',
    }));
    const runtime = { ai: { listVoiceAssets } } as unknown as RuntimeVoiceCatalogRuntime;

    const result = await runRuntimeVoiceCatalog({
      runtime,
      appId: 'app.test',
      subjectUserId: 'user.test',
      creationSource: VoiceCreationSource.REFERENCE_AUDIO,
      status: VoiceAssetStatus.ACTIVE,
      pageSize: 25,
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'speech.bundle',
      output: {
        kind: 'voice-reference-catalog',
        voiceCount: 1,
        voiceReferences: [{
          kind: 'voice_asset_id',
          voiceAssetId: 'voice-asset-1',
          creationSource: VoiceCreationSource.REFERENCE_AUDIO,
        }],
        nextPageToken: 'next',
      },
    });
    expect(listVoiceAssets).toHaveBeenCalledWith({
      appId: 'app.test',
      subjectUserId: 'user.test',
      creationSource: VoiceCreationSource.REFERENCE_AUDIO,
      status: VoiceAssetStatus.ACTIVE,
      pageSize: 25,
      pageToken: '',
    }, expect.any(Object));
  });

  it('fails closed before lookup without exact owner identity', async () => {
    const listVoiceAssets = vi.fn();
    const result = await runRuntimeVoiceCatalog({
      runtime: { ai: { listVoiceAssets } } as unknown as RuntimeVoiceCatalogRuntime,
      appId: ' app.test ',
      subjectUserId: 'user.test',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'principal-unauthorized',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.PRINCIPAL_UNAUTHORIZED);
    expect(listVoiceAssets).not.toHaveBeenCalled();
  });

  it('preserves typed Runtime failures', async () => {
    const failure = createNimiError({
      message: 'catalog unavailable',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'retry',
      source: 'runtime',
    });
    const listVoiceAssets = vi.fn(async () => {
      throw failure;
    });
    const result = await runRuntimeVoiceCatalog({
      runtime: { ai: { listVoiceAssets } } as unknown as RuntimeVoiceCatalogRuntime,
      appId: 'app.test',
      subjectUserId: 'user.test',
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'runtime-call-failed',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(result.error).toBe(failure);
    expect(result.error.reasonCode).toBe(ReasonCode.RUNTIME_UNAVAILABLE);
  });
});
