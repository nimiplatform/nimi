#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const PACKAGE = {
  id: 'sdk',
  name: '@nimiplatform/sdk',
  dir: 'sdk',
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

async function packSdk(packDir, version) {
  runCommand('pnpm', ['--filter', PACKAGE.name, 'pack', '--pack-destination', packDir], repoRoot);
  const tarball = path.join(packDir, tarballFileName(PACKAGE.name, version));
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
    "import { Runtime, Realm } from '@nimiplatform/sdk';",
    "import { Modal } from '@nimiplatform/sdk/runtime';",
    "import { ReasonCode } from '@nimiplatform/sdk/types';",
    "import { createScopeModule } from '@nimiplatform/sdk/scope';",
    "import { createAiClient } from '@nimiplatform/sdk/mod/ai';",
    "import { createHookClient } from '@nimiplatform/sdk/mod/hook';",
    "import * as modTypes from '@nimiplatform/sdk/mod/types';",
    "import { SlotHost } from '@nimiplatform/sdk/mod/ui';",
    "import { createRendererFlowId } from '@nimiplatform/sdk/mod/logging';",
    "import { getPendingModTranslationCount } from '@nimiplatform/sdk/mod/i18n';",
    "import { normalizeRuntimeModSettingsMap } from '@nimiplatform/sdk/mod/settings';",
    "import { loadStorageJsonFrom } from '@nimiplatform/sdk/mod/utils';",
    "import { filterModelOptions } from '@nimiplatform/sdk/mod/model-options';",
    "import { normalizeRuntimeRouteSource } from '@nimiplatform/sdk/mod/runtime-route';",
    "import { clearModSdkHost } from '@nimiplatform/sdk/mod/host';",
    "import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';",
    '',
    "if (typeof Runtime !== 'function') throw new Error('runtime class export invalid');",
    "if (typeof Realm !== 'function') throw new Error('realm class export invalid');",
    "if (typeof createNimiAiProvider !== 'function') throw new Error('ai-provider export invalid');",
    "if (typeof createAiClient !== 'function') throw new Error('mod ai export invalid');",
    "if (typeof createHookClient !== 'function') throw new Error('mod hook export invalid');",
    "if (typeof modTypes !== 'object') throw new Error('mod types export invalid');",
    "if (typeof SlotHost !== 'function') throw new Error('mod ui export invalid');",
    "if (typeof createRendererFlowId !== 'function') throw new Error('mod logging export invalid');",
    "if (typeof getPendingModTranslationCount !== 'function') throw new Error('mod i18n export invalid');",
    "if (typeof normalizeRuntimeModSettingsMap !== 'function') throw new Error('mod settings export invalid');",
    "if (typeof loadStorageJsonFrom !== 'function') throw new Error('mod utils export invalid');",
    "if (typeof filterModelOptions !== 'function') throw new Error('mod model-options export invalid');",
    "if (typeof normalizeRuntimeRouteSource !== 'function') throw new Error('mod runtime-route export invalid');",
    "if (typeof clearModSdkHost !== 'function') throw new Error('mod host export invalid');",
    "if (typeof Modal !== 'object') throw new Error('runtime export invalid');",
    "const realm = new Realm({ baseUrl: 'https://realm.nimi.local', auth: { accessToken: Realm.NO_AUTH } });",
    "if (typeof realm.raw?.request !== 'function') throw new Error('realm raw request export invalid');",
    "if (typeof realm.connect !== 'function') throw new Error('realm connect export invalid');",
    "if (typeof ReasonCode !== 'object') throw new Error('types export invalid');",
    "if (typeof createScopeModule !== 'function') throw new Error('scope export invalid');",
    "if (normalizeRuntimeRouteSource('token-api') !== 'token-api') throw new Error('mod runtime-route call invalid');",
    "if (!Array.isArray(filterModelOptions([], 'x'))) throw new Error('mod model-options call invalid');",
    "if (typeof getPendingModTranslationCount() !== 'number') throw new Error('mod i18n call invalid');",
    "if (typeof normalizeRuntimeModSettingsMap({}) !== 'object') throw new Error('mod settings call invalid');",
    "if (loadStorageJsonFrom(undefined, 'missing') !== null) throw new Error('mod utils call invalid');",
    "console.log('sdk consumer smoke ok');",
    '',
  ].join('\n');
  await fs.writeFile(path.join(appDir, 'index.mjs'), source);
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nimi-sdk-consumer-smoke-'));
  const packDir = path.join(tempRoot, 'packs');
  const appDir = path.join(tempRoot, 'app');
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(appDir, { recursive: true });

  // Always build before packing so smoke validates current sources, not stale dist artifacts.
  runCommand('pnpm', ['--filter', PACKAGE.name, 'build'], repoRoot);

  const version = await readPackageVersion(PACKAGE.dir);
  const tarball = await packSdk(packDir, version);

  await writeConsumerPackageJson(appDir, tarball);
  await writeSmokeEntry(appDir);

  runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], appDir);
  runCommand('node', ['index.mjs'], appDir);

  process.stdout.write(`[check-sdk-consumer-smoke] passed (temp=${tempRoot})\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[check-sdk-consumer-smoke] failed: ${message}\n`);
  process.exit(1);
});
