import { describe, expect, it } from 'vitest';
import {
  createModelConfigProfileControllerCore,
  type SharedAIConfigService,
  type UserProfilesSource,
} from '@nimiplatform/kit/core/model-config';
import type {
  NimiAIConfig,
  NimiAIProfile,
  NimiAIProfileApplyResult,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';

const scopeRef: NimiAIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: NimiAIConfig = {
  scopeRef,
  capabilities: { logicalModelIds: {}, targetRefs: {}, selectedComponents: {}, selectedParams: {} },
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
    previewApply: async () => { throw new Error('test'); },
    apply: async () => ({
      success: false,
      config: null,
      failureReason: 'test',
      outcome: 'failed',
      probeWarnings: [],
    }),
  },
};

const userProfile: NimiAIProfile = {
  profileId: 'local-profile-1',
  title: 'Local Profile',
  description: '',
  tags: [],
  capabilities: {},
};

function userSource(profiles: NimiAIProfile[]): UserProfilesSource {
  return { list: () => profiles };
}

describe('createModelConfigProfileControllerCore', () => {
  it('path 1 — remote-success returns config from remote result without placeholder', () => {
    const core = createModelConfigProfileControllerCore({ scopeRef, service: fakeService });
    const remoteResult: NimiAIProfileApplyResult = {
      success: true,
      config: { ...baseConfig, profileOrigin: { profileId: 'remote', title: 'Remote', appliedAt: 'now' } },
      failureReason: null,
      outcome: 'ready_to_apply',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'remote',
      remoteResult,
      currentConfig: baseConfig,
      now: () => 'now',
    });
    expect(resolution.kind).toBe('remote-success');
    if (resolution.kind === 'remote-success') {
      expect(resolution.nextConfig.profileOrigin?.profileId).toBe('remote');
    }
  });

  it('path 2 — remote failure with user profile still fails closed', () => {
    const core = createModelConfigProfileControllerCore({
      scopeRef,
      service: fakeService,
      userProfilesSource: userSource([userProfile]),
    });
    const remoteResult: NimiAIProfileApplyResult = {
      success: false,
      config: null,
      failureReason: 'remote unavailable',
      outcome: 'failed',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'local-profile-1',
      remoteResult,
      currentConfig: baseConfig,
      now: () => 'now',
    });
    expect(resolution.kind).toBe('remote-fail-without-user-profile');
    if (resolution.kind === 'remote-fail-without-user-profile') {
      expect(resolution.failureReason).toBe('remote unavailable');
    }
  });

  it('path 3 — remote-fail-without-user-profile surfaces failureReason', () => {
    const core = createModelConfigProfileControllerCore({
      scopeRef,
      service: fakeService,
      userProfilesSource: userSource([]),
    });
    const remoteResult: NimiAIProfileApplyResult = {
      success: false,
      config: null,
      failureReason: 'profile not in catalog',
      outcome: 'failed',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'unknown',
      remoteResult,
      currentConfig: baseConfig,
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
    const remoteResult: NimiAIProfileApplyResult = {
      success: false,
      config: null,
      failureReason: 'route down',
      outcome: 'failed',
      probeWarnings: [],
    };
    const resolution = core.resolveRemoteApply({
      profileId: 'missing',
      remoteResult,
      currentConfig: baseConfig,
      now: () => 'now',
    });
    expect(resolution.kind).not.toBe('remote-success');
  });
});
