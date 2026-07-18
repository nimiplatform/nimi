#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_PACKAGE = {
  name: '@nimiplatform/sdk',
  dir: 'sdks/typescript',
};

const APP_TOOLS_PACKAGE = {
  name: '@nimiplatform/app-tools',
  dir: 'app-tools',
};

const KIT_PACKAGE = {
  name: '@nimiplatform/kit',
  dir: 'kit',
};

function nestedPnpmEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const lower = key.toLowerCase();
    if (
      key === 'INIT_CWD'
      || lower === 'npm_command'
      || lower === 'npm_config_user_agent'
      || lower === 'npm_execpath'
      || lower === 'npm_node_execpath'
      || lower === 'pnpm_package_name'
      || lower.startsWith('npm_lifecycle_')
      || lower.startsWith('npm_package_')
      || lower.startsWith('pnpm_config_')
    ) {
      delete env[key];
    }
  }
  return env;
}

function runCommand(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: options.env ?? process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function runPnpm(args, cwd) {
  runCommand('corepack', ['pnpm', ...args], cwd, { env: nestedPnpmEnv() });
}

function toPnpmFileSpec(filePath) {
  return `file:${filePath.replaceAll('\\', '/')}`;
}

async function readRootPackageManager() {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const packageManager = String(payload.packageManager || '').trim();
  if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager)) {
    throw new Error(`Root package.json must pin packageManager to pnpm x.y.z for consumer smoke: ${packageManager || '<missing>'}`);
  }
  return packageManager;
}

async function readPackageVersion(relativeDir) {
  const packageJsonPath = path.join(repoRoot, relativeDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  return String(payload.version || '').trim();
}

async function readRootDependencySpec(packageName) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const version = payload.dependencies?.[packageName] ?? payload.devDependencies?.[packageName];
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error(`Root package.json is missing dependency ${packageName}`);
  }
  return version.trim();
}

