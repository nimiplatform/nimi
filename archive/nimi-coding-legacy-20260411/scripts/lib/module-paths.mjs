import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists } from './doc-utils.mjs';

export function dirnameFrom(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}

function isModuleRoot(candidate) {
  return (
    path.basename(candidate) === 'nimi-coding'
    && exists(path.join(candidate, 'cli/cli.mjs'))
    && exists(path.join(candidate, 'gates/promotion-policy.yaml'))
  );
}

function findModuleRoot(metaUrl) {
  let currentDir = dirnameFrom(metaUrl);
  while (true) {
    if (isModuleRoot(currentDir)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`unable to resolve nimi-coding root from ${dirnameFrom(metaUrl)}`);
    }
    currentDir = parentDir;
  }
}

export function repoRootFrom(metaUrl) {
  return path.resolve(moduleRootFrom(metaUrl), '..');
}

export function moduleRootFrom(metaUrl) {
  return findModuleRoot(metaUrl);
}
