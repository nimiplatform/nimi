#!/usr/bin/env node
import path from 'node:path';
import { attachEvidence } from './lib/topic-ops.mjs';

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [topicDir, evidenceRelPath, ...rest] = normalizedArgv;
  if (!topicDir || !evidenceRelPath) {
    process.stderr.write('usage: attach-evidence <topic-dir> <evidence-rel-path> [--final]\n');
    process.exit(1);
  }
  const options = {
    final: rest.includes('--final'),
  };
  const report = attachEvidence(path.resolve(topicDir), evidenceRelPath, options);
  for (const warning of report.warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (!report.ok) {
    for (const error of report.errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`attach-evidence: OK ${topicDir} -> ${evidenceRelPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
