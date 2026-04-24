import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useModelConfigProfileController } from '../src/headless.js';
import type {
  AIConfig,
  AIProfile,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import type { SharedAIConfigService } from '@nimiplatform/nimi-kit/core/model-config';
import type { ModelConfigProfileCopy } from '../src/types.js';

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
};

function HookHarness(props: { service: SharedAIConfigService }) {
  const controller = useModelConfigProfileController({
    scopeRef,
    aiConfigService: props.service,
    copy,
    currentOrigin: null,
    applyAIProfileToConfig: (config) => config,
  });
  return (
    <button type="button" onClick={() => controller.onApply('remote-profile')}>
      apply
    </button>
  );
}

describe('useModelConfigProfileController', () => {
  it('commits remote-success nextConfig through SharedAIConfigService', async () => {
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
        }),
      },
    };

    await render(<HookHarness service={service} />);
    const button = container?.querySelector('button');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].profileOrigin?.profileId).toBe('remote-profile');
  });
});
