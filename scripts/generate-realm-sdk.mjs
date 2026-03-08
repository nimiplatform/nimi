#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import { parseArgs, resolveInputPath } from './realm-sdk/cli.mjs';
import { REALM_GENERATED_RELATIVE_PATH } from './realm-sdk/constants.mjs';
import { cleanRealmSources, computeDirectoryHash } from './realm-sdk/fs-state.mjs';
import { runOpenApiTypescript, normalizeOperationsInterfaceInSchema } from './realm-sdk/openapi-pipeline.mjs';
import { writeOperationArtifacts } from './realm-sdk/emit-operation-artifacts.mjs';
import { writeGeneratedModels } from './realm-sdk/generate-models.mjs';
import { writePropertyEnums } from './realm-sdk/generate-property-enums.mjs';
import { writeRealmFacade } from './realm-sdk/generate-realm-facade.mjs';
import { parseRealmOperations } from './realm-sdk/parse-operations.mjs';
import { maybeUpdateRealmVersion } from './realm-sdk/versioning.mjs';

function main() {
  const options = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const inputPath = resolveInputPath(repoRoot, options.input);
  const realmGeneratedPath = path.join(repoRoot, REALM_GENERATED_RELATIVE_PATH);

  if (!existsSync(inputPath)) {
    throw new Error(`OpenAPI spec not found: ${inputPath}`);
  }

  const beforeHash = computeDirectoryHash(realmGeneratedPath);

  if (!options.skipClean) {
    process.stdout.write('[generate:realm-sdk] Cleaning generated realm SDK artifacts\n');
    cleanRealmSources(repoRoot);
  }

  runOpenApiTypescript(repoRoot, inputPath);
  normalizeOperationsInterfaceInSchema(repoRoot);

  const spec = parseYaml(readFileSync(inputPath, 'utf8'));
  const operations = parseRealmOperations(spec);
  process.stdout.write(`[generate:realm-sdk] parsed operations: ${operations.length}\n`);

  writeOperationArtifacts(repoRoot, operations);
  writeGeneratedModels(repoRoot, spec);
  writePropertyEnums(repoRoot, spec);
  writeRealmFacade(repoRoot);

  const afterHash = computeDirectoryHash(realmGeneratedPath);
  const generatedChanged = beforeHash !== afterHash;
  process.stdout.write(`[generate:realm-sdk] generated changed: ${generatedChanged}\n`);
  maybeUpdateRealmVersion(repoRoot, options, generatedChanged);
  process.stdout.write('\n[generate:realm-sdk] Completed successfully.\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[generate:realm-sdk] Failed: ${message}\n`);
  process.exit(1);
}
