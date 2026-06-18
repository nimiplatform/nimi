#!/usr/bin/env node
import { runCodexImage2LayerWorkflowCli } from '../../../src/node/image2-provider/layer-workflow.mjs';

runCodexImage2LayerWorkflowCli(process.argv.slice(2)).catch((error) => {
  process.stdout.write(`${JSON.stringify({
    status: 'error',
    kind: 'codex_image2_layer_workflow',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
});
