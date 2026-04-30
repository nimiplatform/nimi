#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const protoRoot = path.join(repoRoot, 'proto');
const args = process.argv.slice(2);

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: protoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

let result = run('buf', args);
if ((result.status ?? 1) === 0) {
  process.exit(0);
}

const goPath = spawnSync('go', ['env', 'GOPATH'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'ignore'],
});

const gopath = String(goPath.stdout || '').trim();
if (gopath) {
  const bufBinary = path.join(gopath, 'bin', process.platform === 'win32' ? 'buf.exe' : 'buf');
  result = run(bufBinary, args, { shell: false });
  if ((result.status ?? 1) === 0) {
    process.exit(0);
  }
}

console.error('buf is not installed. Install it via `go install github.com/bufbuild/buf/cmd/buf@latest` or add it to PATH.');
process.exit(result.status ?? 127);
