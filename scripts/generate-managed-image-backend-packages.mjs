#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeOrCheckManagedImageBackendPackages } from './lib/managed-image-backend-package-sync.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
writeOrCheckManagedImageBackendPackages({ repoRoot, checkOnly });
process.stdout.write(`${checkOnly ? 'checked' : 'generated'} managed image backend package projection\n`);
