// Unit tests for preload security boundary (RL-IPC-004)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const preloadSource = readFileSync(
  path.join(testDir, '..', 'src', 'preload', 'index.ts'),
  'utf-8',
);

// Re-extract the listener registry pattern from preload/index.ts for unit testing
function createListenerRegistry() {
  const registry = new Map<string, { channel: string; handler: (...args: unknown[]) => void }>();
  let nextId = 0;

  function addListener(channel: string, callback: (...args: unknown[]) => void): string {
    const id = `l_${++nextId}`;
    registry.set(id, { channel, handler: callback });
    return id;
  }

  function removeListener(id: string): boolean {
    return registry.delete(id);
  }

  return { addListener, removeListener, registry };
}

// ─── RL-IPC-004 — Preload Security Boundary ─────────────────────────────

describe('RL-IPC-004 — Preload Security Boundary', () => {
  it('never exposes raw ipcRenderer via contextBridge', () => {
    // Must use wrapped api object, never raw ipcRenderer
    assert.ok(
      preloadSource.includes("contextBridge.exposeInMainWorld('nimiRelay', api)"),
      'must expose wrapped api object via contextBridge',
    );
    assert.ok(
      !preloadSource.includes("exposeInMainWorld('nimiRelay', ipcRenderer)"),
      'must not expose raw ipcRenderer',
    );
  });

  it('api object wraps ipcRenderer.invoke, never returns ipcRenderer directly', () => {
    const apiStart = preloadSource.indexOf('const api');
    const apiEnd = preloadSource.indexOf("contextBridge.exposeInMainWorld");
    const apiBlock = apiStart >= 0 && apiEnd > apiStart
      ? preloadSource.slice(apiStart, apiEnd)
      : '';
    assert.ok(apiBlock.length > 0, 'api object definition must exist');
    assert.ok(
      !apiBlock.includes('ipcRenderer,'),
      'api must not include raw ipcRenderer as property',
    );
  });

  it('exposes typed local artifact listing and media route option methods through preload', () => {
    assert.ok(
      preloadSource.includes("listAssets: (input) => invoke('relay:local:assets:list', input)"),
      'preload should expose relay:local:assets:list',
    );
    assert.ok(
      preloadSource.includes("getOptions: (input) => invoke('relay:media-route:options', input)"),
      'preload should expose relay:media-route:options',
    );
  });

  it('listener functions return string IDs, not functions', () => {
    const { addListener } = createListenerRegistry();

    const id1 = addListener('relay:stream:chunk', () => {});
    const id2 = addListener('relay:stream:end', () => {});

    assert.equal(typeof id1, 'string', 'listener ID must be a string');
    assert.equal(typeof id2, 'string', 'listener ID must be a string');
    assert.ok(id1.startsWith('l_'), 'ID format: l_{n}');
    assert.notEqual(id1, id2, 'IDs must be unique');
  });

  it('removeListener cleans up registry entry', () => {
    const { addListener, removeListener, registry } = createListenerRegistry();

    const id = addListener('relay:stream:chunk', () => {});
    assert.equal(registry.size, 1);

    const removed = removeListener(id);
    assert.equal(removed, true, 'should return true for existing entry');
    assert.equal(registry.size, 0, 'registry should be empty after removal');
  });

  it('removeListener returns false for unknown ID', () => {
    const { removeListener } = createListenerRegistry();
    assert.equal(removeListener('l_unknown'), false);
  });

  it('listener handler is preserved in registry', () => {
    const { addListener, registry } = createListenerRegistry();
    let called = false;
    const handler = () => { called = true; };
    const id = addListener('relay:stream:chunk', handler);

    const entry = registry.get(id)!;
    assert.equal(entry.channel, 'relay:stream:chunk');
    entry.handler();
    assert.equal(called, true, 'handler should be callable from registry');
  });
});

// ─── Listener Registry Memory Management ──────────────────────────────────

describe('RL-IPC-004 — Listener Registry Memory Management', () => {
  it('accumulates entries on repeated addListener calls', () => {
    const { addListener, registry } = createListenerRegistry();
    for (let i = 0; i < 100; i++) {
      addListener('relay:stream:chunk', () => {});
    }
    assert.equal(registry.size, 100, 'all 100 listeners should be stored');
  });

  it('removeListener reduces registry size', () => {
    const { addListener, removeListener, registry } = createListenerRegistry();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(addListener('relay:stream:chunk', () => {}));
    }
    assert.equal(registry.size, 50);

    for (const id of ids) {
      removeListener(id);
    }
    assert.equal(registry.size, 0, 'registry should be empty after removing all listeners');
  });

  it('duplicate removeListener on same ID is idempotent', () => {
    const { addListener, removeListener, registry } = createListenerRegistry();
    const id = addListener('relay:stream:chunk', () => {});
    assert.equal(registry.size, 1);

    assert.equal(removeListener(id), true, 'first remove should return true');
    assert.equal(removeListener(id), false, 'second remove should return false');
    assert.equal(removeListener(id), false, 'third remove should return false');
    assert.equal(registry.size, 0, 'registry should remain empty');
  });

  it('each addListener generates a unique ID', () => {
    const { addListener } = createListenerRegistry();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      ids.add(addListener('relay:stream:chunk', () => {}));
    }
    assert.equal(ids.size, 200, 'all 200 IDs should be unique');
  });

  it('listeners for different channels are independent', () => {
    const { addListener, removeListener, registry } = createListenerRegistry();

    const id1 = addListener('relay:stream:chunk', () => {});
    const id2 = addListener('relay:stream:end', () => {});
    const id3 = addListener('relay:stream:error', () => {});

    assert.equal(registry.size, 3);

    removeListener(id2);
    assert.equal(registry.size, 2);

    assert.ok(registry.has(id1));
    assert.ok(!registry.has(id2));
    assert.ok(registry.has(id3));
  });

  it('channel is preserved correctly in registry entries', () => {
    const { addListener, registry } = createListenerRegistry();

    const id1 = addListener('relay:stream:chunk', () => {});
    const id2 = addListener('relay:realtime:message', () => {});

    assert.equal(registry.get(id1)!.channel, 'relay:stream:chunk');
    assert.equal(registry.get(id2)!.channel, 'relay:realtime:message');
  });
});
