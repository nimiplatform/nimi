import path from 'node:path';
import { updateModCatalog } from './lib/mod-catalog.mjs';

function parseArgs(argv) {
  const args = {
    catalogDir: path.resolve('examples/mod-catalog-template'),
    releaseManifestPaths: [],
    manifestFile: '',
    signersFile: '',
    packageId: '',
    channel: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog-dir') {
      args.catalogDir = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--release-manifest') {
      args.releaseManifestPaths.push(path.resolve(String(argv[index + 1] || '')));
      index += 1;
      continue;
    }
    if (arg === '--manifest-file') {
      args.manifestFile = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--signers-file') {
      args.signersFile = path.resolve(String(argv[index + 1] || ''));
      index += 1;
      continue;
    }
    if (arg === '--package-id') {
      args.packageId = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--channel') {
      args.channel = String(argv[index + 1] || '').trim();
      index += 1;
    }
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = updateModCatalog({
    catalogDir: args.catalogDir,
    releaseManifestPaths: args.releaseManifestPaths,
    manifestFile: args.manifestFile || undefined,
    signersFile: args.signersFile,
    expectedPackageId: args.packageId || undefined,
    expectedChannel: args.channel || undefined,
  });
  console.log(`update-mod-catalog: updated ${result.packageIds.join(', ')} -> ${result.indexDir}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  console.error(`update-mod-catalog: failed: ${message}`);
  process.exit(1);
}
