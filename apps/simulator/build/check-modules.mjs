#!/usr/bin/env node

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Digest, stableJsonDigest } from '@nimiplatform/app-tools/simulator-conformance';
import { loadSimulatorConfig } from './config.mjs';
import { qualifySelectedModules } from './registry.mjs';
import { CONFIG_ROOT, GENERATED_ROOT, REPO_ROOT, SIMULATOR_ROOT } from './paths.mjs';

const WEB_GRAPH_SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.json', '.mjs', '.ts', '.tsx']);

function assertPublicWebIsolation() {
  const webRoot = path.join(REPO_ROOT, 'apps', 'web');
  const simulatorRoot = path.join(REPO_ROOT, 'apps', 'simulator');
  const files = [path.join(webRoot, 'package.json'), path.join(webRoot, 'vite.config.ts'), path.join(webRoot, 'index.html')];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        if (WEB_GRAPH_SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
      }
      else throw new Error(`apps/web graph contains unsupported filesystem entry ${absolute}`);
    }
  };
  walk(path.join(webRoot, 'src'));
  const inventory = [];
  for (const filePath of [...new Set(files)].sort()) {
    const bytes = readFileSync(filePath);
    const source = bytes.toString('utf8');
    const relativePath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
    if (source.includes('@nimiplatform/simulator') || source.includes('apps/simulator')) {
      throw new Error(`${relativePath} must not reference the Simulator package or source root`);
    }
    for (const match of source.matchAll(/['"](\.\.?(?:\/[^'"\\]+)+)['"]/g)) {
      const resolved = path.resolve(path.dirname(filePath), match[1]);
      if (resolved === simulatorRoot || resolved.startsWith(`${simulatorRoot}${path.sep}`)) {
        throw new Error(`${relativePath} resolves a public Web graph edge into apps/simulator`);
      }
    }
    inventory.push({ path: relativePath, digest: sha256Digest(bytes) });
  }
  const proof = {
    schema: 'nimi.simulator.public-web-isolation/v1',
    simulatorEdgeCount: 0,
    inventory,
  };
  return {
    ...proof,
    digest: stableJsonDigest('nimi-simulator-public-web-isolation-v1', proof),
  };
}

const publicWebIsolation = assertPublicWebIsolation();
const { descriptors, repositoryCatalog } = loadSimulatorConfig(CONFIG_ROOT);
const registry = qualifySelectedModules({
  descriptors,
  repositoryCatalog,
  repoRoot: REPO_ROOT,
  simulatorRoot: SIMULATOR_ROOT,
  generatedRoot: GENERATED_ROOT,
  release: true,
});
mkdirSync(path.join(GENERATED_ROOT, 'evidence'), { recursive: true });
writeFileSync(
  path.join(GENERATED_ROOT, 'evidence', 'public-web-isolation.json'),
  `${JSON.stringify(publicWebIsolation, null, 2)}\n`,
);
process.stdout.write(`simulator-modules: OK (${registry.moduleCount} generated modules, registry ${registry.digest})\n`);
