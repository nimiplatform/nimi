#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const invocation = readInvocation(process.argv[2]);
let target;
let ownerLost = false;
let terminating = false;

process.stdin.resume();
process.stdin.once('end', handleOwnerLoss);
process.stdin.once('close', handleOwnerLoss);
process.stdin.once('error', handleOwnerLoss);

const targetEnvironment = { ...process.env };
delete targetEnvironment.ELECTRON_RUN_AS_NODE;

target = spawn(invocation.command, invocation.args, {
  cwd: process.cwd(),
  env: targetEnvironment,
  shell: invocation.shell,
  detached: true,
  windowsHide: true,
  stdio: ['ignore', 'inherit', 'inherit'],
});
target.once('error', () => process.exit(1));
target.once('exit', (code, signal) => {
  if (terminating) return;
  process.exit(signal ? 1 : code ?? 1);
});

if (ownerLost) void terminateTargetTree();

function handleOwnerLoss() {
  if (ownerLost) return;
  ownerLost = true;
  if (target) void terminateTargetTree();
}

async function terminateTargetTree() {
  if (terminating) return;
  terminating = true;
  const processId = target?.pid;
  if (processId) {
    const terminator = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), [
      '/pid', String(processId), '/t', '/f',
    ], { windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve) => {
      terminator.once('error', () => resolve());
      terminator.once('exit', () => resolve());
    });
  }
  process.exit(0);
}

function readInvocation(encoded) {
  try {
    const value = JSON.parse(Buffer.from(String(encoded || ''), 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    if (Object.keys(value).sort().join('|') !== 'args|command|shell'
      || typeof value.command !== 'string'
      || value.command.length === 0
      || !Array.isArray(value.args)
      || !value.args.every((entry) => typeof entry === 'string')
      || typeof value.shell !== 'boolean') {
      throw new Error('shape');
    }
    return {
      command: value.command,
      args: value.args,
      shell: value.shell,
    };
  } catch {
    process.stderr.write('[local-development-guardian] invalid invocation\n');
    process.exit(1);
  }
}
