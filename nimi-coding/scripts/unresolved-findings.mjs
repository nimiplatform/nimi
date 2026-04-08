#!/usr/bin/env node
import path from 'node:path';
import { unresolvedFindings } from './lib/manager-assist.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: unresolved-findings <topic-dir>\n');
    process.exit(1);
  }
  try {
    const output = unresolvedFindings(path.resolve(topicDir));
    process.stdout.write(output + '\n');
  } catch (e) {
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
