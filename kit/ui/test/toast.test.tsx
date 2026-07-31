import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  getNimiToastSnapshot,
  NimiToaster,
  nimiToast,
  NIMI_TOAST_MAX_VISIBLE,
  subscribeNimiToasts,
  type NimiToastTone,
} from '../src/index.js';

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

function mountToaster(node: React.ReactNode = <NimiToaster />) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root?.render(node);
  });
}

beforeEach(() => {
  nimiToast.clear();
});

afterEach(async () => {
  // Restore real timers before unmounting: `flush()` relies on setTimeout.
  vi.useRealTimers();
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
  nimiToast.clear();
  document.body.innerHTML = '';
});

test('imperative API resolves durations, stable snapshots, and dismiss/clear', () => {
  const id = nimiToast.show({ tone: 'warning', title: 'Cache', message: 'Cache almost full.' });
  expect(id).toMatch(/^nimi-toast-\d+$/);
  const record = getNimiToastSnapshot().find((toast) => toast.id === id);
  expect(record).toMatchObject({
    tone: 'warning',
    title: 'Cache',
    message: 'Cache almost full.',
    durationMs: 6000,
  });
  expect(typeof record?.createdAt).toBe('number');

  const cases: Array<[NimiToastTone, number]> = [
    ['success', 4000],
    ['info', 4000],
    ['neutral', 4000],
    ['warning', 6000],
    ['danger', 8000],
  ];
  for (const [tone, expected] of cases) {
    nimiToast.clear();
    const toneId = nimiToast.show({ tone, message: `${tone} message` });
    expect(getNimiToastSnapshot().find((toast) => toast.id === toneId)?.durationMs).toBe(expected);
  }
  nimiToast.clear();

  const stickyId = nimiToast.show({ tone: 'info', message: 'stay', sticky: true });
  expect(getNimiToastSnapshot().find((toast) => toast.id === stickyId)?.durationMs).toBe(Infinity);
  const infinityId = nimiToast.show({ tone: 'info', message: 'stay', durationMs: Infinity });
  expect(getNimiToastSnapshot().find((toast) => toast.id === infinityId)?.durationMs).toBe(Infinity);
  const customId = nimiToast.show({ tone: 'info', message: 'custom', durationMs: 1234 });
  expect(getNimiToastSnapshot().find((toast) => toast.id === customId)?.durationMs).toBe(1234);

  // Snapshot reference is stable while the visible set is unchanged.
  const before = getNimiToastSnapshot();
  expect(getNimiToastSnapshot()).toBe(before);

  // Subscribers are notified on change and can unsubscribe.
  const listener = vi.fn();
  const unsubscribe = subscribeNimiToasts(listener);
  const dangerId = nimiToast.danger('boom');
  expect(listener).toHaveBeenCalled();
  expect(getNimiToastSnapshot()).not.toBe(before);
  expect(getNimiToastSnapshot().some((toast) => toast.id === dangerId)).toBe(true);
  nimiToast.dismiss(dangerId);
  expect(getNimiToastSnapshot().some((toast) => toast.id === dangerId)).toBe(false);
  unsubscribe();

  nimiToast.clear();
  expect(getNimiToastSnapshot()).toHaveLength(0);
});

test('NimiToaster portals tone chrome, role, content, and icon into body', async () => {
  // Raised before the toaster mounts; the module-level store must render it
  // as soon as the toaster appears.
  act(() => {
    nimiToast.show({ tone: 'danger', title: 'Bridge down', message: 'Bridge connection lost.' });
  });
  await mountToaster();

  const viewport = document.body.querySelector('.nimi-toast-viewport');
  expect(viewport).toBeTruthy();
  expect(viewport?.getAttribute('aria-live')).toBe('polite');

  const toast = document.body.querySelector('.nimi-toast') as HTMLElement;
  expect(toast.className).toContain('nimi-toast--danger');
  expect(toast.getAttribute('role')).toBe('alert');
  expect(toast.getAttribute('data-nimi-toast-tone')).toBe('danger');
  expect(toast.querySelector('.nimi-toast__title')?.textContent).toBe('Bridge down');
  expect(toast.querySelector('.nimi-toast__message')?.textContent).toBe('Bridge connection lost.');
  expect(toast.querySelector('.nimi-toast__icon svg')).toBeTruthy();
  expect(toast.querySelector('.nimi-toast__close')?.getAttribute('aria-label')).toBe('Dismiss');

  act(() => {
    nimiToast.info('Runtime check scheduled.');
  });
  const infoToast = document.body.querySelector('.nimi-toast--info');
  expect(infoToast?.getAttribute('role')).toBe('status');
});

