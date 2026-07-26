#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { safeHarnessFailure } from './p4-errors.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : String(process.argv[index + 1] || '');
}

function writeResult(file, result) {
  fs.writeFileSync(file, `${JSON.stringify(result)}\n`, { encoding: 'utf8', mode: 0o600 });
}

const requestPath = path.resolve(option('--request'));
const resultPath = path.resolve(option('--result'));
let result;
try {
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  if (!['first-run', 'direct-nimi', 'partner-core'].includes(request?.gate)) {
    throw new Error(`worker received unsupported P4 gate: ${String(request?.gate || '<empty>')}`);
  }
  const { runFirstPartyProductJourney } = await import('./first-party-product-journey-driver.mjs');
  const observations = await runFirstPartyProductJourney({
    gate: request.gate,
    repoRoot: request.repoRoot,
    outputDir: request.outputDir,
    prerequisite: request.prerequisite,
    productRoot: request.productRoot,
  });
  result = { ok: true, observations };
} catch (error) {
  result = { ok: false, error: safeHarnessFailure(error) };
  process.exitCode = 1;
}

try {
  writeResult(resultPath, result);
} catch (error) {
  process.stderr.write(`P4 worker could not write its result: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
