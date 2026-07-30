import { describe, expect, it } from 'vitest';
import { isAgentCenterCommittedAppearanceReady } from '../src/headless.js';
import { isAvatarControlledPreviewSurfaceRef } from '../../avatar/src/headless.js';

describe('AgentCenter committed-effect readiness', () => {
  it('requires controlled current-origin render output and visible pixels', () => {
    expect(isAgentCenterCommittedAppearanceReady({
      status: 'ready',
      avatarAssetRef: 'vrm_committed',
      renderState: 'ready',
      renderTier: 'avatar_preview_service',
      renderImageRef: '/__nimi/avatar-preview/committed.png',
      renderVisiblePixels: 12,
    })).toBe(true);
  });

  it('fails closed for blob:null and non-ready committed output', () => {
    expect(isAvatarControlledPreviewSurfaceRef('blob:null/unsafe')).toBe(false);
    expect(isAgentCenterCommittedAppearanceReady({
      status: 'invalid',
      avatarAssetRef: 'vrm_committed',
      renderState: 'failed',
      renderTier: 'avatar_preview_service',
      renderImageRef: null,
      renderVisiblePixels: null,
    })).toBe(false);
  });
});
