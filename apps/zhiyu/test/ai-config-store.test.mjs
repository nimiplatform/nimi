import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;
let importCounter = 0;

test.afterEach(() => {
  clearElectronTestShell();
});

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu AIConfig facade fails closed without a standard shell host', async () => {
  const store = await importStore();
  const scopeRef = store.createZhiyuAgentHomeAIScopeRef();
  assert.deepEqual(scopeRef, {
    kind: 'app',
    ownerId: 'nimi.zhiyu',
    surfaceId: 'zhiyu-agent-home',
  });

  const service = store.createZhiyuAIConfigService();
  const current = service.aiConfig.get(scopeRef);
  assert.deepEqual(current.capabilities.targetRefs, {});

  assert.throws(() => service.aiConfig.update(scopeRef, withTextTarget(current, 'local-runtime:text-ready')), {
    message: /requires standard shell command: nimi\.shell\.aiConfig\.set/,
  });
});

test('Zhiyu AIConfig facade hydrates and commits only through standard shell commands', async () => {
  const store = await importStore();
  const scopeRef = store.createZhiyuAgentHomeAIScopeRef();
  const hostConfig = withTextTarget(emptyConfig(scopeRef), 'local-runtime:host-text');
  const calls = [];
  installElectronTestShell(async (command, payload = {}) => {
    calls.push({ command, payload });
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']) {
      assert.equal(payload.scopeRef, 'app:nimi.zhiyu:zhiyu-agent-home');
      return { config: hostConfig };
    }
    if (command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']) {
      assert.equal(payload.scopeRef, 'app:nimi.zhiyu:zhiyu-agent-home');
      return { config: payload.config };
    }
    throw Object.assign(new Error(`unexpected shell command ${command}`), {
      code: 'not-found',
      reasonCode: 'not-found',
    });
  });

  const service = store.createZhiyuAIConfigService();
  const notifications = [];
  const unsubscribe = service.aiConfig.subscribe(scopeRef, (config) => notifications.push(config));
  await waitUntil(() => notifications.some((config) =>
    config.capabilities.targetRefs['text.generate']?.profileBindingId === 'local-runtime:host-text'
  ));
  assert.equal(
    service.aiConfig.get(scopeRef).capabilities.targetRefs['text.generate'].profileBindingId,
    'local-runtime:host-text',
  );

  const next = withTextTarget(service.aiConfig.get(scopeRef), 'local-runtime:saved-text');
  service.aiConfig.update(scopeRef, next);
  await waitUntil(() => calls.some((call) =>
    call.command === NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']
      && call.payload.config?.capabilities?.targetRefs?.['text.generate']?.profileBindingId === 'local-runtime:saved-text'
  ));
  await waitUntil(() => notifications.some((config) =>
    config.capabilities.targetRefs['text.generate']?.profileBindingId === 'local-runtime:saved-text'
  ));
  assert.equal(
    service.aiConfig.get(scopeRef).capabilities.targetRefs['text.generate'].profileBindingId,
    'local-runtime:saved-text',
  );
  unsubscribe();

  assert.throws(() => service.aiConfig.update(scopeRef, {
    ...next,
    scopeRef: {
      kind: 'app',
      ownerId: 'nimi.zhiyu',
      surfaceId: 'other-surface',
    },
  }), /scopeRef mismatch/);
});

test('Zhiyu AIConfig source contains no app-local config or snapshot truth', async () => {
  const source = await readFile(path.join(root, 'src/shell/ai-config/zhiyu-ai-config-store.ts'), 'utf8');
  assert.match(source, /NIMI_STANDARD_SHELL_COMMANDS\['ai-config\.get'\]/);
  assert.match(source, /NIMI_STANDARD_SHELL_COMMANDS\['ai-config\.set'\]/);
  assert.doesNotMatch(source, /createNimiAIConfigStore|createNimiAISnapshotStore/);
  assert.doesNotMatch(source, /resolveBrowserStorage|localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /ZHIYU_AI_CONFIG_STORAGE_KEY|ZHIYU_AI_SNAPSHOT/);
});

test('Zhiyu standalone Electron host wires the standard shell AIConfig store', async () => {
  const source = await readFile(path.join(root, 'src-electron/main.ts'), 'utf8');
  assert.match(source, /createNimiElectronFileAIConfigStore/);
  assert.match(source, /aiConfigStore:\s*createNimiElectronFileAIConfigStore\(/);
  assert.doesNotMatch(source, /createNimiAIConfigStore|createNimiAISnapshotStore|localStorage|sessionStorage|indexedDB/);
});

async function importStore() {
  const outputPath = path.join(await buildStore(), 'zhiyu-ai-config-store.mjs');
  importCounter += 1;
  return import(`${pathToFileURL(outputPath).href}?case=${importCounter}`);
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

function installElectronTestShell(invoke) {
  globalThis.__NIMI_ELECTRON_TEST__ = {
    invoke,
    listen: () => () => undefined,
  };
}

function clearElectronTestShell() {
  delete globalThis.__NIMI_ELECTRON_TEST__;
}

function withTextTarget(config, profileBindingId) {
  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      targetRefs: {
        ...config.capabilities.targetRefs,
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId,
        },
      },
    },
  };
}

function emptyConfig(scopeRef) {
  return {
    scopeRef,
    capabilities: {
      targetRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

async function waitUntil(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let lastResult = false;
  while (Date.now() < deadline) {
    lastResult = Boolean(predicate());
    if (lastResult) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(lastResult, true, 'condition was not met before timeout');
}
