#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const specPath = path.join(repoRoot, '.cache', 'realm-openapi', 'api-nimi.yaml');
const generatedDir = path.join(repoRoot, 'sdk', 'src', 'realm', 'generated');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runGenerate() {
  const result = spawnSync('node', [
    'scripts/generate-realm-sdk.mjs',
    '--',
    '--input',
    '.cache/realm-openapi/api-nimi.yaml',
    '--skip-version-bump',
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const detail = [result.stdout || '', result.stderr || '']
      .join('\n')
      .trim();
    throw new Error(`generate:realm-sdk failed (exit=${result.status ?? -1})\n${detail}`);
  }

  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assertGeneratedArtifacts() {
  const requiredFiles = [
    path.join(generatedDir, 'schema.ts'),
    path.join(generatedDir, 'operation-map.ts'),
    path.join(generatedDir, 'service-registry.ts'),
    path.join(generatedDir, 'property-enums.ts'),
    path.join(generatedDir, 'index.ts'),
  ];

  for (const filePath of requiredFiles) {
    assert(existsSync(filePath), `missing generated artifact: ${filePath}`);
    const size = statSync(filePath).size;
    assert(size > 0, `empty generated artifact: ${filePath}`);
  }

  const modelsDir = path.join(generatedDir, 'models');
  assert(existsSync(modelsDir), `missing generated models dir: ${modelsDir}`);
  assert(statSync(modelsDir).isDirectory(), `generated models path is not directory: ${modelsDir}`);

  const operationMapSource = readFileSync(path.join(generatedDir, 'operation-map.ts'), 'utf8');
  assert(
    operationMapSource.includes('"HumanChatService.listMessages"'),
    'operation-map missing HumanChatService.listMessages key',
  );

  const registrySource = readFileSync(path.join(generatedDir, 'service-registry.ts'), 'utf8');
  assert(
    registrySource.includes('type OperationInvokerArgs<K extends OperationKey> = ['),
    'service-registry missing typed OperationInvokerArgs declaration',
  );
}

function assertSplitModules() {
  const modules = [
    path.join(repoRoot, 'scripts', 'realm-sdk', 'constants.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'cli.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'fs-state.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'openapi-pipeline.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'parse-operations.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'emit-operation-artifacts.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'model-utils.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'generate-models.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'generate-property-enums.mjs'),
    path.join(repoRoot, 'scripts', 'realm-sdk', 'generate-realm-facade.mjs'),
  ];

  for (const filePath of modules) {
    assert(existsSync(filePath), `missing split module: ${filePath}`);
  }

  const operationsSource = readFileSync(path.join(repoRoot, 'scripts', 'realm-sdk', 'parse-operations.mjs'), 'utf8');
  assert(
    operationsSource.includes('export function parseRealmOperations(spec) {'),
    'parse-operations.mjs missing parseRealmOperations export',
  );

  const emitSource = readFileSync(path.join(repoRoot, 'scripts', 'realm-sdk', 'emit-operation-artifacts.mjs'), 'utf8');
  assert(
    emitSource.includes('export function writeOperationArtifacts(repoRoot, operations) {'),
    'emit-operation-artifacts.mjs missing writeOperationArtifacts export',
  );

  const modelsSource = readFileSync(path.join(repoRoot, 'scripts', 'realm-sdk', 'generate-models.mjs'), 'utf8');
  assert(
    modelsSource.includes('export function writeGeneratedModels(repoRoot, spec) {'),
    'generate-models.mjs missing writeGeneratedModels export',
  );

  const enumsSource = readFileSync(path.join(repoRoot, 'scripts', 'realm-sdk', 'generate-property-enums.mjs'), 'utf8');
  assert(
    enumsSource.includes('export function writePropertyEnums(repoRoot, spec) {'),
    'generate-property-enums.mjs missing writePropertyEnums export',
  );

  const facadeSource = readFileSync(path.join(repoRoot, 'scripts', 'realm-sdk', 'generate-realm-facade.mjs'), 'utf8');
  assert(
    facadeSource.includes('export function writeRealmFacade(repoRoot) {'),
    'generate-realm-facade.mjs missing writeRealmFacade export',
  );
}

function main() {
  assert(existsSync(specPath), `realm OpenAPI spec not found: ${specPath}`);

  runGenerate();
  const secondRunOutput = runGenerate();

  assert(
    secondRunOutput.includes('[generate:realm-sdk] generated changed: false'),
    'second generate run is not stable (expected generated changed: false)',
  );

  assertGeneratedArtifacts();
  assertSplitModules();

  process.stdout.write('realm-sdk generator smoke check passed\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[check:realm-sdk-generator-smoke] failed: ${message}\n`);
  process.exit(1);
}
