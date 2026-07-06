import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
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

test('Zhiyu model tab commits text.generate through runtime execution config upsert', async () => {
  const module = await importCommitModule();
  const harness = createHarness(module, {
    committed: committedConfig(4, {}),
  });

  harness.service.aiConfig.update(scopeRef(), configWith({
    'text.generate': localTargetRef('text'),
  }));
  await harness.service.flushExecutionConfigCommits();

  assert.equal(harness.upserts.length, 1);
  assert.equal(harness.upserts[0].expectedRevision, 4);
  assert.deepEqual(Object.keys(harness.upserts[0].bindings), ['text.generate']);
  assert.equal(harness.upserts[0].bindings['text.generate'].route, 'local');
  assert.equal(harness.upserts[0].bindings['text.generate'].modelId, 'resolved:text.generate:local');
  assert.equal(harness.baseUpdates.length, 1, 'AIConfig display mirror commits only after the runtime upsert succeeds');
  assert.deepEqual(harness.states.map((state) => state.status), ['committing', 'committed']);
  assert.equal(harness.states.at(-1).revision, 5);
});

test('Zhiyu model tab image commit retains the committed text binding in the upsert', async () => {
  const module = await importCommitModule();
  const textBinding = { route: 'local', ['modelId']: 'committed-text-model' };
  const harness = createHarness(module, {
    committed: committedConfig(6, { 'text.generate': textBinding }),
  });

  harness.service.aiConfig.update(scopeRef(), configWith({
    'image.generate': cloudTargetRef('image'),
  }));
  await harness.service.flushExecutionConfigCommits();

  assert.equal(harness.upserts.length, 1);
  assert.equal(harness.upserts[0].expectedRevision, 6);
  assert.deepEqual(harness.upserts[0].bindings['text.generate'], textBinding);
  assert.equal(harness.upserts[0].bindings['image.generate'].route, 'cloud');
  assert.deepEqual(harness.states.map((state) => state.status), ['committing', 'committed']);
});

test('Zhiyu model tab image commit fails closed while no text binding is committed', async () => {
  const module = await importCommitModule();
  const harness = createHarness(module, {
    committed: committedConfig(1, {}),
  });

  harness.service.aiConfig.update(scopeRef(), configWith({
    'image.generate': cloudTargetRef('image'),
  }));
  await harness.service.flushExecutionConfigCommits();

  assert.equal(harness.upserts.length, 0);
  assert.equal(harness.baseUpdates.length, 0);
  assert.deepEqual(harness.states.map((state) => state.status), ['committing', 'failed']);
  assert.equal(harness.states.at(-1).reasonCode, 'zhiyu-execution-config-text-binding-required');
});

