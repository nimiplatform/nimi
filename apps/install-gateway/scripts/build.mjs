#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const sourceScriptPath = path.join(repoRoot, 'scripts', 'install.sh');
const assetsDir = path.join(appRoot, 'dist', 'assets');
const outputScriptPath = path.join(assetsDir, 'install.sh');

fs.mkdirSync(assetsDir, { recursive: true });
fs.copyFileSync(sourceScriptPath, outputScriptPath);
process.stdout.write(`[install-gateway build] copied ${path.relative(repoRoot, sourceScriptPath)} -> ${path.relative(repoRoot, outputScriptPath)}\n`);