test('timed toasts auto-dismiss while sticky toasts stay', async () => {
  vi.useFakeTimers();
  await mountToaster();

  act(() => {
    nimiToast.success('short lived');
  });
  expect(getNimiToastSnapshot()).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(3999);
  });
  expect(getNimiToastSnapshot()).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(getNimiToastSnapshot()).toHaveLength(0);

  act(() => {
    nimiToast.warning('stay', { sticky: true });
  });
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  expect(getNimiToastSnapshot()).toHaveLength(1);

  // Motion's exit animations are scheduled on the faked clock and would
  // never resolve once fake timers are discarded; unmount inside act while
  // they are still active instead of waiting for exits to finish.
  await act(async () => {
    root?.unmount();
  });
  root = null;
});

test('visible cap queues overflow and refills FIFO on dismiss', async () => {
  await mountToaster();

  act(() => {
    for (let index = 1; index <= NIMI_TOAST_MAX_VISIBLE + 1; index += 1) {
      nimiToast.info(`toast ${index}`);
    }
  });
  expect(NIMI_TOAST_MAX_VISIBLE).toBe(4);
  expect(getNimiToastSnapshot().map((toast) => toast.message)).toEqual([
    'toast 1',
    'toast 2',
    'toast 3',
    'toast 4',
  ]);
  expect(document.body.querySelectorAll('.nimi-toast')).toHaveLength(4);

  const firstId = getNimiToastSnapshot()[0]!.id;
  act(() => {
    nimiToast.dismiss(firstId);
  });
  expect(getNimiToastSnapshot().map((toast) => toast.message)).toEqual([
    'toast 2',
    'toast 3',
    'toast 4',
    'toast 5',
  ]);
});

test('action button runs its handler and dismisses the toast', async () => {
  await mountToaster();

  const onClick = vi.fn();
  act(() => {
    nimiToast.show({
      tone: 'info',
      message: 'Export moved to trash.',
      action: { label: 'Undo', onClick },
    });
  });
  const actionButton = document.body.querySelector('.nimi-toast__action') as HTMLButtonElement;
  expect(actionButton.textContent).toBe('Undo');

  await act(async () => {
    actionButton.click();
  });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(getNimiToastSnapshot()).toHaveLength(0);
});

test('hover pauses auto-dismiss and leaving resumes the remaining time', async () => {
  vi.useFakeTimers();
  await mountToaster();

  act(() => {
    nimiToast.success('hover me');
  });
  const toast = document.body.querySelector('.nimi-toast') as HTMLElement;
  expect(toast).toBeTruthy();

  // 1000ms of the 4000ms budget elapses before the hover starts.
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  act(() => {
    toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  // Hovered far past the original deadline: must still be visible.
  act(() => {
    vi.advanceTimersByTime(10000);
  });
  expect(getNimiToastSnapshot()).toHaveLength(1);

  act(() => {
    toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });
  // Only the remaining ~3000ms runs after the hover ends.
  act(() => {
    vi.advanceTimersByTime(2999);
  });
  expect(getNimiToastSnapshot()).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(getNimiToastSnapshot()).toHaveLength(0);

  // Motion's exit animations are scheduled on the faked clock and would
  // never resolve once fake timers are discarded; unmount inside act while
  // they are still active instead of waiting for exits to finish.
  await act(async () => {
    root?.unmount();
  });
  root = null;
});

test('reduced motion renders through the fade branch without errors', async () => {
  await mountToaster(
    <MotionConfig reducedMotion="always">
      <NimiToaster />
    </MotionConfig>,
  );

  act(() => {
    nimiToast.info('calm update');
  });
  const toast = document.body.querySelector('.nimi-toast--info');
  expect(toast?.textContent).toContain('calm update');
});
