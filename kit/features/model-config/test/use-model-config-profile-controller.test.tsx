// Wave 2 prerequisite test — exercises the canonical apply paths for
// useModelConfigProfileController (D-AIPC-005 atomic overwrite contract):
//   path 1: apply-success
//   path 2: apply-remote-fail-without-user-profile
//   path 3: apply-remote-fail-without-user-profile
//   path 4: apply-network-error

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelConfigProfileController } from '../src/headless.js';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIConfig,
  NimiAIProfile,
  NimiAIProfileApplyResult,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  SharedAIConfigService,
  UserProfilesSource,
} from '@nimiplatform/kit/core/model-config';
import type {
  ModelConfigProfileController,
  ModelConfigProfileCopy,
} from '../src/types.js';
import { makePreviewApplyStub, previewCopyFields } from './profile-preview-fixtures.js';

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

const scopeRef: NimiAIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const requirementDeclaration: NimiAICapabilityRequirementDeclaration = {
  requirementId: 'desktop-chat-text',
  scopeRef,
  requiredSlices: [{
    requirementSliceId: 'chat:text.generate',
    capability: 'text.generate',
    profileSliceRef: 'chat:text.generate',
    readinessPolicy: 'required',
  }],
  setupProjectionPolicy: 'sdk-ai-config-setup-projection',
};

const baseConfig: NimiAIConfig = {
  scopeRef,
  capabilities: { targetRefs: {}, selectedParams: {} },
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
  ...previewCopyFields,
};

const remoteProfile: NimiAIProfile = {
  profileId: 'remote-profile',
  title: 'Remote profile',
  description: '',
  tags: [],
  capabilities: {},
};

const localUserProfile: NimiAIProfile = {
  profileId: 'local-user-profile',
  title: 'Local user profile',
  description: '',
  tags: [],
  capabilities: {},
};

const appliedConfig: NimiAIConfig = {
  ...baseConfig,
  profileOrigin: { profileId: 'remote-profile', title: 'Remote profile', appliedAt: 'now' },
};

function userSource(profiles: NimiAIProfile[]): UserProfilesSource {
  return { list: () => profiles };
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
    requirementDeclaration,
    copy,
    currentOrigin: null,
    userProfilesSource: props.userProfilesSource,
  });
  props.captured.controller = controller;
  return (
    <button type="button" onClick={() => controller.onApply(props.profileId)}>
      apply
    </button>
  );
}

function InlineSourceHarness(props: { service: SharedAIConfigService; tick: number }) {
  useModelConfigProfileController({
    scopeRef,
    aiConfigService: props.service,
    requirementDeclaration,
    copy,
    currentOrigin: null,
    userProfilesSource: { list: () => [localUserProfile] },
  });
  return <div data-tick={props.tick} />;
}

