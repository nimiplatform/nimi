#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { acceptanceSkeleton } from './lib/manager-assist.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const options = {};
  for (let i = 0; i < normalizedArgv.length; i += 1) {
    const token = normalizedArgv[i];
    if (token === '--disposition') {
      options.disposition = normalizedArgv[i + 1];
      i += 1;
    } else if (token === '--output') {
      options.output = normalizedArgv[i + 1];
      i += 1;
    }
  }
  if (!options.disposition) {
    process.stderr.write('usage: acceptance-skeleton --disposition <complete|partial|deferred> [--output <path>]\n');
    process.exit(1);
  }
  try {
    const output = acceptanceSkeleton(options);
    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), output, 'utf8');
      process.stdout.write(`acceptance-skeleton: OK -> ${options.output}\n`);
    } else {
      process.stdout.write(output);
    }
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
