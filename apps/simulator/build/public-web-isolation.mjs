import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { sha256Digest, stableJsonDigest } from '@nimiplatform/app-tools/simulator-conformance';

const WEB_GRAPH_SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.json', '.mjs', '.ts', '.tsx']);

export function buildPublicWebIsolationProof({ repoRoot }) {
  const webRoot = path.join(repoRoot, 'apps', 'web');
  const simulatorRoot = path.join(repoRoot, 'apps', 'simulator');
  const files = [path.join(webRoot, 'package.json'), path.join(webRoot, 'vite.config.ts'), path.join(webRoot, 'index.html')];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        if (WEB_GRAPH_SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
      } else {
        throw new Error(`apps/web graph contains unsupported filesystem entry ${absolute}`);
      }
    }
  };
  walk(path.join(webRoot, 'src'));
  const inventory = [];
  for (const filePath of [...new Set(files)].sort()) {
    const bytes = readFileSync(filePath);
    const source = bytes.toString('utf8');
    const relativePath = path.relative(repoRoot, filePath).split(path.sep).join('/');
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
