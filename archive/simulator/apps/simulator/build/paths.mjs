import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIMULATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SIMULATOR_ROOT, '../..');
export const CONFIG_ROOT = path.join(REPO_ROOT, 'config', 'simulator');
export const GENERATED_ROOT = path.join(SIMULATOR_ROOT, '.generated');
export const DIST_ROOT = path.join(SIMULATOR_ROOT, 'dist');
