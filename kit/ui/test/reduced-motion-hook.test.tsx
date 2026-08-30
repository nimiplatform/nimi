import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const motionState = vi.hoisted(() => ({
  reduced: false,
  mode: 'never' as 'always' | 'never' | 'user',
}));

vi.mock('motion/react', async () => {
  const React = await import('react');
  return {
    AnimatePresence: ({ children }: { children?: unknown }) => children ?? null,
    MotionConfig: ({ children }: { children?: unknown }) => children ?? null,
    MotionConfigContext: React.createContext({
      get reducedMotion() { return motionState.mode; },
    }),
    animate: vi.fn(),
    motion: {},
    useReducedMotion: () => motionState.reduced,
  };
});

import { useNimiReducedMotion } from '../src/motion/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let currentValue = false;

function Probe() {
  currentValue = useNimiReducedMotion();
  return <span>{String(currentValue)}</span>;
}

function mountProbe(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
}

beforeEach(() => {
  motionState.reduced = false;
  motionState.mode = 'never';
  currentValue = false;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

test('an OS reduce request cannot be masked by a stale Motion hook false', () => {
  motionState.mode = 'user';
  let matches = false;
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  const media = {
    get matches() { return matches; },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => {
      listener = next;
    },
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));

  mountProbe();
  expect(currentValue).toBe(false);
  act(() => {
    matches = true;
    listener?.({ matches: true } as MediaQueryListEvent);
  });
  expect(currentValue).toBe(true);
  act(() => {
    matches = false;
    listener?.({ matches: false } as MediaQueryListEvent);
  });
  expect(currentValue).toBe(false);
});

test('an explicit Motion reduce request remains active without OS reduce', () => {
  motionState.mode = 'always';
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mountProbe();
  expect(currentValue).toBe(true);
});

test('the default Motion never value cannot override an OS reduce request', () => {
  motionState.mode = 'never';
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mountProbe();
  expect(currentValue).toBe(true);
});
