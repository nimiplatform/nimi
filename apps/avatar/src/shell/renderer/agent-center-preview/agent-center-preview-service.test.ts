import { describe, expect, it } from 'vitest';
import { createAgentCenterAvatarPreviewService } from './agent-center-preview-service.js';

const LIVE2D_ASSET_REF = 'live2d_111111111111';
const LIVE2D_MATERIAL_REF = `agent-center-avatar-asset:account:agent:live2d:${LIVE2D_ASSET_REF}`;
const VRM_ASSET_REF = 'vrm_222222222222';
const VRM_MATERIAL_REF = `agent-center-avatar-asset:account:agent:vrm:${VRM_ASSET_REF}`;

describe('Agent Center avatar preview service resolver', () => {
  it('returns Avatar-owned Live2D render evidence from a registered surface', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
    });

    expect(service.resolvePreview({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      live2d: {
        status: 'ready',
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:live2d:360x480:123',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    })).toEqual({
      state: 'ready',
      tier: 'avatar_preview_service',
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
      evidenceRef: 'avatar.carrier.visual:live2d:360x480:123',
      visiblePixels: 32,
      sampledPixelChecksum: 123,
      nonPlaceholder: true,
      warnings: ['avatar_preview_service:live2d'],
    });
  });

  it('returns Avatar-owned VRM render evidence from a registered surface', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/vrm/123',
    });

    expect(service.resolvePreview({
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      vrm: {
        previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
        evidenceRef: 'avatar.vrm.visual:vrm:123',
        capabilityProfileRef: 'avatar.vrm.capability-profile:123',
        visiblePixels: 48,
        sampledPixelChecksum: 456,
      },
    })).toEqual({
      state: 'ready',
      tier: 'avatar_preview_service',
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
      previewImageRef: '/__nimi/avatar-preview/vrm/123',
      evidenceRef: 'avatar.vrm.visual:vrm:123',
      visiblePixels: 48,
      sampledPixelChecksum: 456,
      nonPlaceholder: true,
      warnings: ['avatar_preview_service:vrm'],
    });
  });

  it('distinguishes all five contract failure reason codes', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/failure-matrix',
    });
    const base = {
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d' as const,
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      live2d: { status: 'error' as const },
    };

    expect(service.resolvePreview({ ...base, avatarAssetRef: '' })).toMatchObject({
      state: 'failed',
      reasonCode: 'missing_asset',
    });
    expect(service.resolvePreview(base)).toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
    });
    expect(service.resolvePreview({ ...base, backendKind: 'spine' } as never)).toMatchObject({
      state: 'unavailable',
      reasonCode: 'unsupported_preview_tier',
    });
    expect(service.resolvePreview({ ...base, previewSurfaceHandle: 'avatar-preview-surface:missing' })).toMatchObject({
      state: 'unavailable',
      reasonCode: 'capability_unavailable',
    });
    const hostFailure = { ...base } as Record<string, unknown>;
    Object.defineProperty(hostFailure, 'live2d', {
      get() {
        throw new Error('renderer state inaccessible');
      },
    });
    expect(service.resolvePreview(hostFailure as never)).toMatchObject({
      state: 'failed',
      reasonCode: 'host_internal_error',
    });
  });

  it('keeps pending Live2D rendering as a typed loading envelope', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/pending',
    });

    expect(service.resolvePreview({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      live2d: { status: 'pending' },
    })).toMatchObject({
      state: 'loading',
      reasonCode: 'capability_unavailable',
      nonPlaceholder: false,
    });
  });

  it.each([
    {
      label: 'Shell-owned artifact evidence',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: LIVE2D_MATERIAL_REF,
        evidenceRef: 'avatar.carrier.visual:live2d:shell-artifact',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'non-Avatar artifact namespace',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'shell.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:live2d:123',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'non-Avatar evidence namespace',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'shell.visual:live2d:123',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'empty Avatar artifact identity',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'avatar.carrier.preview-artifact:',
        evidenceRef: 'avatar.carrier.visual:live2d:123',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'empty Avatar evidence identity',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'invalid Avatar evidence identity',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:../escape',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'non-finite visible pixels',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:live2d:123',
        visiblePixels: Number.POSITIVE_INFINITY,
        sampledPixelChecksum: 123,
      },
    },
    {
      label: 'non-finite checksum',
      descriptor: {
        status: 'ready' as const,
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:live2d:123',
        visiblePixels: 32,
        sampledPixelChecksum: Number.NaN,
      },
    },
  ])('rejects $label before signing ready', ({ descriptor }) => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/invalid-evidence',
    });

    expect(service.resolvePreview({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      live2d: descriptor,
    })).toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
      nonPlaceholder: false,
    });
  });

  it('rejects backend/material mismatch and an unregistered same-origin path', () => {
    const service = createAgentCenterAvatarPreviewService();
    expect(() => service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/mismatched',
    })).toThrow(/material/u);
    expect(() => service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: `agent-center-avatar-asset: :agent:live2d:${LIVE2D_ASSET_REF}`,
      previewImageRef: '/__nimi/avatar-preview/live2d/whitespace-custody',
    })).toThrow(/material/u);
    expect(() => service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: `agent-center-avatar-asset:account:Agent:live2d:${LIVE2D_ASSET_REF}`,
      previewImageRef: '/__nimi/avatar-preview/live2d/invalid-custody',
    })).toThrow(/material/u);

    expect(service.resolvePreview({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewSurfaceHandle: '/__nimi/avatar-preview/live2d/unregistered',
      live2d: { status: 'pending' },
    })).toMatchObject({
      state: 'unavailable',
      reasonCode: 'capability_unavailable',
    });
  });

  it('rejects a foreign-origin blob during Avatar surface registration', () => {
    const service = createAgentCenterAvatarPreviewService();
    expect(() => service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: 'blob:https://foreign.example/preview-id',
    })).toThrow(/surface/u);
  });

  it('invalidates an unregistered surface handle', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/vrm/disposable',
    });
    expect(service.unregisterPreviewSurface(surface.previewSurfaceHandle)).toBe(true);
    expect(service.unregisterPreviewSurface(surface.previewSurfaceHandle)).toBe(false);
    expect(service.resolvePreview({
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      vrm: {},
    })).toMatchObject({
      state: 'unavailable',
      reasonCode: 'capability_unavailable',
    });
  });

  it('rejects an empty VRM capability profile identity', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/vrm/empty-capability',
    });
    expect(service.resolvePreview({
      avatarAssetRef: VRM_ASSET_REF,
      backendKind: 'vrm',
      previewMaterialRef: VRM_MATERIAL_REF,
      previewSurfaceHandle: surface.previewSurfaceHandle,
      vrm: {
        previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
        evidenceRef: 'avatar.vrm.visual:vrm:123',
        capabilityProfileRef: 'avatar.vrm.capability-profile:',
        visiblePixels: 48,
        sampledPixelChecksum: 456,
      },
    })).toMatchObject({
      state: 'failed',
      reasonCode: 'invalid_manifest',
    });
  });
});
