import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await rm(path.join(appRoot, 'dist-electron-package'), { recursive: true, force: true });
