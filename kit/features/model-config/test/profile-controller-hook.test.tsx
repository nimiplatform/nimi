import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelConfigProfileController } from '../src/headless.js';
import type {
  AIConfig,
  AIProfile,
  AIScopeRef,
} from '@nimiplatform/sdk/ai';
import type { SharedAIConfigService } from '@nimiplatform/kit/core/model-config';
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

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

const baseConfig: AIConfig = {
  scopeRef,
  capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
  profileOrigin: null,
};

const appliedConfig: AIConfig = {
  ...baseConfig,
  profileOrigin: { profileId: 'remote-profile', title: 'Remote profile', appliedAt: 'now' },
};

const remoteProfile: AIProfile = {
  profileId: 'remote-profile',
  title: 'Remote profile',
  description: '',
  tags: [],
  capabilities: {},
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

function HookHarness(props: {
  service: SharedAIConfigService;
  captured: { controller: ModelConfigProfileController | null };
}) {
  const controller = useModelConfigProfileController({
    scopeRef,
    aiConfigService: props.service,
    copy,
    currentOrigin: null,
  });
  props.captured.controller = controller;
  return (
    <button type="button" onClick={() => controller.onApply('remote-profile')}>
      apply
    </button>
  );
}

describe('useModelConfigProfileController', () => {
  it('previews before commit, then commits remote-success only on explicit confirm', async () => {
    let currentConfig = baseConfig;
    const updates: AIConfig[] = [];
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
            probeWarnings: [],
          };
        },
      },
    };

    const captured: { controller: ModelConfigProfileController | null } = { controller: null };
    await render(<HookHarness service={service} captured={captured} />);
    const button = container?.querySelector('button');
    expect(button).toBeTruthy();

    // Step 1: onApply previews only — no commit yet (D-AIPC-014).
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });
    expect(updates).toHaveLength(0);
    expect(captured.controller?.preview).toBeTruthy();
    expect(captured.controller?.preview?.profileId).toBe('remote-profile');

    // Step 2: explicit confirm commits via D-AIPC-005 atomic apply.
    await act(async () => {
      captured.controller?.onConfirmApply();
      await flush();
      await flush();
    });
    expect(updates).toHaveLength(1);
    expect(applyBaseVersions).toEqual(['base-v1']);
    expect(updates[0].profileOrigin?.profileId).toBe('remote-profile');
    expect(captured.controller?.preview).toBeNull();
  });

  it('cancelling the preview discards it without committing', async () => {
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
        previewApply: makePreviewApplyStub({
          currentConfig: () => currentConfig,
          profilesById: [remoteProfile],
        }),
        apply: async () => ({
          success: true,
          config: appliedConfig,
          failureReason: null,
          probeWarnings: [],
        }),
      },
    };

    const captured: { controller: ModelConfigProfileController | null } = { controller: null };
    await render(<HookHarness service={service} captured={captured} />);
    const button = container?.querySelector('button');

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });
    expect(captured.controller?.preview).toBeTruthy();

    await act(async () => {
      captured.controller?.onCancelPreview();
      await flush();
    });
    expect(captured.controller?.preview).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
