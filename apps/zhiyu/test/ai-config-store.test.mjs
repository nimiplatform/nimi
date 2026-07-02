import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu AIConfig store validates, saves, loads, subscribes, and enforces scope', async () => {
  const store = await importStore();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: createMemoryStorage() };
  try {
    const scopeRef = store.createZhiyuAgentHomeAIScopeRef();
    assert.deepEqual(scopeRef, {
      kind: 'app',
      ownerId: 'nimi.zhiyu',
      surfaceId: 'zhiyu-agent-home',
    });

    const service = store.createZhiyuAIConfigService();
    const notifications = [];
    const unsubscribe = service.aiConfig.subscribe(scopeRef, (config) => notifications.push(config));
    const current = service.aiConfig.get(scopeRef);
    const saved = service.aiConfig.update(scopeRef, {
      ...current,
      capabilities: {
        ...current.capabilities,
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:text-ready',
          },
        },
      },
    });

    assert.equal(saved.scopeRef.ownerId, 'nimi.zhiyu');
    assert.equal(store.loadZhiyuAIConfig(scopeRef).capabilities.targetRefs['text.generate'].profileBindingId, 'local-runtime:text-ready');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].capabilities.targetRefs['text.generate'].profileBindingId, 'local-runtime:text-ready');
    unsubscribe();

    assert.throws(() => service.aiConfig.update(scopeRef, {
      ...saved,
      scopeRef: {
        kind: 'app',
        ownerId: 'nimi.zhiyu',
        surfaceId: 'other-surface',
      },
    }), /scope/i);
  } finally {
    restoreWindow(previousWindow);
  }
});

test('Zhiyu AIConfig store quarantines invalid and scope-mismatched stored config', async () => {
  const store = await importStore();
  const previousWindow = globalThis.window;
  const scopeRef = store.createZhiyuAgentHomeAIScopeRef();
  const scopeKey = store.zhiyuAIConfigStorageKeyForScopeRef(scopeRef);
  const invalidConfig = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'retired-local-target',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const storage = createMemoryStorage({
    [scopeKey]: JSON.stringify(invalidConfig),
  });
  globalThis.window = { localStorage: storage };
  try {
    const loaded = store.loadZhiyuAIConfig(scopeRef);
    assert.deepEqual(loaded.capabilities.targetRefs, {});
    assert.equal(storage.getItem(scopeKey), null);
    const quarantineKey = Array.from(storage.keys()).find((key) => key.includes(':quarantine:'));
    assert.ok(quarantineKey, 'invalid stored config should be quarantined');
    assert.match(JSON.parse(storage.getItem(quarantineKey)).reason, /targetId is retired/);

    const mismatchConfig = {
      ...loaded,
      scopeRef: {
        kind: 'app',
        ownerId: 'nimi.zhiyu',
        surfaceId: 'wrong-surface',
      },
    };
    storage.setItem(scopeKey, JSON.stringify(mismatchConfig));
    const repaired = store.repairZhiyuAIConfigStorageForScope(scopeRef, storage, {
      now: () => '2026-07-02T00:00:00.000Z',
    });
    assert.equal(repaired.quarantined, 1);
    assert.equal(storage.getItem(scopeKey), null);
  } finally {
    restoreWindow(previousWindow);
  }
});

async function importStore() {
  const outputPath = path.join(await buildStore(), 'zhiyu-ai-config-store.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildStore() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-ai-config-store-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/ai-config/zhiyu-ai-config-store.ts')],
    outfile: path.join(buildDir, 'zhiyu-ai-config-store.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch(async (error) => {
    const text = await readFile(path.join(root, 'src/shell/ai-config/zhiyu-ai-config-store.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu AIConfig store: ${error.message}\nsource length=${text.length}`);
  });
  return buildDir;
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    key(index) {
      return Array.from(map.keys())[index] || null;
    },
    keys() {
      return Array.from(map.keys());
    },
    removeItem(key) {
      map.delete(String(key));
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

function restoreWindow(previousWindow) {
  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }
}
