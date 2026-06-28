import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_STARTER_DIR = path.resolve(import.meta.dirname, '../templates/default-starter');
const DEFAULT_STARTER_MANIFEST_PATH = path.resolve(import.meta.dirname, '../templates/default-starter.manifest.json');

let defaultStarterSourceCache = null;

export function loadDefaultStarterSource() {
  if (!defaultStarterSourceCache) {
    defaultStarterSourceCache = {
      baseDir: DEFAULT_STARTER_DIR,
      manifest: JSON.parse(readFileSync(DEFAULT_STARTER_MANIFEST_PATH, 'utf8')),
    };
  }
  return defaultStarterSourceCache;
}

export function readDefaultStarterSourceFile(baseDir, relativePath) {
  return readFileSync(path.join(baseDir, relativePath), 'utf8');
}
