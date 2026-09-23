import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';

/**
 * Simulate the observed failure: AnimatePresence keeps rendering the last
 * exiting child and never receives the exit-complete handshake, so the
 * bubble stays mounted after the tooltip closed.
 */
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  const React = await import('react');
  function StickyPresence({ children }: { children?: React.ReactNode }) {
    const lastRef = React.useRef<React.ReactNode>(null);
    if (children !== null && children !== undefined && children !== false) {
      lastRef.current = children;
    }
    return <>{lastRef.current}</>;
  }
  return { ...actual, AnimatePresence: StickyPresence };
});

import { TOOLTIP_EXIT_WATCHDOG_MS, Tooltip, TooltipProvider } from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

test('a closed tooltip whose exit never completes is dropped by the watchdog', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Home">
          <button type="button">Home</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await flush();
  });

  const trigger = container.querySelector('button') as HTMLButtonElement | null;
  expect(trigger).toBeTruthy();

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    await flush();
    await flush();
  });
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Home');

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    await flush();
    await flush();
  });

  // Radix closed the tooltip, but the stuck presence boundary kept the bubble.
  expect(trigger?.getAttribute('aria-describedby')).toBeNull();
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Home');

  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, TOOLTIP_EXIT_WATCHDOG_MS + 100);
    });
  });

  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
});

test('reopening before the watchdog fires keeps the tooltip visible', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <Tooltip content="Home">
          <button type="button">Home</button>
        </Tooltip>
      </TooltipProvider>,
    );
    await flush();
  });

  const trigger = container.querySelector('button') as HTMLButtonElement | null;

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    await flush();
    await flush();
  });
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    await flush();
    await flush();
  });
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    await flush();
    await flush();
  });
  expect(trigger?.getAttribute('aria-describedby')).toBeTruthy();

  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, TOOLTIP_EXIT_WATCHDOG_MS + 100);
    });
  });

  expect(trigger?.getAttribute('aria-describedby')).toBeTruthy();
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('Home');
});
