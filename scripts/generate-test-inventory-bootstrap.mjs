#!/usr/bin/env node

import {
  buildBootstrapInventory,
  parseCliArgs,
  usage,
  writeBootstrapInventory,
} from './lib/test-inventory-governance.mjs';

let args;
try {
  args = parseCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  console.error(usage('generate-test-inventory-bootstrap'));
  process.exit(1);
}

if (args.help) {
  console.log(usage('generate-test-inventory-bootstrap'));
  process.exit(0);
}

try {
  if (args.write) {
    const result = writeBootstrapInventory({
      domain: args.domain,
      output: args.output,
      force: args.force,
    });
    console.log(`generate-test-inventory-bootstrap: wrote ${result.outputRel} (${result.inventory.tests.length} tests)`);
  } else {
    const result = buildBootstrapInventory({ domain: args.domain });
    process.stdout.write(result.yaml);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
