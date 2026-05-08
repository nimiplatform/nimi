import { migrateRuntimeLocalState } from './lib/runtime-local-state-migrate.mjs';

function usage() {
  return [
    'Usage: node scripts/migrate-runtime-local-state-v1-to-v2.mjs [--dry-run] [--target <path>]',
    '       node scripts/migrate-runtime-local-state-v1-to-v2.mjs --write --consent-ref <ref> [--target <path>]',
    '',
    'Defaults to dry-run. Writes require --write and --consent-ref.',
  ].join('\n');
}

function takeValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(args) {
  const options = {
    targetPath: undefined,
    write: false,
    dryRun: false,
    consentRef: '',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--write') {
      options.write = true;
      continue;
    }

    if (arg === '--target') {
      options.targetPath = takeValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--consent-ref') {
      options.consentRef = takeValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }

    if (options.targetPath) {
      throw new Error(`unexpected extra target path: ${arg}`);
    }
    options.targetPath = arg;
  }

  if (options.dryRun && options.write) {
    throw new Error('--dry-run and --write cannot be combined');
  }

  if (!options.write && options.consentRef) {
    throw new Error('--consent-ref is only valid with --write');
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = await migrateRuntimeLocalState({
    targetPath: options.targetPath,
    write: options.write,
    consentRef: options.consentRef,
  });

  if (!result.migrated) {
    console.log(`local runtime state already schemaVersion=2: ${result.path}`);
    return;
  }

  if (!result.write) {
    console.log(`dry run: local runtime state would migrate to schemaVersion=2: ${result.path}`);
    return;
  }

  console.log(`migrated local runtime state to schemaVersion=2: ${result.path}`);
  if (result.backupPath) {
    console.log(`backup written: ${result.backupPath}`);
  }
  console.log(`consent ref: ${result.consentRef}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
