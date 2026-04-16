import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { AvatarVrmViewportComponentProps } from '../src/vrm.js';
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

describe('lazy avatar vrm renderer surface', () => {
  it('shows the fallback shell before the lazy viewport resolves and swaps in the loaded viewport after', async () => {
    let resolveViewport:
      | ((module: { default: (props: AvatarVrmViewportComponentProps) => ReactNode }) => void)
      | null = null;

    const renderer = createLazyVrmAvatarRenderer({
      loadViewport: () => new Promise((resolve) => {
        resolveViewport = resolve;
      }),
    });

    await render(renderer({
      label: 'Companion',
      fallback: 'C',
      renderer: {
        kind: 'vrm',
        assetRef: 'https://cdn.nimi.test/avatar.vrm',
        mediaUrl: 'https://cdn.nimi.test/avatar.vrm',
        posterUrl: 'https://cdn.nimi.test/avatar.png',
        backendLabel: 'VRM',
        prefersMotion: true,
      },
      snapshot: {
        presentation: {
          backendKind: 'vrm',
          avatarAssetRef: 'https://cdn.nimi.test/avatar.vrm',
          idlePreset: 'companion.idle.soft',
        },
        interaction: {
          phase: 'speaking',
          actionCue: 'Responding',
        },
      },
      size: 'md',
      frameClassName: 'h-28 w-28',
    }));

    expect(container?.textContent).toContain('avatar.vrm');

    await act(async () => {
      resolveViewport?.({
        default: ({ input }) => (
          <div data-testid="lazy-vrm-viewport">
            loaded:{input.assetRef}
          </div>
        ),
      });
      await flush();
      await flush();
    });

    expect(container?.textContent).toContain('loaded:https://cdn.nimi.test/avatar.vrm');
  });
});
