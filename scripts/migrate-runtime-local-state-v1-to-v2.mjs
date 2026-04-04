import { migrateRuntimeLocalState } from './lib/runtime-local-state-migrate.mjs';

async function main() {
  const targetPath = process.argv[2];
  const result = await migrateRuntimeLocalState({ targetPath });

  if (!result.migrated) {
    console.log(`local runtime state already schemaVersion=2: ${result.path}`);
    return;
  }

  console.log(`migrated local runtime state to schemaVersion=2: ${result.path}`);
  if (result.backupPath) {
    console.log(`backup written: ${result.backupPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
