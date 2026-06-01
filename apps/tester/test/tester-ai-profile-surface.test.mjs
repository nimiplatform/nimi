import assert from 'node:assert/strict';
import { buildWithTsc } from './tsc-build.mjs';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
let behaviorBuildDir = null;

function buildBehaviorModules() {
  if (behaviorBuildDir) return behaviorBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  behaviorBuildDir = mkdtempSync(path.join(root, '.tmp', 'ai-profile-surface-'));
  buildWithTsc([
    '--outDir',
    behaviorBuildDir,
    '--rootDir',
    'src',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'src/tester/tester-ai-config-store.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return behaviorBuildDir;
}

async function importStore() {
  return import(pathToFileURL(path.join(buildBehaviorModules(), 'tester/tester-ai-config-store.js')).href);
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
      return map.has(key) ? map.get(key) : null;
    },
    key(index) {
      return [...map.keys()][index] || null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
  };
}

test('Tester consumes the SDK host AIProfile surface for preview and apply', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: createMemoryStorage() };
  try {
    const store = await importStore();
    const scopeRef = store.createTesterAppLabAIScopeRef();
    const profile = {
      profileId: 'tester-shared-profile-surface',
      title: 'Tester Shared Profile Surface',
      description: '',
      tags: [],
      capabilities: {
        'text.generate': {
          binding: {
            source: 'local',
            connectorId: '',
            model: 'local-chat',
          },
        },
        'image.generate': {},
      },
    };

    assert.equal(store.importTesterAIProfileJson(JSON.stringify(profile)).ok, true);
    const service = store.createTesterAIConfigService();
    const preview = await service.aiProfile.previewApply(scopeRef, profile.profileId);
    assert.equal(preview.before.scopeRef.ownerId, scopeRef.ownerId);
    assert.equal(preview.after.capabilities.selectedBindings['text.generate'].model, 'local-chat');
    assert.match(preview.probeWarnings.join('\n'), /image\.generate/);

    const apply = await service.aiProfile.apply(scopeRef, profile.profileId, {
      expectedBaseVersion: preview.baseVersion,
    });
    assert.equal(apply.success, true);
    assert.equal(store.loadTesterAIConfig(scopeRef).profileOrigin.profileId, profile.profileId);
    const stalePreview = await service.aiProfile.previewApply(scopeRef, profile.profileId);
    service.aiConfig.update(scopeRef, {
      ...store.loadTesterAIConfig(scopeRef),
      profileOrigin: {
        profileId: 'external-change',
        title: 'External Change',
        appliedAt: 'test',
      },
    });
    await assert.rejects(
      () => service.aiProfile.apply(scopeRef, profile.profileId, {
        expectedBaseVersion: stalePreview.baseVersion,
      }),
      /AIConfig CAS conflict/,
    );
    assert.equal((await service.aiProfile.apply(scopeRef, 'missing-profile')).success, false);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});