function tarballFileName(packageName, version) {
  const normalized = packageName.replace('@', '').replace(/\//g, '-');
  return `${normalized}-${version}.tgz`;
}

async function packPackage(packDir, pkg) {
  const version = await readPackageVersion(pkg.dir);
  runPnpm(['--filter', pkg.name, 'pack', '--pack-destination', packDir], repoRoot);
  const tarball = path.join(packDir, tarballFileName(pkg.name, version));
  try {
    await fs.access(tarball);
  } catch {
    throw new Error(`Packed tarball not found: ${tarball}`);
  }
  return tarball;
}

async function writeConsumerPackageJson(appDir, sdkTarballPath, packageManager) {
  const payload = {
    name: 'nimi-sdk-consumer-smoke',
    version: '0.0.0',
    private: true,
    packageManager,
    type: 'module',
    dependencies: {
      react: '19.2.3',
      'react-dom': '19.2.3',
      i18next: '^25.8.11',
      'react-i18next': '^16.5.4',
      ai: '6.0.85',
      '@nimiplatform/sdk': `file:${sdkTarballPath}`,
    },
  };

  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeSmokeEntry(appDir) {
  const source = String.raw`
import assert from 'node:assert/strict';
import {
  Realm,
  Runtime,
  collectNimiTextStream,
  createNimiAppClient,
  createNimiClient,
  createNimiClientId,
} from '@nimiplatform/sdk';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  RUNTIME_AI_METHODS,
  createRuntime,
} from '@nimiplatform/sdk/runtime';
import {
  FinishReason,
  RoutePolicy,
  RuntimeHealthStatus,
} from '@nimiplatform/sdk/runtime/generated';
import { createRealm, normalizeNimiRealmBaseUrl } from '@nimiplatform/sdk/realm';
import {
  createEmptyNimiAIConfig,
  createNimiAIConfigStore,
  createNimiAIConfigSubscriptionRegistry,
  createNimiAppAIScopeRef,
  createNimiRuntimeAIModel,
} from '@nimiplatform/sdk/ai';
import {
  createNimiGenerationJob,
  transitionNimiGenerationJob,
} from '@nimiplatform/sdk/features/generation';

class FakeRuntimeTransport {
  constructor() {
    this.unaryCalls = [];
  }

  async unary(request) {
    this.unaryCalls.push(request);
    request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.6.0' });
    if (request.methodId === '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth') {
      return { status: RuntimeHealthStatus.READY, reason: 'ok' };
    }
    if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario') {
      return {
        finishReason: FinishReason.STOP,
        routeDecision: RoutePolicy.LOCAL,
        textOutput: { text: 'hello vnext' },
      };
    }
    throw new Error('unexpected unary ' + request.methodId);
  }

  async *serverStream() {
    throw new Error('unexpected stream call');
  }
}

const transport = new FakeRuntimeTransport();
const runtime = createRuntime({ transport });
const client = createNimiClient({ appId: 'app.nimi.sdk-smoke', runtime, realm: false });

assert.equal(client.appId, 'app.nimi.sdk-smoke');
assert.ok(client.runtime instanceof Runtime);
assert.equal(typeof client.ai.createRuntimeModel, 'function');
assert.equal(typeof client.features.generation.createRuntimeClient, 'function');
assert.equal(typeof createNimiClientId('smoke').startsWith, 'function');
assert.equal(typeof RUNTIME_AI_METHODS.includes('executeScenario'), 'boolean');
assert.equal(typeof ReasonCode.RUNTIME_CALL_FAILED, 'string');

const health = await runtime.ready();
assert.equal(health.status, RuntimeHealthStatus.READY);
assert.equal(runtime.runtimeVersion(), '0.6.0');
assert.equal(transport.unaryCalls[0]?.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');

const model = createNimiRuntimeAIModel({
  runtime,
  appId: 'app.nimi.sdk-smoke',
  model: { provider: 'local', modelId: 'local/smoke-model' },
  routePolicy: 'local',
  targetRef: {
    kind: 'local-runtime',
    version: 'v2',
    readinessRef: 'local-runtime:local/smoke-model',
  },
});
assert.equal(typeof model.generateText, 'function');

const streamResult = await collectNimiTextStream((async function* () {
  yield { type: 'text-delta', text: 'hello ' };
  yield { type: 'text-delta', text: 'stream' };
  yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } };
})());
assert.equal(streamResult.text, 'hello stream');
assert.equal(streamResult.finishReason, 'stop');

const realmTransport = {
  async unary() { return {}; },
  async *serverStream() {},
};
const realm = createRealm({ baseUrl: 'https://realm.nimi.ai', transport: realmTransport });
assert.ok(realm instanceof Realm);
assert.equal(normalizeNimiRealmBaseUrl('https://realm.nimi.ai/'), 'https://realm.nimi.ai');

const permissionEvents = [];
const permissionTransport = {
  async status(permissionId) {
    return { permissionId, posture: 'unavailable', canRequest: false };
  },
  async request() {
    throw new Error('reserved permission reached the transport');
  },
  subscribe(permissionId, callback) {
    callback({ status: { permissionId, posture: 'unavailable', canRequest: false } });
    return () => {};
  },
};
const permissionClient = createNimiClient({
  appId: 'tester.app',
  runtime,
  realm: { transport: realmTransport },
  permissions: permissionTransport,
}).requirePermissions();
assert.equal((await permissionClient.status('agents.interact')).posture, 'unavailable');
permissionClient.subscribe('agents.interact', (event) => permissionEvents.push(event))();
assert.equal(permissionEvents[0]?.status.posture, 'unavailable');
await assert.rejects(
  permissionClient.request({ permissionId: 'agents.interact', reason: 'consumer smoke' }),
  (error) => error?.reasonCode === 'SDK_PERMISSION_NOT_ADMITTED',
);

const app = createNimiAppClient({
  async list() { return []; },
  async get(appId) { return { appId, appKind: 'nimi-app', displayName: 'Smoke', trustTier: 'nimi-first-party', publisher: 'Nimi', aiProfileSelectionRef: 'local-standard', capabilitySet: ['text.generate'], releaseDescriptorRef: 'release', installStoragePolicyRef: 'storage', sourceRule: 'smoke' }; },
  async status(appId) { return { appId, launchReadiness: 'ready' }; },
});
assert.equal((await app.status('app.nimi.sdk-smoke')).launchReadiness, 'ready');

const scope = createNimiAppAIScopeRef('app.nimi.sdk-smoke', 'default');
assert.equal(scope.kind, 'app');
const memoryStorage = new Map();
const storage = {
  getItem(key) { return memoryStorage.get(key) ?? null; },
  setItem(key, value) { memoryStorage.set(key, String(value)); },
  removeItem(key) { memoryStorage.delete(key); },
};
const configStore = createNimiAIConfigStore({ storage: () => storage, configKeyForScope: (scopeKey) => 'config:' + scopeKey });
const saved = configStore.save(createEmptyNimiAIConfig(scope));
assert.equal(saved.scopeRef.ownerId, 'app.nimi.sdk-smoke');
assert.deepEqual(saved.capabilities.targetRefs, {});
assert.equal(typeof createNimiAIConfigSubscriptionRegistry().subscribe, 'function');

const job = transitionNimiGenerationJob(createNimiGenerationJob({ id: 'job-1', prompt: 'image' }), { status: 'completed' });
assert.equal(job.status, 'completed');

for (const retiredSubpath of [
  '@nimiplatform/sdk/world',
  '@nimiplatform/sdk/scope',
  '@nimiplatform/sdk/ai-provider',
  '@nimiplatform/sdk/ai-app',
  '@nimiplatform/sdk/platform-catalog',
  '@nimiplatform/sdk/runtime/browser',
]) {
  try {
    await import(retiredSubpath);
    throw new Error('retired subpath resolved: ' + retiredSubpath);
  } catch (error) {
    if (String(error?.message || error).startsWith('retired subpath resolved:')) throw error;
    const code = String(error?.code || '');
    const message = String(error?.message || error);
    if (code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && !message.includes('not defined by "exports"')) {
      throw error;
    }
  }
}

console.log('sdk vnext consumer smoke ok');
`;
  await fs.writeFile(path.join(appDir, 'index.mjs'), source);
}

async function writeAuthorToolsPackageJson(appDir, appToolsTarballPath, nimicodingDependencySpec, packageManager) {
  const payload = {
    name: 'nimi-author-tools-smoke',
    version: '0.0.0',
    private: true,
    packageManager,
    type: 'module',
    devDependencies: {
      '@nimiplatform/app-tools': `file:${appToolsTarballPath}`,
      '@nimiplatform/nimi-coding': nimicodingDependencySpec,
    },
  };

  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function rewriteGeneratedPackageJson(relativeDir, replacements, packageManager) {
  const packageJsonPath = path.join(relativeDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  payload.packageManager = packageManager;
  for (const [section, entries] of Object.entries(replacements)) {
    if (!payload[section]) continue;
    for (const [name, version] of Object.entries(entries)) {
      if (payload[section][name] != null) {
        payload[section][name] = version;
      }
    }
  }
  await fs.writeFile(packageJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writePnpmWorkspaceOverrides(appDir, overrides) {
  const lines = [
    'packages:',
    '  - .',
    'overrides:',
  ];
  for (const [name, value] of Object.entries(overrides)) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  }
  await fs.writeFile(path.join(appDir, 'pnpm-workspace.yaml'), `${lines.join('\n')}\n`);
}

async function writeTypecheckTsconfig(appDir) {
  const payload = {
    compilerOptions: {
      noEmit: true,
    },
    extends: './tsconfig.json',
  };
  await fs.writeFile(
    path.join(appDir, 'tsconfig.smoke.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-sdk-consumer-smoke-'));
  const packDir = path.join(tempRoot, 'packs');
  const appDir = path.join(tempRoot, 'app');
  const authorDir = path.join(tempRoot, 'author-tools');
  const generatedStandaloneAppDir = path.join(authorDir, 'generated-app-standalone');
  const generatedWorkspaceAppDir = path.join(authorDir, 'generated-app-workspace');
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(authorDir, { recursive: true });

  const packageManager = await readRootPackageManager();
  const sdkTarball = await withSdkDistLock('check-sdk-consumer-smoke build+pack SDK', async () => {
    // Always build before packing so smoke validates current sources, not stale dist artifacts.
    runPnpm(['--filter', SDK_PACKAGE.name, 'build'], repoRoot);
    return packPackage(packDir, SDK_PACKAGE);
  });
  const appToolsTarball = await packPackage(packDir, APP_TOOLS_PACKAGE);
  const kitTarball = await packPackage(packDir, KIT_PACKAGE);
  const nimicodingDependencySpec = await readRootDependencySpec('@nimiplatform/nimi-coding');

  await writeConsumerPackageJson(appDir, sdkTarball, packageManager);
  await writeSmokeEntry(appDir);

  runPnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], appDir);
  runCommand('node', ['index.mjs'], appDir);

  await writeAuthorToolsPackageJson(authorDir, appToolsTarball, nimicodingDependencySpec, packageManager);
  runPnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], authorDir);
  process.env.PATH = `${path.join(authorDir, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}`;
  runPnpm(
    ['exec', 'nimi-app', 'create', '--dir', 'generated-app-standalone', '--profile', 'standalone'],
    authorDir,
  );
  runPnpm(
    ['exec', 'nimi-app', 'create', '--dir', 'generated-app-workspace', '--profile', 'workspace-app'],
    authorDir,
  );
  for (const generatedAppDir of [generatedStandaloneAppDir, generatedWorkspaceAppDir]) {
    runPnpm(['exec', 'nimi-app', 'init', '--dir', generatedAppDir], authorDir);
    runPnpm(['exec', 'nimi-app', 'doctor', '--dir', generatedAppDir], authorDir);
    runPnpm(['exec', 'nimi-app', 'update', '--dir', generatedAppDir], authorDir);
    runPnpm(['exec', 'nimi-app', 'doctor', '--dir', generatedAppDir], authorDir);
  }

  await rewriteGeneratedPackageJson(generatedStandaloneAppDir, {
    dependencies: {
      '@nimiplatform/sdk': toPnpmFileSpec(sdkTarball),
      '@nimiplatform/kit': toPnpmFileSpec(kitTarball),
    },
    devDependencies: {
      '@nimiplatform/app-tools': toPnpmFileSpec(appToolsTarball),
      '@nimiplatform/nimi-coding': nimicodingDependencySpec,
    },
  }, packageManager);
  await writePnpmWorkspaceOverrides(generatedStandaloneAppDir, {
    '@nimiplatform/sdk': toPnpmFileSpec(sdkTarball),
  });
  await writeTypecheckTsconfig(generatedStandaloneAppDir);
  runPnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], generatedStandaloneAppDir);
  runPnpm(['exec', 'tsc', '--project', 'tsconfig.smoke.json'], generatedStandaloneAppDir);

  await rewriteGeneratedPackageJson(generatedWorkspaceAppDir, {
    dependencies: {
      '@nimiplatform/sdk': toPnpmFileSpec(sdkTarball),
      '@nimiplatform/kit': toPnpmFileSpec(kitTarball),
    },
    devDependencies: {
      '@nimiplatform/app-tools': toPnpmFileSpec(appToolsTarball),
      '@nimiplatform/nimi-coding': nimicodingDependencySpec,
    },
  }, packageManager);
  await writePnpmWorkspaceOverrides(generatedWorkspaceAppDir, {
    '@nimiplatform/sdk': toPnpmFileSpec(sdkTarball),
  });
  await writeTypecheckTsconfig(generatedWorkspaceAppDir);
  runPnpm(
    ['install', '--ignore-scripts', '--no-frozen-lockfile'],
    generatedWorkspaceAppDir,
  );
  runPnpm(['exec', 'tsc', '--project', 'tsconfig.smoke.json'], generatedWorkspaceAppDir);

  process.stdout.write(`[check-sdk-consumer-smoke] passed (temp=${tempRoot})\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[check-sdk-consumer-smoke] failed: ${message}\n`);
  process.exit(1);
});
