import path from 'node:path';
import {
  validateSignerRegistryFile,
  validateStaticModCatalog,
} from './lib/mod-catalog.mjs';

function parseArgs(argv) {
  const args = {
    signersFile: path.resolve('examples/mod-catalog-template/signers.example.json'),
    catalogDir: path.resolve('examples/mod-catalog-template'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--signers-file') {
      args.signersFile = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--catalog-dir') {
      args.catalogDir = path.resolve(String(argv[index + 1] || ''));
      index += 1;
    }
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const signerResult = validateSignerRegistryFile({ signersFile: args.signersFile });
  const catalogResult = validateStaticModCatalog({ catalogDir: args.catalogDir });
  console.log(
    `mod-catalog-signers: ok signers=${signerResult.signerCount} overrides=${signerResult.packageOverrideCount} packages=${catalogResult.packageCount}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`mod-catalog-signers: failed: ${message}`);
  process.exit(1);
}
