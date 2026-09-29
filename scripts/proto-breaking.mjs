#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_RECORD_PATH,
  breakingFindings,
  classifyFindings,
  formatFinding,
  readBaselineRecord,
  recordMigrations,
  requireBuf,
  resolveBuf,
  verifyBaselineProvenance,
  verifyMigrationReferences,
} from './lib/proto-wire-baseline.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `--source-tag` prints the validated tag so CI can fetch exactly that ref
// before the gate runs; the gate itself never touches the network.
function main(argv) {
  const record = readBaselineRecord(repoRoot);
  if (argv.length === 1 && argv[0] === '--source-tag') {
    process.stdout.write(`${record.source.tag}\n`);
    return 0;
  }
  if (argv.length > 0) throw new Error(`unknown arguments: ${argv.join(' ')}`);

  verifyMigrationReferences(repoRoot, recordMigrations(record));
  const buf = requireBuf(resolveBuf());
  verifyBaselineProvenance({ repoRoot, record, buf });
  const findings = breakingFindings({
    buf,
    protoDir: path.join(repoRoot, 'proto'),
    againstImage: path.join(repoRoot, record.image.path),
  });
  const { declared, undeclared, stale } = classifyFindings(findings, record.declaredBreaking);
  const source = `the wire published at ${record.source.tag} (${record.source.commit.slice(0, 12)})`;

  if (undeclared.length > 0) {
    process.stderr.write(`[proto:breaking] failed: ${undeclared.length} undeclared breaking change(s) against ${source}:\n`);
    process.stderr.write(`${undeclared.map(formatFinding).join('\n')}\n`);
    process.stderr.write('[proto:breaking] keep published names, numbers and RPCs (reserve what is removed), or declare the '
      + `break in ${BASELINE_RECORD_PATH} declaredBreaking with its reason and the CHANGELOG migration heading of the new 0.x minor.\n`);
  }
  if (stale.length > 0) {
    process.stderr.write(`[proto:breaking] failed: ${stale.length} declaration(s) no longer match a breaking change; remove them:\n`);
    process.stderr.write(`${stale.map(formatFinding).join('\n')}\n`);
  }
  if (undeclared.length > 0 || stale.length > 0) return 1;

  process.stdout.write(`[proto:breaking] passed against ${source}; `
    + `${declared.length} declared breaking change(s); buf ${buf.version}\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[proto:breaking] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