describe('useModelConfigProfileController apply paths', () => {
  it('does not reload profiles when caller passes an inline userProfilesSource on rerender', async () => {
    let listCalls = 0;
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => baseConfig,
        update: () => undefined,
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => {
          listCalls += 1;
          return [remoteProfile];
        },
        previewApply: async () => { throw new Error('not exercised'); },
        apply: async () => ({
          success: true,
          config: appliedConfig,
          failureReason: null,
          outcome: 'ready_to_apply',
          probeWarnings: [],
        }) satisfies NimiAIProfileApplyResult,
      },
    };

    await render(<InlineSourceHarness service={service} tick={0} />);
    expect(listCalls).toBe(1);

    await act(async () => {
      root?.render(<InlineSourceHarness service={service} tick={1} />);
      await flush();
      await flush();
    });

    expect(listCalls).toBe(1);
  });

  it('path 1 — apply-success previews then commits remote nextConfig on confirm', async () => {
    let currentConfig = baseConfig;
    const updates: NimiAIConfig[] = [];
    const applyBaseVersions: Array<string | undefined> = [];
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
        previewApply: makePreviewApplyStub({
          currentConfig: () => currentConfig,
          profilesById: [remoteProfile],
        }),
        apply: async (_scope, _profileId, options) => {
          applyBaseVersions.push(options?.expectedBaseVersion);
          return {
            success: true,
            config: appliedConfig,
            failureReason: null,
            outcome: 'ready_to_apply',
            probeWarnings: [],
          } satisfies NimiAIProfileApplyResult;
        },
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
    // onApply previews; nothing is committed yet (D-AIPC-014).
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });
    expect(updates).toHaveLength(0);
    expect(captured.controller?.preview).toBeTruthy();

    // Explicit confirm commits.
    await act(async () => {
      captured.controller?.onConfirmApply();
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(1);
    expect(applyBaseVersions).toEqual(['base-v1']);
    expect(updates[0].profileOrigin?.profileId).toBe('remote-profile');
    expect(captured.controller?.error).toBeNull();
    expect(captured.controller?.applying).toBe(false);
    expect(captured.controller?.preview).toBeNull();
  });

  it('path 1b — host update rejection after remote success fails closed and preserves preview', async () => {
    let currentConfig = baseConfig;
    let updateCalls = 0;
    const service: SharedAIConfigService = {
      aiConfig: {
        get: () => currentConfig,
        update: async () => {
          updateCalls += 1;
          throw new Error('host commit rejected');
        },
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [remoteProfile],
        previewApply: makePreviewApplyStub({
          currentConfig: () => currentConfig,
          profilesById: [remoteProfile],
        }),
        apply: async () => ({
          success: true,
          config: appliedConfig,
          failureReason: null,
          outcome: 'ready_to_apply',
          probeWarnings: [],
        }) satisfies NimiAIProfileApplyResult,
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
    expect(captured.controller?.preview).toBeTruthy();

    await act(async () => {
      captured.controller?.onConfirmApply();
      await flush();
      await flush();
    });

    expect(updateCalls).toBe(1);
    expect(captured.controller?.error).toBe('host commit rejected');
    expect(captured.controller?.applying).toBe(false);
    expect(captured.controller?.preview).toBeTruthy();
  });

  it('path 2 — preview remote failure with user profile fails closed and never commits', async () => {
    let currentConfig = baseConfig;
    const updates: NimiAIConfig[] = [];
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
        previewApply: async () => { throw new Error('remote unavailable'); },
        apply: async () => ({
          success: false,
          config: null,
          failureReason: 'remote unavailable',
          outcome: 'failed',
          probeWarnings: [],
        }) satisfies NimiAIProfileApplyResult,
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
    expect(updates).toHaveLength(0);
    expect(captured.controller?.preview).toBeNull();
    expect(captured.controller?.error).toBe('remote unavailable');
  });

  it('path 2b — typed preview setup failure fails closed before confirm', async () => {
    let currentConfig = baseConfig;
    const updates: NimiAIConfig[] = [];
    let applyCalls = 0;
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
        previewApply: async () => ({
          before: null,
          after: null,
          outcome: 'setup_required_no_live_config',
          setupProjection: {
            outcome: 'setup_required_no_live_config',
            blockingCapabilities: ['audio.synthesize'],
            reasonCodes: ['required_slice_unresolved'],
            actionRefs: ['setup:tester-settings.audio.synthesize'],
          },
          diff: { identical: true, fields: [] },
          baseVersion: 'base-v1',
          probeWarnings: [],
        }) satisfies NimiAIProfilePreviewResult,
        apply: async () => {
          applyCalls += 1;
          return {
            success: true,
            config: appliedConfig,
            failureReason: null,
            outcome: 'ready_to_apply',
            probeWarnings: [],
          } satisfies NimiAIProfileApplyResult;
        },
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

    expect(captured.controller?.preview).toBeNull();
    expect(captured.controller?.error).toContain('setup_required_no_live_config');
    expect(captured.controller?.error).toContain('audio.synthesize');
    expect(captured.controller?.error).toContain('required_slice_unresolved');

    await act(async () => {
      captured.controller?.onConfirmApply();
      await flush();
      await flush();
    });

    expect(applyCalls).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('path 3 — preview without a known profile fails closed and never commits', async () => {
    let currentConfig = baseConfig;
    const updates: NimiAIConfig[] = [];
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
        // Preview fails closed: profile not in remote catalog, no user profile.
        previewApply: async () => { throw new Error('profile not in catalog'); },
        apply: async () => ({
          success: false,
          config: null,
          failureReason: 'profile not in catalog',
          outcome: 'failed',
          probeWarnings: [],
        }) satisfies NimiAIProfileApplyResult,
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
    expect(captured.controller?.preview).toBeNull();
    expect(captured.controller?.error).toBe('profile not in catalog');
    expect(captured.controller?.previewing).toBe(false);
  });

  it('path 4 — apply-network-error on confirm preserves error message and does not commit', async () => {
    let currentConfig = baseConfig;
    const updates: NimiAIConfig[] = [];
    const networkProfile: NimiAIProfile = {
      profileId: 'any-profile',
      title: 'Any profile',
      description: '',
      tags: [],
      capabilities: {},
    };
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
        list: async () => [networkProfile],
        // Preview succeeds; the network failure happens at commit time.
        previewApply: makePreviewApplyStub({
          currentConfig: () => currentConfig,
          profilesById: [networkProfile],
        }),
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
    expect(captured.controller?.preview).toBeTruthy();

    await act(async () => {
      captured.controller?.onConfirmApply();
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(0);
    expect(captured.controller?.error).toBe('network boom');
    expect(captured.controller?.applying).toBe(false);
  });
});
