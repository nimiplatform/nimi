import path from 'node:path';
import { generateModCatalog } from './lib/mod-catalog.mjs';

function parseArgs(argv) {
  const args = {
    sourceDir: path.resolve('nimi-mods'),
    outDir: path.resolve('.local/report/mod-catalog-fixture/latest'),
    signersFile: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-dir') {
      args.sourceDir = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--out-dir') {
      args.outDir = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--signers-file') {
      args.signersFile = path.resolve(String(argv[index + 1] || ''));
      index += 1;
    }
  }
  return args;
}

try {
  const result = generateModCatalog(parseArgs(process.argv.slice(2)));
  console.log(`mod-catalog-fixture: generated ${result.packageCount} package(s) -> ${result.outputDir}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`mod-catalog-fixture: failed: ${message}`);
  process.exit(1);
}
