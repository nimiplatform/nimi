#!/usr/bin/env node

import {
  checkTestTopology,
  parseCliArgs,
  renderTopologyReport,
  usage,
} from './lib/test-topology-governance.mjs';

let args;
try {
  args = parseCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage());
  process.exit(1);
}

if (args.help) {
  console.log(usage());
  process.exit(0);
}

const result = checkTestTopology();
for (const error of result.errors) {
  console.error(`ERROR: ${error}`);
}
if (args.report || args.suite) console.log(renderTopologyReport(result, args.suite));
if (!result.ok) {
  process.exit(1);
}
console.log(`test-topology: OK (${result.totalSuites} suites, ${result.totalFiles} test-bearing sources)`);
