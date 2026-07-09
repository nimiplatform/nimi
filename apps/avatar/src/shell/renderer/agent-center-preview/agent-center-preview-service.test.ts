import { describe, expect, it } from 'vitest';

import { resolveAgentCenterAvatarPreviewService } from './agent-center-preview-service.js';

describe('Agent Center avatar preview service resolver', () => {
  it('classifies Live2D preview readiness as a valid avatar_preview_service result', () => {
    expect(resolveAgentCenterAvatarPreviewService({
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      backendKind: 'live2d',
      live2d: {
        status: 'ready',
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
        evidenceRef: 'avatar.carrier.visual:live2d:360x480:123',
        visiblePixels: 32,
        sampledPixelChecksum: 123,
      },
    })).toEqual({
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      backendKind: 'live2d',
      previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
      validationStatus: 'valid',
      validationMessage: null,
      visiblePixels: 32,
      sampledPixelChecksum: 123,
      warnings: ['avatar_preview_service:live2d'],
    });
  });

  it('classifies VRM preview readiness as a valid avatar_preview_service result', () => {
    expect(resolveAgentCenterAvatarPreviewService({
      avatarAssetRef: 'agent-center-avatar:local-agent/vrm',
      backendKind: 'vrm',
      vrm: {
        previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
        evidenceRef: 'avatar.vrm.visual:vrm:123',
        capabilityProfileRef: 'avatar.vrm.capability-profile:123',
        visiblePixels: 48,
        sampledPixelChecksum: 456,
      },
    })).toEqual({
      avatarAssetRef: 'agent-center-avatar:local-agent/vrm',
      backendKind: 'vrm',
      previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
      validationStatus: 'valid',
      validationMessage: null,
      visiblePixels: 48,
      sampledPixelChecksum: 456,
      warnings: ['avatar_preview_service:vrm'],
    });
  });

  it('fails closed when preview artifacts are missing', () => {
    expect(resolveAgentCenterAvatarPreviewService({
      avatarAssetRef: 'agent-center-avatar:local-agent/vrm',
      backendKind: 'vrm',
      vrm: {
        capabilityProfileRef: 'avatar.vrm.capability-profile:123',
      },
    })).toMatchObject({
      backendKind: 'vrm',
      previewArtifactRef: null,
      validationStatus: 'invalid',
    });
  });

  it('does not admit artifact-only preview metadata without nonblank pixel evidence', () => {
    expect(resolveAgentCenterAvatarPreviewService({
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      backendKind: 'live2d',
      live2d: {
        status: 'ready',
        previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:blank',
        evidenceRef: 'avatar.carrier.visual:live2d:blank',
        visiblePixels: 0,
        sampledPixelChecksum: 0,
      },
    })).toMatchObject({
      backendKind: 'live2d',
      previewArtifactRef: null,
      validationStatus: 'invalid',
      visiblePixels: null,
    });
  });
});
