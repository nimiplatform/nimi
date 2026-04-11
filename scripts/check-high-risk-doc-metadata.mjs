#!/usr/bin/env node
import path from 'node:path';
import { evaluateHighRiskDocMetadata } from './lib/check-high-risk-doc-metadata-core.mjs';

export function main() {
  const repoRoot = process.cwd();
  try {
    const report = evaluateHighRiskDocMetadata({ repoRoot });
    if (report.failures.length > 0) {
      process.stderr.write('high-risk doc metadata check failed:\n');
      for (const failure of report.failures) {
        process.stderr.write(`- ${failure}\n`);
      }
      process.exit(1);
    }
    process.stdout.write(`high-risk doc metadata check passed (${report.scanned.length} file(s) scanned)\n`);
  } catch (error) {
    process.stderr.write(`check-high-risk-doc-metadata failed: ${String(error)}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
