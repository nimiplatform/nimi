#!/usr/bin/env node

import process from 'node:process';
import { buildMod, createMod, doctorMod, packMod, resolveModDir } from '../lib/index.mjs';

function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  let modDir = '';
  let dir = '';
  let name = '';
  let modId = '';
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--mod-dir') {
      modDir = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--dir') {
      dir = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--name') {
      name = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--mod-id') {
      modId = String(rest[index + 1] || '').trim();
      index += 1;
    }
  }
  return {
    command: String(command || '').trim(),
    modDir,
    dir,
    name,
    modId,
  };
}

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  nimi-mod create [--dir path] [--name "My Mod"] [--mod-id world.nimi.my-mod]',
      '  nimi-mod build [--mod-dir /abs/or/relative/path]',
      '  nimi-mod dev [--mod-dir /abs/or/relative/path]',
      '  nimi-mod doctor [--mod-dir /abs/or/relative/path]',
      '  nimi-mod pack [--mod-dir /abs/or/relative/path]',
      '',
      'If --mod-dir is omitted, current working directory must be a mod root.',
      '',
    ].join('\n'),
  );
}

try {
  const { command, modDir, dir, name, modId } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }
  switch (command) {
    case 'create':
      createMod(process.cwd(), {
        dir,
        name,
        modId,
      });
      break;
    case 'build':
      await buildMod(resolveModDir(process.cwd(), modDir), false);
      break;
    case 'dev':
      await buildMod(resolveModDir(process.cwd(), modDir), true);
      break;
    case 'doctor':
      doctorMod(resolveModDir(process.cwd(), modDir));
      break;
    case 'pack':
      packMod(resolveModDir(process.cwd(), modDir));
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[nimi-mod] failed: ${message}\n`);
  process.exit(1);
}
