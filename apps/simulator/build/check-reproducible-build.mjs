#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DIST_ROOT, REPO_ROOT } from './paths.mjs';

function runBuild() {
  const command = process.platform === 'win32'
    ? { binary: 'cmd.exe', args: ['/d', '/c', 'corepack', 'pnpm', '--filter', '@nimiplatform/simulator', 'build'] }
    : { binary: 'corepack', args: ['pnpm', '--filter', '@nimiplatform/simulator', 'build'] };
  const result = spawnSync(command.binary, command.args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function snapshot(rootDir, relativeDir = '') {
  const rows = [];
  for (const entry of readdirSync(path.join(rootDir, relativeDir), { withFileTypes: true })) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) rows.push(...snapshot(rootDir, relativePath));
    else if (entry.isFile()) rows.push([relativePath, readFileSync(path.join(rootDir, relativePath)).toString('base64')]);
    else throw new Error(`unsupported artifact entry: ${relativePath}`);
  }
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

runBuild();
const first = snapshot(DIST_ROOT);
runBuild();
const second = snapshot(DIST_ROOT);
if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error('Simulator build is not byte-for-byte reproducible across two clean output generations');
}
const artifact = JSON.parse(readFileSync(path.join(DIST_ROOT, 'simulator-artifact-manifest.json'), 'utf8'));
process.stdout.write(`simulator-reproducible-build: OK (${first.length} files, root ${artifact.artifactRootDigest})\n`);
