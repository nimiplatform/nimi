import { describe, expect, it } from 'vitest';
import { createAgentCenterAvatarPreviewService } from './agent-center-preview-service.js';

const LIVE2D_ASSET_REF = 'live2d_111111111111';
const LIVE2D_MATERIAL_REF = `agent-center-avatar-asset:account-1:local-agent-ren:live2d:${LIVE2D_ASSET_REF}`;
const VRM_ASSET_REF = 'vrm_222222222222';
const VRM_MATERIAL_REF = `agent-center-avatar-asset:account-1:local-agent-ren:vrm:${VRM_ASSET_REF}`;

describe('AgentCenterAvatarPreviewService', () => {
  it('returns ready for a registered Live2D renderer-ready surface', () => {
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
      },
    })).toEqual({
      state: 'ready',
      tier: 'avatar_preview_service',
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
      warnings: ['avatar_preview_service:live2d'],
    });
  });

  it('returns ready for VRM with a validated capability profile', () => {
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
        capabilityProfileRef: 'avatar.vrm.capability-profile:vrm_222222222222',
      },
    })).toMatchObject({
      state: 'ready',
      backendKind: 'vrm',
      previewImageRef: '/__nimi/avatar-preview/vrm/123',
    });
  });

  it('keeps pending and blank renderer output non-ready', () => {
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
    })).toMatchObject({ state: 'loading' });
  });

  it('fails closed when the registered surface belongs to another material', () => {
    const service = createAgentCenterAvatarPreviewService();
    const surface = service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
    });

    expect(service.resolvePreview({
      avatarAssetRef: 'live2d_aaaaaaaaaaaa',
      backendKind: 'live2d',
      previewMaterialRef: 'agent-center-avatar-asset:account-1:local-agent-ren:live2d:live2d_aaaaaaaaaaaa',
      previewSurfaceHandle: surface.previewSurfaceHandle,
      live2d: { status: 'ready' },
    })).toMatchObject({ state: 'failed', reasonCode: 'invalid_manifest' });
  });

  it('rejects preview surfaces outside the controlled origin', () => {
    const service = createAgentCenterAvatarPreviewService();
    expect(() => service.registerPreviewSurface({
      avatarAssetRef: LIVE2D_ASSET_REF,
      backendKind: 'live2d',
      previewMaterialRef: LIVE2D_MATERIAL_REF,
      previewImageRef: 'https://example.com/avatar.png',
    })).toThrow(/controlled root-relative or current-origin blob URL/u);
  });
});
