import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  AgentCenterAvatarPreview,
  resolveAgentCenterAvatarPreviewServiceResult,
} from '../src/agent-center-preview.js';

describe('Agent Center Avatar preview service facade', () => {
  it('admits non-placeholder Live2D and VRM previews only from avatar_preview_service evidence', () => {
    const live2d = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'live2d',
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent/live2d',
      previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
      previewEvidenceRef: 'avatar.carrier.visual:live2d:123',
      previewVisiblePixels: 32,
      previewSampledPixelChecksum: 123,
    });
    const vrm = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'vrm',
      avatarAssetRef: 'agent-center-avatar:local-agent/vrm',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent/vrm',
      previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
      previewImageRef: '/__nimi/avatar-preview/vrm/123',
      previewEvidenceRef: 'avatar.vrm.visual:vrm:123',
      previewVisiblePixels: 48,
      previewSampledPixelChecksum: 456,
    });

    expect(live2d).toMatchObject({
      state: 'ready',
      backendKind: 'live2d',
      nonPlaceholder: true,
      evidenceRef: 'avatar.carrier.visual:live2d:123',
    });
    expect(vrm).toMatchObject({
      state: 'ready',
      backendKind: 'vrm',
      nonPlaceholder: true,
      evidenceRef: 'avatar.vrm.visual:vrm:123',
    });
  });

  it('fails closed instead of converting incomplete preview metadata into a placeholder success', () => {
    const result = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'material_resolve',
      backendKind: 'live2d',
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      previewArtifactRef: 'agent-center-preview:local-agent/live2d',
      previewFailureReason: 'avatar_preview_service tier required',
    });

    const markup = renderToStaticMarkup(
      <AgentCenterAvatarPreview
        fallback={<span>not ready</span>}
        label="Partner avatar"
        result={result}
      />,
    );

    expect(result).toMatchObject({
      state: 'unavailable',
      nonPlaceholder: false,
      reason: 'avatar_preview_service tier required',
    });
    expect(markup).toMatch(/data-avatar-preview-nonplaceholder="false"/u);
    expect(markup).toMatch(/data-avatar-preview-tier="avatar_preview_service"/u);
    expect(markup).toMatch(/not ready/u);
  });

  it('rejects artifact-only ready metadata without a render surface URL', () => {
    expect(resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'live2d',
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:123',
    })).toMatchObject({
      state: 'unavailable',
      nonPlaceholder: false,
    });
  });

  it('rejects remote render URLs that are not controlled by the local Avatar surface', () => {
    expect(resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'vrm',
      avatarAssetRef: 'agent-center-avatar:local-agent/vrm',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent/vrm',
      previewArtifactRef: 'avatar.vrm.preview-artifact:vrm:123',
      previewImageRef: 'https://example.com/preview.png',
      previewEvidenceRef: 'avatar.vrm.visual:vrm:123',
      previewVisiblePixels: 48,
      previewSampledPixelChecksum: 456,
    })).toMatchObject({
      state: 'unavailable',
      nonPlaceholder: false,
    });
  });

  it('rejects foreign-origin blob URLs that are not controlled by the current Avatar surface', () => {
    expect(resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'live2d',
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent/live2d',
      previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:foreign',
      previewImageRef: 'blob:https://foreign-origin.example/preview-id',
      previewEvidenceRef: 'avatar.carrier.visual:live2d:foreign',
      previewVisiblePixels: 48,
      previewSampledPixelChecksum: 456,
    })).toMatchObject({
      state: 'unavailable',
      nonPlaceholder: false,
    });
  });

  it('rejects ready metadata without positive visible-pixel evidence', () => {
    expect(resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'live2d',
      avatarAssetRef: 'agent-center-avatar:local-agent/live2d',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent/live2d',
      previewArtifactRef: 'avatar.carrier.preview-artifact:live2d:blank',
      previewImageRef: 'blob:nimi-avatar-preview-blank',
      previewEvidenceRef: 'avatar.carrier.visual:live2d:blank',
      previewVisiblePixels: 0,
      previewSampledPixelChecksum: 0,
    })).toMatchObject({
      state: 'unavailable',
      nonPlaceholder: false,
    });
  });
});
