import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CLEAN_TARGETS, REALM_GENERATED_RELATIVE_PATH } from './constants.mjs';

export function cleanRealmSources(repoRoot) {
  const realmGeneratedPath = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH);
  if (!existsSync(realmGeneratedPath)) {
    throw new Error(`Realm generated directory not found: ${realmGeneratedPath}`);
  }
  for (const target of CLEAN_TARGETS) {
    rmSync(path.join(realmGeneratedPath, target), { recursive: true, force: true });
  }
}

function listFilesRecursively(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const output = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        output.push(entryPath);
      }
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

export function computeDirectoryHash(rootDir) {
  if (!existsSync(rootDir)) {
    return 'MISSING';
  }
  if (!statSync(rootDir).isDirectory()) {
    throw new Error(`Path is not a directory: ${rootDir}`);
  }

  const hasher = createHash('sha256');
  const files = listFilesRecursively(rootDir);

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readFileSync(filePath);
    hasher.update(relativePath);
    hasher.update('\0');
    hasher.update(content);
    hasher.update('\0');
  }

  return hasher.digest('hex');
}