test('Zhiyu model tab surfaces revision conflict as retry state and never silently overwrites', async () => {
  const module = await importCommitModule();
  let firstGet = true;
  const harness = createHarness(module, {
    getCommittedConfig: async () => {
      if (firstGet) {
        firstGet = false;
        return committedConfig(3, {});
      }
      return committedConfig(9, {});
    },
    upsertConfig: async () => {
      throw Object.assign(
        new Error('Runtime Agent execution config was modified concurrently; re-read the committed config and retry with its revision.'),
        { reasonCode: 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION' },
      );
    },
  });

  harness.service.aiConfig.update(scopeRef(), configWith({
    'text.generate': localTargetRef('text'),
  }));
  await harness.service.flushExecutionConfigCommits();

  assert.equal(harness.baseUpdates.length, 0, 'conflicted commits must not mirror the stale selection into AIConfig');
  assert.deepEqual(harness.states.map((state) => state.status), ['committing', 'conflict']);
  const conflict = harness.states.at(-1);
  assert.equal(conflict.reasonCode, 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION');
  assert.equal(conflict.committedRevision, 9, 'conflict state re-reads the committed config revision for the retry prompt');
});

test('Zhiyu model tab keeps non-managed capabilities on the AIConfig facade path', async () => {
  const module = await importCommitModule();
  const harness = createHarness(module, {
    committed: committedConfig(2, {}),
  });

  harness.service.aiConfig.update(scopeRef(), configWith({
    'text.embed': localTargetRef('embed'),
  }));
  await harness.service.flushExecutionConfigCommits();

  assert.equal(harness.upserts.length, 0);
  assert.equal(harness.baseUpdates.length, 1);
  assert.deepEqual(harness.states, []);
});

test('Zhiyu model tab commit fails closed without an authenticated Runtime subject', async () => {
  const module = await importCommitModule();
  const harness = createHarness(module, {
    committed: committedConfig(2, {}),
    subjectUserId: '',
  });

  harness.service.aiConfig.update(scopeRef(), configWith({
    'text.generate': localTargetRef('text'),
  }));
  await harness.service.flushExecutionConfigCommits();

  assert.equal(harness.upserts.length, 0);
  assert.equal(harness.baseUpdates.length, 0);
  assert.deepEqual(harness.states.map((state) => state.status), ['committing', 'failed']);
  assert.equal(harness.states.at(-1).reasonCode, 'zhiyu-agent-execution-config-auth-required');
});

async function importCommitModule() {
  const outputPath = path.join(await buildCommitModule(), 'zhiyu-execution-config-commit.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildCommitModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-execution-commit-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/ai-config/zhiyu-execution-config-commit.ts')],
    outfile: path.join(buildDir, 'zhiyu-execution-config-commit.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  }).catch(async (error) => {
    const text = await readFile(path.join(root, 'src/shell/ai-config/zhiyu-execution-config-commit.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu execution config commit service: ${error.message}\nsource length=${text.length}`);
  });
  return buildDir;
}

function createHarness(module, options = {}) {
  const states = [];
  const upserts = [];
  const baseUpdates = [];
  const committed = options.committed ?? committedConfig(1, {});
  const service = module.createZhiyuExecutionConfigCommitService({
    base: {
      aiConfig: {
        get: () => configWith({}),
        update: (ref, next) => {
          baseUpdates.push({ ref, next });
        },
        subscribe: () => () => undefined,
      },
      aiProfile: {
        list: async () => [],
        previewApply: async () => ({}),
        apply: async () => ({}),
      },
    },
    getSubjectUserId: () => options.subjectUserId ?? 'user-1',
    getCommittedConfig: options.getCommittedConfig ?? (async () => committed),
    upsertConfig: options.upsertConfig ?? (async (input) => {
      upserts.push(input);
      return {
        ...committed,
        revision: input.expectedRevision + 1,
        bindings: input.bindings,
      };
    }),
    buildBindingForTargetRef: async (capability, targetRef) => (
      targetRef.kind === 'cloud-connector'
        ? {
          route: 'cloud',
          ['modelId']: targetRef.providerModelId,
          connectorId: targetRef.connectorId,
          targetRef,
        }
        : {
          route: 'local',
          ['modelId']: `resolved:${capability}:local`,
          targetRef,
        }
    ),
    onCommitState: (state) => {
      states.push(state);
    },
  });
  return {
    service,
    states,
    upserts,
    baseUpdates,
  };
}

function committedConfig(revision, bindings) {
  return {
    revision,
    bindings,
    updatedAt: '2026-07-06T00:00:00.000Z',
    updatedByAppId: 'nimi.zhiyu',
  };
}

function scopeRef() {
  return {
    kind: 'app',
    ownerId: 'nimi.zhiyu',
    surfaceId: 'zhiyu-agent-home',
  };
}

function configWith(targetRefs) {
  return {
    scopeRef: scopeRef(),
    capabilities: {
      targetRefs,
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

function localTargetRef(id) {
  return {
    kind: 'local-runtime',
    version: 'v2',
    profileBindingId: `local-runtime:${id}`,
  };
}

function cloudTargetRef(id) {
  return {
    kind: 'cloud-connector',
    version: 'v2',
    connectorId: `connector-${id}`,
    remoteModelCatalogId: `catalog-${id}`,
    providerModelId: `model-${id}`,
    provider: 'tester',
  };
}
