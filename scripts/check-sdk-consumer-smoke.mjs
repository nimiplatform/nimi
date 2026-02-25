#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const PACKAGE_MAP = [
  { id: 'sdk-types', name: '@nimiplatform/sdk-types', dir: 'sdk/packages/types' },
  { id: 'sdk-realm', name: '@nimiplatform/sdk-realm', dir: 'sdk/packages/realm' },
  { id: 'sdk-runtime', name: '@nimiplatform/sdk-runtime', dir: 'sdk/packages/runtime' },
  { id: 'sdk', name: '@nimiplatform/sdk', dir: 'sdk/packages/sdk' },
  { id: 'mod-sdk', name: '@nimiplatform/mod-sdk', dir: 'sdk/packages/mod-sdk' },
  { id: 'ai-provider', name: '@nimiplatform/ai-provider', dir: 'sdk/packages/ai-provider' },
];

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

async function packAllPackages(packDir, versions) {
  for (const item of PACKAGE_MAP) {
    runCommand('pnpm', ['--filter', item.name, 'pack', '--pack-destination', packDir], repoRoot);
    const tarball = path.join(packDir, tarballFileName(item.name, versions[item.id]));
    try {
      await fs.access(tarball);
    } catch {
      throw new Error(`Packed tarball not found: ${tarball}`);
    }
  }
}

async function writeConsumerPackageJson(appDir, tarballById) {
  const overrideMap = {};
  const dependencies = {
    react: '19.2.3',
    'react-dom': '19.2.3',
    i18next: '^25.8.11',
    'react-i18next': '^16.5.4',
    ai: '6.0.85',
  };

  for (const item of PACKAGE_MAP) {
    const fileSpecifier = `file:${tarballById[item.id]}`;
    dependencies[item.name] = fileSpecifier;
    overrideMap[item.name] = fileSpecifier;
  }

  const payload = {
    name: 'nimi-sdk-consumer-smoke',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies,
    pnpm: {
      overrides: overrideMap,
    },
  };

  await fs.writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeSmokeEntry(appDir) {
  const source = [
    "import { createNimiClient } from '@nimiplatform/sdk';",
    "import { Modal } from '@nimiplatform/sdk/runtime';",
    "import { OpenAPI } from '@nimiplatform/sdk/realm';",
    "import { createHookClient } from '@nimiplatform/mod-sdk/hook';",
    "import { createNimiAiProvider } from '@nimiplatform/ai-provider';",
    '',
    "if (typeof createNimiClient !== 'function') throw new Error('sdk export invalid');",
    "if (typeof createNimiAiProvider !== 'function') throw new Error('ai-provider export invalid');",
    "if (typeof createHookClient !== 'function') throw new Error('mod-sdk export invalid');",
    "if (typeof OpenAPI !== 'object') throw new Error('sdk-realm export invalid');",
    "if (typeof Modal !== 'object') throw new Error('sdk-runtime export invalid');",
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

  const versions = {};
  for (const item of PACKAGE_MAP) {
    versions[item.id] = await readPackageVersion(item.dir);
  }

  await packAllPackages(packDir, versions);

  const tarballById = {};
  for (const item of PACKAGE_MAP) {
    tarballById[item.id] = path.join(packDir, tarballFileName(item.name, versions[item.id]));
  }

  await writeConsumerPackageJson(appDir, tarballById);
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
