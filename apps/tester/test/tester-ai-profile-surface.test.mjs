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

function encodeScopeRef(scopeRef) {
  return [scopeRef.kind, scopeRef.ownerId, scopeRef.surfaceId ?? ''].map(encodeURIComponent).join(':');
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
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-chat',
          },
        },
        'image.generate': {
          readinessPolicy: 'optional',
        },
      },
    };

    assert.equal(store.importTesterAIProfileJson(JSON.stringify(profile)).ok, true);
    const service = store.createTesterAIConfigService();
    const requirementDeclarations = [{
      requirementId: 'tester-shared-profile-surface:text',
      scopeRef,
      requiredSlices: [{
        requirementSliceId: 'tester:text.generate',
        capability: 'text.generate',
        profileSliceRef: 'tester:text.generate',
        readinessPolicy: 'required',
      }],
      setupProjectionPolicy: 'sdk-ai-config-setup-projection',
    }];
    const preview = await service.aiProfile.previewApply(scopeRef, profile.profileId, {
      requirementDeclarations,
    });
    assert.equal(preview.before, null);
    assert.equal(preview.outcome, 'ready_to_apply');
    assert.equal(preview.after.scopeRef.ownerId, scopeRef.ownerId);
    assert.equal(preview.after.capabilities.targetRefs['text.generate'].profileBindingId, 'local-chat');
    assert.deepEqual(preview.probeWarnings, []);

    const apply = await service.aiProfile.apply(scopeRef, profile.profileId, {
      expectedBaseVersion: preview.baseVersion,
      requirementDeclarations,
    });
    assert.equal(apply.success, true);
    assert.equal(store.loadTesterAIConfig(scopeRef).profileOrigin.profileId, profile.profileId);
    const stalePreview = await service.aiProfile.previewApply(scopeRef, profile.profileId, {
      requirementDeclarations,
    });
    service.aiConfig.update(scopeRef, {
      ...store.loadTesterAIConfig(scopeRef),
      profileOrigin: {
        profileId: 'external-change',
        title: 'External Change',
        appliedAt: 'test',
      },
    });
    const staleApply = await service.aiProfile.apply(scopeRef, profile.profileId, {
      expectedBaseVersion: stalePreview.baseVersion,
      requirementDeclarations,
    });
    assert.equal(staleApply.success, false);
    assert.equal(staleApply.outcome, 'stale_base');
    assert.equal((await service.aiProfile.apply(scopeRef, 'missing-profile', {
      requirementDeclarations,
    })).success, false);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('Tester AIConfig service sees AIProfiles imported after service creation', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: createMemoryStorage() };
  try {
    const store = await importStore();
    const scopeRef = store.createTesterAppLabAIScopeRef();
    const service = store.createTesterAIConfigService();
    assert.deepEqual(await service.aiProfile.list(), []);

    const profile = {
      profileId: 'tester-post-service-import',
      title: 'Tester Post-Service Import',
      description: '',
      tags: [],
      capabilities: {
        'text.generate': {
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-chat',
          },
        },
      },
    };
    assert.equal(store.importTesterAIProfileJson(JSON.stringify(profile)).ok, true);

    const profileIds = (await service.aiProfile.list()).map((entry) => entry.profileId);
    assert.deepEqual(profileIds, [profile.profileId]);

    const requirementDeclarations = [{
      requirementId: 'tester-post-service-import:text',
      scopeRef,
      requiredSlices: [{
        requirementSliceId: 'tester:text.generate',
        capability: 'text.generate',
        profileSliceRef: 'tester:text.generate',
        readinessPolicy: 'required',
      }],
      setupProjectionPolicy: 'sdk-ai-config-setup-projection',
    }];
    const preview = await service.aiProfile.previewApply(scopeRef, profile.profileId, {
      requirementDeclarations,
    });
    assert.equal(preview.outcome, 'ready_to_apply');
    assert.equal(preview.after.capabilities.targetRefs['text.generate'].profileBindingId, 'local-chat');

    const apply = await service.aiProfile.apply(scopeRef, profile.profileId, {
      expectedBaseVersion: preview.baseVersion,
      requirementDeclarations,
    });
    assert.equal(apply.success, true);
    assert.equal(store.loadTesterAIConfig(scopeRef).profileOrigin.profileId, profile.profileId);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('Tester AIConfig store ignores retired unscoped App Lab config storage', async () => {
  const previousWindow = globalThis.window;
  const store = await importStore();
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const retiredConfig = {
    scopeRef,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          targetId: 'runtime-local-chat',
          profileId: 'local-chat',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const storage = createMemoryStorage({
    [store.TESTER_AI_CONFIG_STORAGE_KEY]: JSON.stringify(retiredConfig),
  });
  globalThis.window = { localStorage: storage };
  try {
    const loaded = store.loadTesterAIConfig(scopeRef);
    const scopedKey = store.testerAIConfigStorageKeyForScopeKey(encodeScopeRef(scopeRef));
    assert.deepEqual(loaded.capabilities.targetRefs, {});
    assert.equal(storage.getItem(store.TESTER_AI_CONFIG_STORAGE_KEY), JSON.stringify(retiredConfig));
    assert.equal(storage.getItem(scopedKey), null);
    assert.equal(storage.getItem(`${store.TESTER_AI_CONFIG_STORAGE_KEY}:invalid`), null);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('Tester AIConfig service ignores retired scope-mismatched App Lab config before profile preview', async () => {
  const previousWindow = globalThis.window;
  const store = await importStore();
  const scopeRef = store.createTesterAppLabAIScopeRef();
  const retiredScopeConfig = {
    scopeRef: {
      kind: 'app',
      ownerId: scopeRef.ownerId,
      surfaceId: 'old-app-lab',
    },
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'old-local-chat',
        },
      },
      selectedParams: {},
    },
    profileOrigin: null,
  };
  const storage = createMemoryStorage({
    [store.TESTER_AI_CONFIG_STORAGE_KEY]: JSON.stringify(retiredScopeConfig),
  });
  globalThis.window = { localStorage: storage };
  try {
    const profile = {
      profileId: 'tester-scope-mismatch-repair',
      title: 'Tester Scope Mismatch Repair',
      description: '',
      tags: [],
      capabilities: {
        'text.generate': {
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-chat',
          },
        },
      },
    };
    assert.equal(store.importTesterAIProfileJson(JSON.stringify(profile)).ok, true);
    const service = store.createTesterAIConfigService();
    const requirementDeclarations = [{
      requirementId: 'tester-scope-mismatch-repair:text',
      scopeRef,
      requiredSlices: [{
        requirementSliceId: 'tester:text.generate',
        capability: 'text.generate',
        profileSliceRef: 'tester:text.generate',
        readinessPolicy: 'required',
      }],
      setupProjectionPolicy: 'sdk-ai-config-setup-projection',
    }];
    const preview = await service.aiProfile.previewApply(scopeRef, profile.profileId, {
      requirementDeclarations,
    });
    assert.equal(preview.outcome, 'ready_to_apply');
    assert.equal(preview.before, null);
    assert.equal(storage.getItem(store.TESTER_AI_CONFIG_STORAGE_KEY), JSON.stringify(retiredScopeConfig));
    assert.equal(storage.getItem(`${store.TESTER_AI_CONFIG_STORAGE_KEY}:scope-mismatch`), null);
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});
