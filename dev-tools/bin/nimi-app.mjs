#!/usr/bin/env node

import process from 'node:process';
import { createApp } from '../lib/index.mjs';

function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  let dir = '';
  let template = '';
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--dir') {
      dir = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--template') {
      template = String(rest[index + 1] || '').trim();
      index += 1;
    }
  }
  return {
    command: String(command || '').trim(),
    dir,
    template,
  };
}

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  nimi-app create [--dir path] [--template basic|vercel-ai]',
      '',
    ].join('\n'),
  );
}

try {
  const { command, dir, template } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }
  switch (command) {
    case 'create':
      createApp(process.cwd(), {
        dir,
        template,
      });
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[nimi-app] failed: ${message}\n`);
  process.exit(1);
}
