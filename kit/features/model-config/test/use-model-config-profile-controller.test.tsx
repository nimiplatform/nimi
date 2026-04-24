// Wave 2 prerequisite test — exercises the four canonical apply paths for
// useModelConfigProfileController (D-AIPC-005 atomic overwrite contract):
//   path 1: apply-success
//   path 2: apply-remote-fail-with-user-profile
//   path 3: apply-remote-fail-without-user-profile
//   path 4: apply-network-error

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelConfigProfileController } from '../src/headless.js';
import type {
  AIConfig,
  AIProfile,
  AIProfileApplyResult,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import type {
  SharedAIConfigService,
  UserProfilesSource,
} from '@nimiplatform/nimi-kit/core/model-config';
import type {
  ModelConfigProfileController,
  ModelConfigProfileCopy,
} from '../src/types.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await flush();
    await flush();
  });
}

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: AIConfig = {
  scopeRef,
  capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
  profileOrigin: null,
};

const copy: ModelConfigProfileCopy = {
  sectionTitle: 'Profile',
  summaryLabel: 'AI Profile',
  emptySummaryLabel: 'No profile applied',
  applyButtonLabel: 'Apply',
  changeButtonLabel: 'Change',
  manageButtonTitle: 'Manage',
  modalTitle: 'Apply profile',
  modalHint: 'Select a profile.',
  loadingLabel: 'Loading...',
  emptyLabel: 'No profiles available.',
  currentBadgeLabel: 'Current',
  cancelLabel: 'Cancel',
  confirmLabel: 'Apply',
  applyingLabel: 'Applying...',
};

const remoteProfile: AIProfile = {
  profileId: 'remote-profile',
  title: 'Remote profile',
  description: '',
  tags: [],
  capabilities: {},
};

const localUserProfile: AIProfile = {
  profileId: 'local-user-profile',
  title: 'Local user profile',
  description: '',
  tags: [],
  capabilities: {},
};

const appliedConfig: AIConfig = {
  ...baseConfig,
  profileOrigin: { profileId: 'remote-profile', title: 'Remote profile', appliedAt: 'now' },
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

type HarnessProps = {
  service: SharedAIConfigService;
  userProfilesSource?: UserProfilesSource;
  captured: { controller: ModelConfigProfileController | null };
  profileId: string;
};

function Harness(props: HarnessProps) {
  const controller = useModelConfigProfileController({
    scopeRef,
    aiConfigService: props.service,
    copy,
    currentOrigin: null,
    applyAIProfileToConfig: applyAIProfileToConfigStub,
    userProfilesSource: props.userProfilesSource,
  });
  props.captured.controller = controller;
  return (
    <button type="button" onClick={() => controller.onApply(props.profileId)}>
      apply
    </button>
  );
}

describe('useModelConfigProfileController apply paths', () => {
  it('path 1 — apply-success commits remote nextConfig through SharedAIConfigService', async () => {
    let currentConfig = baseConfig;
    const updates: AIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => currentConfig,
        update: (_scope, next) => {
          currentConfig = next;
          updates.push(next);
        },
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [remoteProfile],
        apply: async () => ({
          success: true,
          config: appliedConfig,
          failureReason: null,
          probeWarnings: [],
        }) satisfies AIProfileApplyResult,
      },
    };

    const captured: HarnessProps['captured'] = { controller: null };
    await render(
      <Harness
        service={service}
        captured={captured}
        profileId="remote-profile"
      />,
    );

    const button = container?.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].profileOrigin?.profileId).toBe('remote-profile');
    expect(captured.controller?.error).toBeNull();
    expect(captured.controller?.applying).toBe(false);
  });

  it('path 2 — apply-remote-fail-with-user-profile falls through to local apply (D-AIPC-005 atomic)', async () => {
    let currentConfig = baseConfig;
    const updates: AIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => currentConfig,
        update: (_scope, next) => {
          currentConfig = next;
          updates.push(next);
        },
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [],
        apply: async () => ({
          success: false,
          config: null,
          failureReason: 'remote unavailable',
          probeWarnings: [],
        }) satisfies AIProfileApplyResult,
      },
    };

    const captured: HarnessProps['captured'] = { controller: null };
    await render(
      <Harness
        service={service}
        userProfilesSource={userSource([localUserProfile])}
        captured={captured}
        profileId="local-user-profile"
      />,
    );

    const button = container?.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].profileOrigin?.profileId).toBe('local-user-profile');
    expect(captured.controller?.error).toBeNull();
  });

  it('path 3 — apply-remote-fail-without-user-profile surfaces failureReason and does not commit', async () => {
    let currentConfig = baseConfig;
    const updates: AIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => currentConfig,
        update: (_scope, next) => {
          currentConfig = next;
          updates.push(next);
        },
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [],
        apply: async () => ({
          success: false,
          config: null,
          failureReason: 'profile not in catalog',
          probeWarnings: [],
        }) satisfies AIProfileApplyResult,
      },
    };

    const captured: HarnessProps['captured'] = { controller: null };
    await render(
      <Harness
        service={service}
        userProfilesSource={userSource([])}
        captured={captured}
        profileId="unknown-profile"
      />,
    );

    const button = container?.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(0);
    expect(captured.controller?.error).toBe('profile not in catalog');
    expect(captured.controller?.applying).toBe(false);
  });

  it('path 4 — apply-network-error preserves error message and does not commit', async () => {
    let currentConfig = baseConfig;
    const updates: AIConfig[] = [];
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => currentConfig,
        update: (_scope, next) => {
          currentConfig = next;
          updates.push(next);
        },
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [],
        apply: async () => {
          throw new Error('network boom');
        },
      },
    };

    const captured: HarnessProps['captured'] = { controller: null };
    await render(
      <Harness
        service={service}
        captured={captured}
        profileId="any-profile"
      />,
    );

    const button = container?.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(0);
    expect(captured.controller?.error).toBe('network boom');
    expect(captured.controller?.applying).toBe(false);
  });
});
