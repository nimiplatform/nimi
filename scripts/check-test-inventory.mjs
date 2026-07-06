#!/usr/bin/env node

import {
  auditInventoryClassifications,
  checkInventories,
  parseCliArgs,
  usage,
} from './lib/test-inventory-governance.mjs';

let args;
try {
  args = parseCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage('check-test-inventory'));
  process.exit(1);
}

if (args.help) {
  console.log(usage('check-test-inventory'));
  process.exit(0);
}

const result = checkInventories({ domain: args.domain, report: args.report });
for (const error of result.errors) {
  console.error(`ERROR: ${error}`);
}
if (args.report && result.reportText) {
  console.log(result.reportText);
}
if (args.auditClassification) {
  const audit = auditInventoryClassifications({ domain: args.domain });
  console.log(audit.reportText);
}
if (!result.ok) {
  process.exit(1);
}
console.log(`test-inventory: OK (${result.totalFiles} tests inventoried, quarantine_unreviewed backlog: ${result.totalBacklog})`);
