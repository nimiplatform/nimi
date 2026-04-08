#!/usr/bin/env node
import path from 'node:path';
import { initTopic } from './lib/topic-ops.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, ...rest] = normalizedArgv;
  if (!topicDir) {
    process.stderr.write('usage: init-topic <topic-dir> [--title <title>] [--owner <owner>]\n');
    process.exit(1);
  }
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--title') {
      options.title = rest[i + 1];
      i += 1;
    } else if (token === '--owner') {
      options.owner = rest[i + 1];
      i += 1;
    } else if (token === '--topic-id') {
      options.topicId = rest[i + 1];
      i += 1;
    }
  }
  initTopic(path.resolve(topicDir), options);
  process.stdout.write(`init-topic: OK ${topicDir}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
