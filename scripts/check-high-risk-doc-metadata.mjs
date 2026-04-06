#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateHighRiskDocMetadata } from './lib/check-high-risk-doc-metadata-core.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

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
