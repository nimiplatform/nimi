#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { promptSkeleton } from './lib/manager-assist.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: prompt-skeleton <topic-dir> --phase <name> --goal <text> [--output <path>]\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--phase') {
      options.phase = rest[i + 1];
      i += 1;
    } else if (token === '--goal') {
      options.goal = rest[i + 1];
      i += 1;
    } else if (token === '--output') {
      options.output = rest[i + 1];
      i += 1;
    }
  }
  try {
    const output = promptSkeleton(path.resolve(topicDir), options);
    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), output, 'utf8');
      process.stdout.write(`prompt-skeleton: OK -> ${options.output}\n`);
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
