import process from 'node:process';
import { loadVideoFoodMapRuntimeOptions } from './lib/runtime-route-options.mts';

async function main(): Promise<void> {
  const runtimeGrpcAddr = String(process.env.NIMI_RUNTIME_GRPC_ADDR || '').trim();
  const result = await loadVideoFoodMapRuntimeOptions(runtimeGrpcAddr);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
