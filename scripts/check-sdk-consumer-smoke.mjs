#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const SDK_PACKAGE = {
  name: '@nimiplatform/sdk',
  dir: 'sdk',
};

const DEV_TOOLS_PACKAGE = {
  name: '@nimiplatform/dev-tools',
  dir: 'dev-tools',
};

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

async function readPackageVersion(relativeDir) {
  const packageJsonPath = path.join(repoRoot, relativeDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  return String(payload.version || '').trim();
}

function tarballFileName(packageName, version) {
  const normalized = packageName.replace('@', '').replace(/\//g, '-');
  return `${normalized}-${version}.tgz`;
}

async function packPackage(packDir, pkg) {
  const version = await readPackageVersion(pkg.dir);
  runCommand('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', packDir], repoRoot);
  const tarball = path.join(packDir, tarballFileName(pkg.name, version));
  try {
    await fs.access(tarball);
  } catch {
    throw new Error(`Packed tarball not found: ${tarball}`);
  }
  return tarball;
}

async function writeConsumerPackageJson(appDir, sdkTarballPath) {
  const payload = {
    name: 'nimi-sdk-consumer-smoke',
    version: '0.0.0',
    private: true,
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
  const source = [
    "import { clearPlatformClient, createPlatformClient, getPlatformClient } from '@nimiplatform/sdk';",
    "import { Runtime, buildRuntimeAuthMetadata, createRuntimeRealmBridgeHelpers, fetchRealmGrant } from '@nimiplatform/sdk/runtime';",
    "import { Realm } from '@nimiplatform/sdk/realm';",
    "import { Modal } from '@nimiplatform/sdk/runtime';",
    "import { ReasonCode } from '@nimiplatform/sdk/types';",
    "import { createScopeModule } from '@nimiplatform/sdk/scope';",
    "import * as modApi from '@nimiplatform/sdk/mod';",
    "import * as modStorageApi from '@nimiplatform/sdk/mod/storage';",
    "import { useShellNavigation } from '@nimiplatform/sdk/mod/shell';",
    "import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';",
    '',
    "if (typeof createPlatformClient !== 'function') throw new Error('root createPlatformClient export invalid');",
    "if (typeof getPlatformClient !== 'function') throw new Error('root getPlatformClient export invalid');",
    "if (typeof clearPlatformClient !== 'function') throw new Error('root clearPlatformClient export invalid');",
    "if (typeof Runtime !== 'function') throw new Error('runtime class export invalid');",
    "if (typeof fetchRealmGrant !== 'function') throw new Error('runtime realm bridge export invalid');",
    "if (typeof createRuntimeRealmBridgeHelpers !== 'function') throw new Error('runtime realm bridge helper export invalid');",
    "if (typeof buildRuntimeAuthMetadata !== 'function') throw new Error('runtime auth metadata export invalid');",
    "if (typeof Realm !== 'function') throw new Error('realm class export invalid');",
    "if (typeof createNimiAiProvider !== 'function') throw new Error('ai-provider export invalid');",
    "if (typeof modApi.createHookClient !== 'function') throw new Error('mod hook export invalid');",
    "if (typeof modApi.createModRuntimeClient !== 'function') throw new Error('mod runtime export invalid');",
    "if (typeof modApi.createRendererFlowId !== 'function') throw new Error('mod logging export invalid');",
    "if (typeof modApi.getPendingModTranslationCount !== 'function') throw new Error('mod i18n export invalid');",
    "if (typeof modApi.normalizeRuntimeModSettingsMap !== 'function') throw new Error('mod settings export invalid');",
    "if (typeof modApi.loadStorageJsonFrom !== 'function') throw new Error('mod utils export invalid');",
    "if (typeof modApi.filterModelOptions !== 'function') throw new Error('mod model-options export invalid');",
    "if (typeof modApi.normalizeRuntimeRouteSource !== 'function') throw new Error('mod runtime-route export invalid');",
    "if (typeof modApi.createModKvStore !== 'function') throw new Error('mod root storage export invalid');",
    "if (typeof modStorageApi.createModKvStore !== 'function') throw new Error('mod storage export invalid');",
    "if (typeof useShellNavigation !== 'function') throw new Error('mod shell export invalid');",
    "if (typeof Modal !== 'object') throw new Error('runtime export invalid');",
    "clearPlatformClient();",
    "const platformClient = await createPlatformClient({",
    "  appId: 'nimi.sdk.consumer.smoke',",
    "  realmBaseUrl: 'https://realm.nimi.xyz',",
    "  allowAnonymousRealm: true,",
    "  runtimeTransport: null,",
    "});",
    "if (getPlatformClient() !== platformClient) throw new Error('platform singleton export invalid');",
    "if (platformClient.realm.baseUrl !== 'https://realm.nimi.xyz') throw new Error('platform realm export invalid');",
    "if (typeof platformClient.domains.publicContent.getPublicPost !== 'function') throw new Error('platform domain export invalid');",
    "try {",
    "  platformClient.runtime.health();",
    "  throw new Error('disabled runtime should throw');",
    "} catch (error) {",
    "  const message = String(error?.message || error);",
    "  if (!message.includes('runtime is disabled')) throw error;",
    "}",
    "clearPlatformClient();",
    "const realm = new Realm({ baseUrl: 'https://realm.nimi.xyz', auth: null });",
    "if (typeof realm.unsafeRaw?.request !== 'function') throw new Error('realm unsafeRaw request export invalid');",
    "if (typeof realm.connect !== 'function') throw new Error('realm connect export invalid');",
    "const realmBridgeContext = {",
    "  appId: 'app.nimi.bridge',",
    "  runtime: {},",
    "  realm: {",
    "    services: {",
    "      RuntimeRealmGrantsService: {",
    "        issueRuntimeRealmGrant: async (input) => ({ token: `grant:${input.appId}`, version: 'sdk-v1', expiresAt: '2026-03-20T00:00:00Z' }),",
    "      },",
    "    },",
    "  },",
    "};",
    "const bridgedGrant = await fetchRealmGrant(realmBridgeContext, {",
    "  subjectUserId: 'user-1',",
    "  scopes: ['app.nimi.bridge.chat.read'],",
    "});",
    "if (bridgedGrant.token !== 'grant:app.nimi.bridge') throw new Error('runtime realm bridge call invalid');",
    "const bridgeHelpers = createRuntimeRealmBridgeHelpers(realmBridgeContext);",
    "const bridgeMetadata = bridgeHelpers.buildRuntimeAuthMetadata({ grantToken: bridgedGrant.token, grantVersion: bridgedGrant.version });",
    "if (bridgeMetadata.realmGrantVersion !== 'sdk-v1') throw new Error('runtime realm bridge metadata invalid');",
    "if (typeof ReasonCode !== 'object') throw new Error('types export invalid');",
    "if (typeof createScopeModule !== 'function') throw new Error('scope export invalid');",
    "if (modApi.normalizeRuntimeRouteSource('cloud') !== 'cloud') throw new Error('mod runtime-route call invalid');",
    "if (!Array.isArray(modApi.filterModelOptions([], 'x'))) throw new Error('mod model-options call invalid');",
    "if (typeof modApi.getPendingModTranslationCount() !== 'number') throw new Error('mod i18n call invalid');",
    "if (typeof modApi.normalizeRuntimeModSettingsMap({}) !== 'object') throw new Error('mod settings call invalid');",
    "if (modApi.loadStorageJsonFrom(undefined, 'missing') !== null) throw new Error('mod utils call invalid');",
    "const runtimeCalls = [];",
    "const runtimeClient = modApi.createModRuntimeClient('world.nimi.sdk-smoke', {",
    "  runtime: {},",
    "  runtimeHost: {",
    "    route: {",
    "      listOptions: async (input) => { runtimeCalls.push(['route.listOptions', input]); return { capability: input.capability, selected: { source: 'cloud', connectorId: 'connector-1', model: 'gpt-4.1-mini' }, resolvedDefault: { source: 'cloud', connectorId: 'connector-1', model: 'gpt-4.1-mini' }, local: { models: [] }, connectors: [] }; },",
    "      resolve: async (input) => { runtimeCalls.push(['route.resolve', input]); return { capability: input.capability, source: 'cloud', provider: 'openai', model: input.binding?.model || 'gpt-4.1-mini', connectorId: input.binding?.connectorId || 'connector-1' }; },",
    "      checkHealth: async (input) => { runtimeCalls.push(['route.checkHealth', input]); return { healthy: true, status: 'healthy', provider: 'openai', reasonCode: 'RUNTIME_ROUTE_HEALTHY', actionHint: 'none' }; },",
    "    },",
    "    ai: {",
    "      text: {",
    "        generate: async (input) => { runtimeCalls.push(['ai.text.generate', input]); return { text: 'ok', traceId: 'trace-1', promptTraceId: 'prompt-1' }; },",
    "        stream: async (input) => { runtimeCalls.push(['ai.text.stream', input]); return { [Symbol.asyncIterator]: async function* () { yield { type: 'text_delta', delta: 'ok' }; } }; },",
    "      },",
    "      embedding: { generate: async (input) => { runtimeCalls.push(['ai.embedding.generate', input]); return { vectors: [[1, 2, 3]], traceId: 'trace-embed-1' }; } },",
    "    },",
    "    media: {",
    "      image: { generate: async (input) => { runtimeCalls.push(['media.image.generate', input]); return { images: [], traceId: 'trace-image-1' }; }, stream: async (input) => { runtimeCalls.push(['media.image.stream', input]); return { [Symbol.asyncIterator]: async function* () {} }; } },",
    "      video: { generate: async (input) => { runtimeCalls.push(['media.video.generate', input]); return { videos: [], traceId: 'trace-video-1' }; }, stream: async (input) => { runtimeCalls.push(['media.video.stream', input]); return { [Symbol.asyncIterator]: async function* () {} }; } },",
    "      tts: { synthesize: async (input) => { runtimeCalls.push(['media.tts.synthesize', input]); return { audioUri: 'memory://audio', mimeType: 'audio/mpeg', traceId: 'trace-tts-1' }; }, stream: async (input) => { runtimeCalls.push(['media.tts.stream', input]); return { [Symbol.asyncIterator]: async function* () {} }; }, listVoices: async (input) => { runtimeCalls.push(['media.tts.listVoices', input]); return { voices: [], traceId: 'trace-voice-1' }; } },",
    "      stt: { transcribe: async (input) => { runtimeCalls.push(['media.stt.transcribe', input]); return { text: 'hello', traceId: 'trace-stt-1' }; } },",
    "      jobs: { get: async (input) => { runtimeCalls.push(['media.jobs.get', input]); return { jobId: input.jobId }; }, cancel: async (input) => { runtimeCalls.push(['media.jobs.cancel', input]); return { jobId: input.jobId }; }, subscribe: async (input) => { runtimeCalls.push(['media.jobs.subscribe', input]); return { [Symbol.asyncIterator]: async function* () {} }; }, getArtifacts: async (input) => { runtimeCalls.push(['media.jobs.getArtifacts', input]); return { artifacts: [], traceId: 'trace-artifacts-1' }; } },",
    "    },",
    "    voice: {",
    "      getAsset: async (input) => { runtimeCalls.push(['voice.getAsset', input]); return { asset: undefined }; },",
    "      listAssets: async (input) => { runtimeCalls.push(['voice.listAssets', input]); return { assets: [] }; },",
    "      deleteAsset: async (input) => { runtimeCalls.push(['voice.deleteAsset', input]); return { deleted: true }; },",
    "      listPresetVoices: async (input) => { runtimeCalls.push(['voice.listPresetVoices', input]); return { voices: [] }; },",
    "    },",
    "  },",
    "});",
    "await runtimeClient.route.listOptions({ capability: 'text.generate' });",
    "await runtimeClient.ai.text.generate({ prompt: 'hello', binding: { source: 'cloud', connectorId: 'connector-1', model: 'gpt-4.1-mini' } });",
    "if (runtimeCalls[0]?.[1]?.modId !== 'world.nimi.sdk-smoke') throw new Error('mod runtime modId injection invalid');",
    "for (const removedPath of [",
    "  '@nimiplatform/sdk/mod/hook',",
    "  '@nimiplatform/sdk/mod/runtime',",
    "  '@nimiplatform/sdk/mod/types',",
    "  '@nimiplatform/sdk/mod/logging',",
    "  '@nimiplatform/sdk/mod/i18n',",
    "  '@nimiplatform/sdk/mod/settings',",
    "  '@nimiplatform/sdk/mod/utils',",
    "  '@nimiplatform/sdk/mod/model-options',",
    "  '@nimiplatform/sdk/mod/runtime-route',",
    "  '@nimiplatform/sdk/mod/host',",
    "  '@nimiplatform/sdk/mod/ai',",
    "]) {",
    "  try {",
    "    await import(removedPath);",
    "    throw new Error(`legacy mod export still exists: ${removedPath}`);",
    "  } catch (error) {",
    "    const message = String(error?.message || error);",
    "    if (message.includes('legacy mod export still exists')) throw error;",
    "  }",
    "}",
    "console.log('sdk consumer smoke ok');",
    '',
  ].join('\n');
  await fs.writeFile(path.join(appDir, 'index.mjs'), source);
}

async function writeAuthorToolsPackageJson(appDir, devToolsTarballPath) {
  const payload = {
    name: 'nimi-author-tools-smoke',
    version: '0.0.0',
    private: true,
    type: 'module',
    devDependencies: {
      '@nimiplatform/dev-tools': `file:${devToolsTarballPath}`,
    },
  };

  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function rewriteGeneratedPackageJson(relativeDir, replacements) {
  const packageJsonPath = path.join(relativeDir, 'package.json');
  const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
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

async function writeTypecheckTsconfig(appDir) {
  const payload = {
    compilerOptions: {
      noEmit: true,
    },
    extends: './tsconfig.json',
  };
  await fs.writeFile(path.join(appDir, 'tsconfig.smoke.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-sdk-consumer-smoke-'));
  const packDir = path.join(tempRoot, 'packs');
  const appDir = path.join(tempRoot, 'app');
  const authorDir = path.join(tempRoot, 'author-tools');
  const generatedModDir = path.join(authorDir, 'generated-mod');
  const generatedAppDir = path.join(authorDir, 'generated-app');
  const generatedVercelAppDir = path.join(authorDir, 'generated-app-vercel');
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(authorDir, { recursive: true });

  // Always build before packing so smoke validates current sources, not stale dist artifacts.
  runCommand('pnpm', ['--filter', SDK_PACKAGE.name, 'build'], repoRoot);

  const sdkTarball = await packPackage(packDir, SDK_PACKAGE);
  const devToolsTarball = await packPackage(packDir, DEV_TOOLS_PACKAGE);

  await writeConsumerPackageJson(appDir, sdkTarball);
  await writeSmokeEntry(appDir);

  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], appDir);
  runCommand('node', ['index.mjs'], appDir);

  await writeAuthorToolsPackageJson(authorDir, devToolsTarball);
  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], authorDir);
  runCommand('pnpm', ['exec', 'nimi-mod', 'create', '--dir', 'generated-mod', '--name', 'Smoke Mod'], authorDir);
  runCommand('pnpm', ['exec', 'nimi-app', 'create', '--dir', 'generated-app', '--template', 'basic'], authorDir);
  runCommand('pnpm', ['exec', 'nimi-app', 'create', '--dir', 'generated-app-vercel', '--template', 'vercel-ai'], authorDir);

  await rewriteGeneratedPackageJson(generatedModDir, {
    dependencies: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
    },
    devDependencies: {
      '@nimiplatform/dev-tools': `file:${devToolsTarball}`,
    },
  });
  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], generatedModDir);
  runCommand('pnpm', ['run', 'doctor'], generatedModDir);
  runCommand('pnpm', ['run', 'build'], generatedModDir);
  runCommand('pnpm', ['run', 'pack'], generatedModDir);

  await rewriteGeneratedPackageJson(generatedAppDir, {
    dependencies: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
    },
  });
  await writeTypecheckTsconfig(generatedAppDir);
  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], generatedAppDir);
  runCommand('pnpm', ['exec', 'tsc', '--project', 'tsconfig.smoke.json'], generatedAppDir);

  await rewriteGeneratedPackageJson(generatedVercelAppDir, {
    dependencies: {
      '@nimiplatform/sdk': `file:${sdkTarball}`,
    },
  });
  await writeTypecheckTsconfig(generatedVercelAppDir);
  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], generatedVercelAppDir);
  runCommand('pnpm', ['exec', 'tsc', '--project', 'tsconfig.smoke.json'], generatedVercelAppDir);

  process.stdout.write(`[check-sdk-consumer-smoke] passed (temp=${tempRoot})\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[check-sdk-consumer-smoke] failed: ${message}\n`);
  process.exit(1);
});
