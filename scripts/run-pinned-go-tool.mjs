#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runPinnedGoTool } from './lib/pinned-go-tools.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function parseArgs(argv) {
  const options = {
    tool: '',
    cwd: '.',
    toolArgs: [],
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--tool') {
      options.tool = argv[++i] ?? '';
    } else if (arg === '--cwd') {
      options.cwd = argv[++i] ?? '';
    } else if (arg === '--') {
      options.toolArgs = argv.slice(i + 1);
      return options;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
    i += 1;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.tool) {
    throw new Error('--tool is required');
  }
  const cwd = path.resolve(repoRoot, options.cwd || '.');
  const exitCode = runPinnedGoTool(options.tool, options.toolArgs, { cwd });
  process.exit(exitCode);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[run-pinned-go-tool] ${error.stack ?? error.message ?? String(error)}\n`);
  process.exit(1);
}
