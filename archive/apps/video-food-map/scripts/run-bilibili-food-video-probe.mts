import process from 'node:process';
import { parseProbeArgs, runBilibiliFoodVideoProbe } from './lib/bilibili-food-video-probe.mts';

async function main(): Promise<void> {
  const args = parseProbeArgs(process.argv);
  const result = await runBilibiliFoodVideoProbe(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
