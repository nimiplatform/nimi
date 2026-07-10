import { describe, expect, it } from 'vitest';

import {
  validateAgentCenterAvatarAssetImportResult,
  validateAgentCenterAvatarPreviewResolveResult,
  validateAgentCenterBackgroundImportResult,
  validateAgentCenterLive2dSidecarImportResult,
} from '../src/headless.js';

describe('AgentCenter host result validators', () => {
  it('admits host-local opaque refs for avatar, background, sidecar, and preview results', () => {
    expect(validateAgentCenterAvatarAssetImportResult({
      avatarAssetRef: 'agent-center-avatar:local-agent-1/avatar-1',
      backendKind: 'live2d',
      validationStatus: 'valid',
      backendCapabilityProfileRef: 'avatar-backend-profile:live2d-v1',
    })).toMatchObject({
      avatarAssetRef: 'agent-center-avatar:local-agent-1/avatar-1',
      backendKind: 'live2d',
    });

    expect(validateAgentCenterBackgroundImportResult({
      backgroundAssetRef: 'agent-center-background:account-1/background-1',
      validationStatus: 'valid',
    }).backgroundAssetRef).toBe('agent-center-background:account-1/background-1');

    expect(validateAgentCenterLive2dSidecarImportResult({
      avatarAssetRef: 'agent-center-avatar:local-agent-1/avatar-1',
      live2dAdapterManifestRef: 'agent-center-sidecar:local-agent-1/sidecar-1',
      live2dAdapterManifestSource: 'external_sidecar_manifest',
    }).live2dAdapterManifestSource).toBe('external_sidecar_manifest');

    expect(validateAgentCenterAvatarPreviewResolveResult({
      avatarAssetRef: 'agent-center-avatar:local-agent-1/avatar-1',
      backendKind: 'live2d',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent-1/preview-1',
      warnings: ['needs expression review'],
    }).previewMaterialRef).toBe('agent-center-avatar-asset:local-agent-1/preview-1');
  });

  it('rejects raw paths, file URLs, unknown fields, and runtime-owned payloads', () => {
    expect(() => validateAgentCenterAvatarAssetImportResult({
      hostScope: 'local-agent',
      avatarAssetRef: 'C:\\Users\\admin\\avatar.model3.json',
      backendKind: 'live2d',
    })).toThrow(/opaque managed ref/u);

    expect(() => validateAgentCenterBackgroundImportResult({
      hostScope: 'account',
      backgroundAssetRef: 'file:///tmp/background.png',
    })).toThrow(/opaque managed ref/u);

    expect(() => validateAgentCenterAvatarPreviewResolveResult({
      avatarAssetRef: 'agent-center-avatar:local-agent-1/avatar-1',
      backendKind: 'live2d',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent-1/preview-1',
      backendCompatibilityTier: 'gold',
    })).toThrow(/unsupported field backendCompatibilityTier/u);

    expect(() => validateAgentCenterAvatarPreviewResolveResult({
      avatarAssetRef: 'agent-center-avatar:local-agent-1/avatar-1',
      backendKind: 'live2d',
      previewMaterialRef: 'agent-center-avatar-asset:local-agent-1/preview-1',
      launchPayload: {},
    })).toThrow(/unsupported field launchPayload/u);
  });
});
