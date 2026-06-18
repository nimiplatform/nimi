#!/usr/bin/env node
import { runCodexImage2DistributionReportCli } from '../../../src/node/image2-provider/distribution-report.mjs';

runCodexImage2DistributionReportCli(process.argv.slice(2)).catch((error) => {
  process.stdout.write(`${JSON.stringify({
    status: 'error',
    kind: 'codex_image2_distribution_report',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
});
