#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODES,
  loadAuthorityBundle,
  runNegativeFixtures,
  validateAllModes,
  validateAuthorityBundle,
} from './lib/protected-local-authority-check.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixturePath = path.join(scriptDir, 'testdata/protected-local-authority/negative-fixtures.json');

function readArguments(argv) {
  if (argv.length === 1 && argv[0] === '--fixture-report-json') return { fixtureReport: true };
  if (argv.length === 2 && argv[0] === '--mode' && MODES.includes(argv[1])) return { mode: argv[1] };
  return { argumentError: true };
}

function printIssues(issues) {
  for (const item of issues) {
    process.stderr.write(`[${item.code}] ${item.reason} (${item.target})\n`);
  }
}

function main() {
  const options = readArguments(process.argv.slice(2));
  if (options.argumentError) {
    process.stderr.write(`[ARGUMENT_ERROR] expected --mode <${MODES.join('|')}> or --fixture-report-json\n`);
    process.exitCode = 1;
    return;
  }

  const bundle = loadAuthorityBundle(repoRoot);
  if (options.fixtureReport) {
    const baselineIssues = validateAllModes(bundle);
    if (baselineIssues.length > 0) {
      printIssues(baselineIssues);
      process.exitCode = 1;
      return;
    }
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    process.stdout.write(`${JSON.stringify({ fixtures: runNegativeFixtures(bundle, fixtures) }, null, 2)}\n`);
    return;
  }

  const issues = validateAuthorityBundle(bundle, options.mode);
  if (issues.length > 0) {
    printIssues(issues);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${options.mode}: OK\n`);
}

main();
