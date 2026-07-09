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
      previewArtifactRef: 'agent-center-preview:local-agent/live2d',
    });
    const vrm = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'vrm',
      avatarAssetRef: 'agent-center-avatar:local-agent/vrm',
      previewArtifactRef: 'agent-center-preview:local-agent/vrm',
    });

    expect(live2d).toMatchObject({
      state: 'ready',
      backendKind: 'live2d',
      nonPlaceholder: true,
      evidenceRef: 'avatar_preview_service:live2d:agent-center-preview:local-agent/live2d',
    });
    expect(vrm).toMatchObject({
      state: 'ready',
      backendKind: 'vrm',
      nonPlaceholder: true,
      evidenceRef: 'avatar_preview_service:vrm:agent-center-preview:local-agent/vrm',
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
});
