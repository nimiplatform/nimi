#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import {
  validateConversationReportArchitecture,
  validateConversationReportBundle,
} from '../tests/local-agent-product/conversation-report/checker.mjs';
import { repoRoot } from '../tests/local-agent-product/harness/registry.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

function latestBundleRoot() {
  const file = path.join(repoRoot, '.nimi', 'local', 'reports', 'local-agent-conversation', 'latest.json');
  if (!fs.existsSync(file)) throw new Error('no LocalAgent conversation report index exists; run the baseline Journey first');
  return JSON.parse(fs.readFileSync(file, 'utf8')).bundleRoot;
}

const bundleRoot = path.resolve(option('--report-root') || latestBundleRoot());
const failures = [
  ...validateConversationReportArchitecture(),
  ...validateConversationReportBundle({ bundleRoot }).failures,
];
if (failures.length > 0) {
  process.stderr.write(`LocalAgent conversation report INCOMPLETE\n${[...new Set(failures)].map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`LocalAgent conversation report mechanically COMPLETE (semantic review remains unreviewed; ${bundleRoot})\n`);
