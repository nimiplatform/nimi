#!/usr/bin/env node

import {
  DEFAULT_MAX_REPORTED_VIOLATIONS,
  formatSummary,
  formatViolation,
  scanRepo,
} from './lib/text-encoding-gate.mjs';

const args = process.argv.slice(2);
const stagedOnly = args.includes('--staged-only');
const quietSuccess = args.includes('--quiet-success');
const unknownArgs = args.filter((arg) => !['--staged-only', '--quiet-success'].includes(arg));

if (unknownArgs.length > 0) {
  process.stderr.write(`check:text-encoding unknown argument(s): ${unknownArgs.join(', ')}\n`);
  process.exit(2);
}

try {
  const result = scanRepo({ stagedOnly });
  if (result.violations.length > 0) {
    process.stderr.write(
      `[check:text-encoding] FAIL: ${result.violations.length} violation(s); scanned ${formatSummary(result)}\n`,
    );
    for (const violation of result.violations.slice(0, DEFAULT_MAX_REPORTED_VIOLATIONS)) {
      process.stderr.write(`- ${formatViolation(violation)}\n`);
    }
    if (result.violations.length > DEFAULT_MAX_REPORTED_VIOLATIONS) {
      process.stderr.write(
        `... ${result.violations.length - DEFAULT_MAX_REPORTED_VIOLATIONS} more violation(s) omitted\n`,
      );
    }
    process.exit(1);
  }

  if (!quietSuccess) {
    process.stdout.write(`[check:text-encoding] PASS: scanned ${formatSummary(result)}\n`);
  }
} catch (error) {
  process.stderr.write(`check:text-encoding failed: ${error.stack || error.message}\n`);
  process.exit(1);
}
