import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentCenterAvatarPreview,
  resolveAgentCenterAvatarPreviewServiceResult,
} from '../src/agent-center-preview.js';
import {
  isAvatarControlledPreviewSurfaceRef,
  normalizeAvatarControlledPreviewSurfaceRef,
} from '../src/headless.js';

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

function renderPreview(
  props: Parameters<typeof AgentCenterAvatarPreview>[0],
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<AgentCenterAvatarPreview {...props} />);
  });
  return container;
}

describe('AgentCenterAvatarPreview', () => {
  it('admits a controlled renderer image for a typed ready result', () => {
    const result = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'live2d',
      avatarAssetRef: 'live2d_111111111111',
      previewMaterialRef: 'agent-center-avatar-asset:account-1:local-agent-ren:live2d:live2d_111111111111',
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
    });

    expect(result).toMatchObject({
      state: 'ready',
      previewImageRef: '/__nimi/avatar-preview/live2d/123',
    });
    const view = renderPreview({ result, label: 'Ren' });
    const surface = view.querySelector('[data-avatar-preview-state="ready"]');
    expect(surface?.getAttribute('data-avatar-preview-backend-kind')).toBe('live2d');
  });

  it('fails closed for blank or externally hosted preview output', () => {
    const external = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'ready',
      previewTier: 'avatar_preview_service',
      backendKind: 'vrm',
      avatarAssetRef: 'vrm_222222222222',
      previewMaterialRef: 'agent-center-avatar-asset:account-1:local-agent-ren:vrm:vrm_222222222222',
      previewImageRef: 'https://example.com/preview.png',
    });

    expect(external).toMatchObject({ state: 'unavailable' });
  });

  it('normalizes only Avatar-controlled same-origin preview surfaces', () => {
    const blobRef = `blob:${globalThis.location.origin}/avatar-preview/123`;
    expect(normalizeAvatarControlledPreviewSurfaceRef(' /__nimi/avatar-preview/live2d/123 '))
      .toBe('/__nimi/avatar-preview/live2d/123');
    expect(normalizeAvatarControlledPreviewSurfaceRef(blobRef)).toBe(blobRef);
    expect(isAvatarControlledPreviewSurfaceRef(blobRef)).toBe(true);
    expect(isAvatarControlledPreviewSurfaceRef('//example.com/preview.png')).toBe(false);
    expect(isAvatarControlledPreviewSurfaceRef('https://example.com/preview.png')).toBe(false);
    expect(isAvatarControlledPreviewSurfaceRef('blob:https://example.com/preview.png')).toBe(false);
  });

  it('renders the typed non-ready state without a placeholder success claim', () => {
    const result = resolveAgentCenterAvatarPreviewServiceResult({
      previewState: 'loading',
      previewTier: 'avatar_preview_service',
      backendKind: 'live2d',
      avatarAssetRef: 'live2d_111111111111',
      previewFailureReason: 'renderer loading',
    });
    const view = renderPreview({ result, label: 'Ren', fallback: 'Loading' });
    const surface = view.querySelector('[data-avatar-preview-state="loading"]');
    expect(surface?.textContent).toBe('Loading');
  });
});
