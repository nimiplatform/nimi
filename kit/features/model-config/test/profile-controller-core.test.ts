import { describe, expect, it } from 'vitest';
import {
  createModelConfigProfileControllerCore,
  type SharedAIConfigService,
  type UserProfilesSource,
} from '@nimiplatform/nimi-kit/core/model-config';
import type {
  AIConfig,
  AIProfile,
  AIProfileApplyResult,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: AIConfig = {
  scopeRef,
  capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
  profileOrigin: null,
};

const fakeService: SharedAIConfigService = {
  aiConfig: {
    get: () => baseConfig,
    update: () => undefined,
    subscribe: () => () => undefined,
  },
  aiProfile: {
    list: async () => [],
    apply: async () => ({ success: false, config: null, failureReason: 'test', probeWarnings: [] }),
  },
};

const userProfile: AIProfile = {
  profileId: 'local-profile-1',
  title: 'Local Profile',
  description: '',
  tags: [],
  capabilities: {},
};

function userSource(profiles: AIProfile[]): UserProfilesSource {
  return { list: () => profiles };
}

function applyAIProfileToConfigStub(config: AIConfig, profile: AIProfile): AIConfig {
  return {
    ...config,
    profileOrigin: { profileId: profile.profileId, title: profile.title, appliedAt: 'stub' },
  };
}

describe('createModelConfigProfileControllerCore', () => {
  it('path 1 — remote-success returns config from remote result without placeholder', () => {
    const core = createModelConfigProfileControllerCore({ scopeRef, service: fakeService });
    const remoteResult: AIProfileApplyResult = {
      success: true,
      config: { ...baseConfig, profileOrigin: { profileId: 'remote', title: 'Remote', appliedAt: 'now' } },
      failureReason: null,
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'remote',
      remoteResult,
      currentConfig: baseConfig,
      applyAIProfileToConfig: applyAIProfileToConfigStub,
      now: () => 'now',
    });
    expect(resolution.kind).toBe('remote-success');
    if (resolution.kind === 'remote-success') {
      expect(resolution.nextConfig.profileOrigin?.profileId).toBe('remote');
    }
  });

  it('path 2 — remote-fail-with-user-profile falls through to local apply (D-AIPC-005 atomic)', () => {
    const core = createModelConfigProfileControllerCore({
      scopeRef,
      service: fakeService,
      userProfilesSource: userSource([userProfile]),
    });
    const remoteResult: AIProfileApplyResult = {
      success: false,
      config: null,
      failureReason: 'remote unavailable',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'local-profile-1',
      remoteResult,
      currentConfig: baseConfig,
      applyAIProfileToConfig: applyAIProfileToConfigStub,
      now: () => 'now',
    });
    expect(resolution.kind).toBe('remote-fail-with-user-profile');
    if (resolution.kind === 'remote-fail-with-user-profile') {
      expect(resolution.nextConfig.profileOrigin?.profileId).toBe('local-profile-1');
    }
  });

  it('path 3 — remote-fail-without-user-profile surfaces failureReason', () => {
    const core = createModelConfigProfileControllerCore({
      scopeRef,
      service: fakeService,
      userProfilesSource: userSource([]),
    });
    const remoteResult: AIProfileApplyResult = {
      success: false,
      config: null,
      failureReason: 'profile not in catalog',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'unknown',
      remoteResult,
      currentConfig: baseConfig,
      applyAIProfileToConfig: applyAIProfileToConfigStub,
      now: () => 'now',
    });
    expect(resolution.kind).toBe('remote-fail-without-user-profile');
    if (resolution.kind === 'remote-fail-without-user-profile') {
      expect(resolution.failureReason).toBe('profile not in catalog');
    }
  });

  it('path 4 — network-error preserves error message', () => {
    const core = createModelConfigProfileControllerCore({ scopeRef, service: fakeService });
    const resolution = core.resolveNetworkError({ profileId: 'any', error: new Error('boom') });
    expect(resolution.kind).toBe('network-error');
    if (resolution.kind === 'network-error') {
      expect(resolution.failureReason).toBe('boom');
    }
  });

  it('never produces placeholder success on remote fail', () => {
    const core = createModelConfigProfileControllerCore({ scopeRef, service: fakeService });
    const remoteResult: AIProfileApplyResult = {
      success: false,
      config: null,
      failureReason: 'route down',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'missing',
      remoteResult,
      currentConfig: baseConfig,
      applyAIProfileToConfig: applyAIProfileToConfigStub,
      now: () => 'now',
    });
    expect(resolution.kind).not.toBe('remote-success');
  });
});
