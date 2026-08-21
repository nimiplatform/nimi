import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvatarStage } from '../src/components/avatar-stage.js';
import { createLazyLive2dAvatarRenderer } from '../src/live2d.js';
import type { AvatarBackendKind, AvatarStageRendererContext } from '../src/types.js';
import { createLazyVrmAvatarRenderer } from '../src/vrm.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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

function buildStageSnapshot(backendKind: AvatarBackendKind, assetRef: string) {
  return {
    presentation: {
      backendKind,
      avatarAssetRef: assetRef,
    },
    interaction: {
      phase: 'idle' as const,
    },
  };
}

function buildRendererContext(backendKind: 'vrm' | 'live2d', assetRef: string): AvatarStageRendererContext {
  return {
    label: 'Companion',
    fallback: 'C',
    renderer: {
      kind: backendKind,
      assetRef,
      mediaUrl: assetRef,
      posterUrl: null,
      backendLabel: backendKind === 'vrm' ? 'VRM' : 'Live2D',
      prefersMotion: true,
    },
    snapshot: {
      presentation: {
        backendKind,
        avatarAssetRef: assetRef,
      },
      interaction: {
        phase: 'speaking',
      },
    },
    size: 'md',
    frameClassName: 'h-28 w-28',
  };
}

describe('avatar stage media resilience', () => {
  it('falls back to the letter mark when the poster image fails to load', async () => {
    await render(
      <AvatarStage
        snapshot={buildStageSnapshot('sprite2d', 'desktop-avatar://resource-6/avatar.png')}
        label="Companion"
        fallbackLabel="C"
        imageUrl="https://cdn.nimi.test/broken-avatar.png"
        size="md"
      />,
    );

    const image = container?.querySelector('img');
    expect(image).toBeTruthy();

    await act(async () => {
      image?.dispatchEvent(new Event('error'));
      await flush();
    });

    expect(container?.querySelector('img')).toBeNull();
    expect(container?.textContent).toContain('C');
  });

  it('marks the decorative video as aria-hidden and falls back when it fails', async () => {
    await render(
      <AvatarStage
        snapshot={buildStageSnapshot('video', 'https://cdn.nimi.test/avatar-loop.mp4')}
        label="Companion"
        fallbackLabel="C"
        size="md"
      />,
    );

    const video = container?.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('aria-hidden')).toBe('true');

    await act(async () => {
      video?.dispatchEvent(new Event('error'));
      await flush();
    });

    expect(container?.querySelector('video')).toBeNull();
    expect(container?.textContent).toContain('C');
  });
});

describe('lazy avatar viewport error boundary', () => {
  it('reports a vrm chunk failure and retries the loader on demand', async () => {
    let attempts = 0;
    const onViewportError = vi.fn();
    const renderer = createLazyVrmAvatarRenderer({
      loadViewport: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('chunk load failed');
        return { default: () => <span>VRM ready</span> };
      },
      viewportErrorLabel: 'Avatar failed to load.',
      retryViewportLabel: 'Try again',
      onViewportError,
    });

    await render(renderer(buildRendererContext('vrm', 'https://cdn.nimi.test/avatar.vrm')));
    await act(async () => {
      await flush();
      await flush();
    });

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('Avatar failed to load.');
    expect(onViewportError).toHaveBeenCalledOnce();

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(attempts).toBe(2);
    expect(container?.textContent).toContain('VRM ready');
  });

  it('keeps retry operable inside a small AvatarStage failure frame', async () => {
    const renderer = createLazyVrmAvatarRenderer({
      loadViewport: async () => {
        throw new Error('small viewport failed');
      },
      viewportErrorLabel: 'Avatar failed to load.',
      retryViewportLabel: 'Try again',
    });

    await render(
      <AvatarStage
        snapshot={buildStageSnapshot('vrm', 'https://cdn.nimi.test/avatar.vrm')}
        label="Companion"
        fallbackLabel="C"
        size="sm"
        showStatusBadge={false}
        renderers={{ vrm: renderer }}
      />,
    );
    await act(async () => {
      await flush();
      await flush();
    });

    const failure = container?.querySelector('[data-avatar-viewport-failure-layout="compact"]');
    const retry = failure?.querySelector('button');
    expect(failure).toBeTruthy();
    expect(failure?.className).toContain('inset-2');
    expect(failure?.textContent).toContain('Avatar failed to load.');
    expect(retry?.textContent).toContain('Try again');
    expect(retry?.getAttribute('aria-label')).toBe('Try again: Avatar failed to load.');
  });

  it('degrades to the shared placeholder surface when the live2d viewport throws', async () => {
    const renderer = createLazyLive2dAvatarRenderer({
      loadViewport: () => Promise.resolve({
        default: () => {
          throw new Error('viewport render failed');
        },
      }),
    });

    await render(renderer(buildRendererContext('live2d', 'desktop-avatar://resource-7/airi.model3.json')));
    await act(async () => {
      await flush();
      await flush();
    });

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('Avatar could not be loaded.');
    expect(container?.textContent).toContain('airi.model3.json');
  });
});
