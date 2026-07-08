import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentCenter } from '../src/components/AgentCenter.js';
import { buildAgentCenterState } from '../src/state.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function renderAppearance(
  appearance: Parameters<typeof buildAgentCenterState>[0]['appearance'] = {},
  options: {
    readonly appearanceAdapter?: Parameters<typeof AgentCenter>[0]['appearanceAdapter'];
  } = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const state = buildAgentCenterState({
    appearance: {
      status: 'ready',
      backendKind: 'live2d',
      avatarAssetRef: 'asset://avatar/live2d-imported',
      avatarAssetValid: true,
      validationStatus: 'valid',
      backendCapabilityProfileRef: 'profile://avatar/live2d',
      live2dAdapterManifestSource: 'none',
      backgroundRef: null,
      backgroundValid: false,
      avatarAutoplay: true,
      disabledReason: null,
      ...appearance,
    },
  });
  act(() => {
    root?.render(
      <AgentCenter
        appearanceAdapter={options.appearanceAdapter}
        defaultSection="appearance"
        state={state}
      />,
    );
  });
  return container;
}

describe('AgentCenter appearance visual setup surface', () => {
  it('renders the redesigned appearance content below the existing tabs', () => {
    const node = renderAppearance();

    expect(node.querySelector('[data-agent-center-nav-style="desktop-dynamic-expand"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-surface="visual-setup"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-hero="character-preview"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-avatar-card="true"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-avatar-preview="configured"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-primary-action="continue"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-secondary-action="change"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-progress="display-checklist"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-management="asset-import"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-background="chat-scene"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-effects="dynamic"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-diagnostics="collapsed"]')).not.toBeNull();
    expect(node.textContent).toContain('Appearance');
    expect(node.textContent).toContain('Partner avatar');
    expect(node.textContent).toContain('Continue setup');
    expect(node.textContent).toContain('Change avatar');
    expect(node.textContent).not.toContain('Avatar management');
    const progressBar = node.querySelector<HTMLElement>('[data-agent-center-appearance-progress-bar]');
    expect(progressBar?.style.width).toBe('50%');
    expect(node.textContent).toContain('2 / 4');
  });

  it('renders a scoped blocked empty state before avatar setup controls are available', () => {
    const node = renderAppearance({
      status: 'not_configured',
      backendKind: 'live2d',
      avatarAssetRef: null,
      avatarAssetValid: false,
      backendCapabilityProfileRef: null,
      live2dAdapterManifestSource: 'none',
      avatarImportDisabled: true,
      backgroundImportDisabled: true,
      disabledReason: 'zhiyu-agent-center-local-config-scope-required',
    });

    expect(node.querySelector('[data-agent-center-appearance-surface="blocked"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-blocked="scope-required"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-hero="character-preview"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-progress="display-checklist"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-management="asset-import"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-background="chat-scene"]')).toBeNull();
    expect(node.textContent).toContain('Select a local partner before configuring appearance.');
    expect(node.textContent).not.toContain('zhiyu-agent-center-local-config-scope-required');
  });

  it('labels an unconfigured but editable avatar as an import-first state', () => {
    const node = renderAppearance(
      {
        status: 'not_configured',
        backendKind: 'live2d',
        avatarAssetRef: null,
        avatarAssetValid: false,
        backendCapabilityProfileRef: null,
        live2dAdapterManifestSource: 'none',
        disabledReason: null,
      },
      {
        appearanceAdapter: {
          load: async () => ({ status: 'not_configured' }),
          importAvatarAsset: async () => ({ status: 'not_configured' }),
        },
      },
    );

    expect(node.querySelector('[data-agent-center-appearance-surface="import-first"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-hero="character-import"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-avatar-card="true"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-avatar-preview="empty"]')).not.toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-import-options]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-hero="character-preview"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-progress="display-checklist"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-management="asset-import"]')).toBeNull();
    expect(node.querySelector('[data-agent-center-appearance-background="chat-scene"]')).toBeNull();
    expect(node.textContent).toContain('Partner avatar');
    expect(node.textContent).toContain('Avatar is not set');
    expect(node.textContent).toContain('Import Live2D or VRM to show the partner preview here.');
    expect(node.textContent).toContain('Import Live2D');
    expect(node.textContent).toContain('Import VRM');
    expect(node.textContent).toContain('Supports model3.json + textures, or .vrm files');
    expect(node.textContent).toContain('View supported formats');
    expect(node.textContent).not.toContain('Import avatar asset');
    expect(node.textContent).not.toContain('Import Live2D folder');
    expect(node.textContent).not.toContain('Import VRM file');
    expect(node.textContent).not.toContain('Change avatar');
    expect(node.textContent).not.toContain('Select sidecar file');
    expect(node.textContent).not.toContain('Current avatar: LIVE2D');
  });

  it('keeps the active section button compact at phone widths', () => {
    const node = renderAppearance();
    const activeButton = node.querySelector<HTMLElement>('[data-testid="chat-agent-center-section:appearance"]');
    const activeLabel = activeButton?.querySelector<HTMLElement>('span');

    expect(activeButton?.className).toContain('max-[420px]:w-9');
    expect(activeButton?.className).toContain('max-[420px]:px-0');
    expect(activeLabel?.className).toContain('max-[420px]:max-w-0');
    expect(activeLabel?.className).toContain('max-[420px]:opacity-0');
  });
});
