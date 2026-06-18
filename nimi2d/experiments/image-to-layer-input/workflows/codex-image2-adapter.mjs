#!/usr/bin/env node
import { runCodexImage2AdapterCli } from '../../../src/node/image2-provider/artifact.mjs';

runCodexImage2AdapterCli(process.argv.slice(2)).catch((error) => {
  process.stdout.write(JSON.stringify({
    status: 'error',
    kind: 'codex_image2_adapter',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.stdout.write('\n');
  process.exitCode = 1;
});
