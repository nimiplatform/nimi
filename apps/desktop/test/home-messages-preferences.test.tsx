import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import {
  DEFAULT_HOME_MESSAGE_PREFERENCES,
  HOME_MESSAGE_PREFERENCES_PATH,
  useHomeMessagePreferences,
  type HomeMessagePreferencesController,
  type HomeMessagePreferencesStorage,
} from '../src/shell/renderer/features/home/home-messages-preferences.js';

type Storage = HomeMessagePreferencesStorage & { writes: unknown[]; reads: number; writeAttempts: number };

const MISSING = Object.freeze({ reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });

function storage(input: {
  read: (call: number) => Promise<unknown>;
  write?: (call: number, value: unknown) => Promise<void>;
}): Storage {
  const target: Storage = {
    writes: [],
    reads: 0,
    writeAttempts: 0,
    readJson: async () => {
      target.reads += 1;
      return { value: await input.read(target.reads) as never, sizeBytes: 1 };
    },
    writeJson: async (path, value) => {
      assert.equal(path, HOME_MESSAGE_PREFERENCES_PATH);
      target.writeAttempts += 1;
      await input.write?.(target.writeAttempts, value);
      target.writes.push(value);
      return { value, sizeBytes: 1 };
    },
  };
  return target;
}

/** Lets fire-and-forget reads and writes started by a click finish inside act. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function document(overrides: Record<string, unknown> = {}) {
  return { version: 1, hiddenActivities: {}, hiddenRealmPosts: [], appSourcesOffHome: [], realmPostsOnHome: true, ...overrides };
}

async function withRenderer(run: (render: (store: HomeMessagePreferencesStorage) => Promise<void>, latest: () => HomeMessagePreferencesController) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let current: HomeMessagePreferencesController | null = null;
  function Probe({ store }: { store: HomeMessagePreferencesStorage }) {
    current = useHomeMessagePreferences(store);
    return null;
  }
  try {
    await run(
      async (store) => { await act(async () => { root.render(<Probe store={store} />); }); },
      () => current!,
    );
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

test('a first missing document means defaults, and only the first real change writes it', async () => {
  await withRenderer(async (render, latest) => {
    const store = storage({ read: async () => { throw MISSING; } });
    await render(store);
    assert.deepEqual(latest().state, { status: 'ready', preferences: DEFAULT_HOME_MESSAGE_PREFERENCES });
    assert.equal(store.writes.length, 0, 'opening Home or Settings never writes an empty document');
    let saved = false;
    await act(async () => {
      saved = await latest().apply({ kind: 'hide', activities: [{ activityId: 'act_1', revision: 2 }], realmPostIds: [] });
    });
    assert.equal(saved, true);
    assert.deepEqual(store.writes, [document({ hiddenActivities: { act_1: 2 } })]);
    const state = latest().state;
    assert.equal(state.status === 'ready' && state.preferences.hiddenActivities.act_1, 2);
  });
});

test('any other read failure stays visible and blocks changes until a manual reload', async () => {
  await withRenderer(async (render, latest) => {
    const store = storage({
      read: async (call) => {
        if (call === 1) throw { reasonCode: 'LOCAL_APP_OWNER_UNAVAILABLE' };
        return document({ appSourcesOffHome: ['src_parentos'] });
      },
    });
    await render(store);
    assert.equal(latest().state.status, 'unavailable', 'a failed read is never mistaken for defaults');
    let saved = true;
    await act(async () => { saved = await latest().apply({ kind: 'realm-posts', onHome: false }); });
    assert.equal(saved, false);
    assert.equal(store.writes.length, 0);
    await act(async () => { latest().reload(); });
    await settle();
    const state = latest().state;
    assert.equal(state.status, 'ready');
    assert.deepEqual(state.status === 'ready' ? state.preferences.appSourcesOffHome : null, ['src_parentos']);
  });
});

test('a failed write keeps the previous display and retries the same change on request', async () => {
  await withRenderer(async (render, latest) => {
    const store = storage({
      read: async () => { throw MISSING; },
      write: async (call) => { if (call === 1) throw new Error('disk full'); },
    });
    await render(store);
    await act(async () => { await latest().apply({ kind: 'app-source', sourceRef: 'src_shijing', onHome: false }); });
    assert.equal(latest().saveFailed, true);
    assert.deepEqual(latest().state, { status: 'ready', preferences: DEFAULT_HOME_MESSAGE_PREFERENCES });
    await act(async () => { latest().retrySave(); });
    await settle();
    assert.equal(latest().saveFailed, false);
    assert.equal(store.writeAttempts, 2);
    const state = latest().state;
    assert.deepEqual(state.status === 'ready' ? state.preferences.appSourcesOffHome : null, ['src_shijing']);
  });
});

test('a replaced storage boundary ignores the late read of the previous one', async () => {
  await withRenderer(async (render, latest) => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const first = storage({ read: () => new Promise((resolve) => { resolveFirst = resolve; }) });
    const second = storage({ read: async () => document({ hiddenRealmPosts: ['post_b'] }) });
    await render(first);
    assert.equal(latest().state.status, 'loading');
    await render(second);
    await act(async () => { resolveFirst(document({ hiddenRealmPosts: ['post_a'] })); });
    await settle();
    const state = latest().state;
    assert.deepEqual(state.status === 'ready' ? state.preferences.hiddenRealmPosts : null, ['post_b']);
    assert.equal(second.reads, 1, 'the new boundary reads its own storage');
  });
});
