import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { useTypedProjection, type TypedProjectionState } from '../src/index.js';

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

function mount(element: ReactElement) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  root.render(element);
}

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
  document.body.innerHTML = '';
});

test('useTypedProjection fails closed and reloads without placeholder data', async () => {
  const snapshots: Array<TypedProjectionState<string>> = [];
  let calls = 0;

  function Probe() {
    const projection = useTypedProjection(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('projection unavailable');
      }
      return `projection-${calls}`;
    });
    snapshots.push(projection);
    return (
      <button type="button" onClick={projection.reload}>
        {projection.status}:{projection.data ?? projection.error ?? 'pending'}
      </button>
    );
  }

  await act(async () => {
    mount(<Probe />);
    await flush();
    await flush();
  });

  expect(snapshots.at(-1)?.status).toBe('failed');
  expect(snapshots.at(-1)?.data).toBeNull();
  expect(snapshots.at(-1)?.error).toBe('projection unavailable');
  expect(container?.textContent).toBe('failed:projection unavailable');

  await act(async () => {
    snapshots.at(-1)?.reload();
    await flush();
    await flush();
  });

  expect(snapshots.at(-1)?.status).toBe('ready');
  expect(snapshots.at(-1)?.data).toBe('projection-2');
  expect(snapshots.at(-1)?.error).toBeNull();
  expect(container?.textContent).toBe('ready:projection-2');
});

test('useTypedProjection uses the fail-closed fallback for empty errors', async () => {
  const snapshots: Array<TypedProjectionState<string>> = [];

  function Probe() {
    const projection = useTypedProjection(
      async () => {
        throw '';
      },
      { failClosedMessage: 'typed projection unavailable' },
    );
    snapshots.push(projection);
    return <span>{projection.error ?? projection.status}</span>;
  }

  await act(async () => {
    mount(<Probe />);
    await flush();
    await flush();
  });

  expect(snapshots.at(-1)?.status).toBe('failed');
  expect(snapshots.at(-1)?.data).toBeNull();
  expect(snapshots.at(-1)?.error).toBe('typed projection unavailable');
});

test('useTypedProjection is exported as a Kit UI primitive without app or SDK ownership', () => {
  const hookSource = readFileSync(resolve(import.meta.dirname, '../src/hooks/typed-projection.ts'), 'utf8');
  const indexSource = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8');

  expect(indexSource).toMatch(/hooks\/typed-projection/);
  expect(hookSource).toMatch(/export function useTypedProjection/);
  expect(hookSource).toMatch(/status: 'failed'/);
  expect(hookSource).toMatch(/data: null/);
  expect(hookSource).toMatch(/useRef\(load\)/);
  expect(hookSource).not.toMatch(/from ['"].*apps\//);
  expect(hookSource).not.toMatch(/@renderer|@runtime|@nimiplatform\/sdk/);
});
