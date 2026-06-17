#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sdksTypescriptRoot = path.join(repoRoot, 'sdks', 'typescript');
const baselineSdkPackageJsonPath = 'archive/sdk-pre-vnext-20260606/package.json';
const migrationMatrixPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-surface-migration-matrix.yaml',
);
const targetExportMapPath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'sdks',
  'kernel',
  'tables',
  'typescript-target-export-map.yaml',
);

const REQUIRED_IMPLEMENTED_EXPORTS = new Map([
  ['.', 'index.ts'],
  ['./runtime', 'runtime/index.ts'],
  ['./runtime/generated', 'runtime/generated.ts'],
  ['./realm', 'realm/index.ts'],
  ['./realm/generated', 'realm/generated.ts'],
  ['./app', 'core/app/index.ts'],
  ['./types', 'types/index.ts'],
  ['./contracts', 'core/contracts/index.ts'],
  ['./ai', 'core/ai/index.ts'],
  ['./ai-runner', 'core/ai-runner/index.ts'],
  ['./testing', 'core/testing/index.ts'],
  ['./features/conversation', 'features/conversation/index.ts'],
  ['./features/knowledge-context', 'features/knowledge-context/index.ts'],
  ['./features/memory-context', 'features/memory-context/index.ts'],
  ['./features/generation', 'features/generation/index.ts'],
  ['./features/workflow', 'features/workflow/index.ts'],
  ['./features/evaluation', 'features/evaluation/index.ts'],
  ['./features/toolkits', 'features/toolkits/index.ts'],
]);

const EXPECTED_TARGET_EXPORT_IDS = new Map([
  ['.', 'root'],
  ['./runtime', 'runtime'],
  ['./runtime/generated', 'runtime-generated'],
  ['./realm', 'realm'],
  ['./realm/generated', 'realm-generated'],
  ['./app', 'app'],
  ['./types', 'types'],
  ['./contracts', 'contracts'],
  ['./ai', 'ai'],
  ['./ai-runner', 'ai-runner'],
  ['./testing', 'testing'],
  ['./features/conversation', 'features-conversation'],
  ['./features/knowledge-context', 'features-knowledge-context'],
  ['./features/memory-context', 'features-memory-context'],
  ['./features/generation', 'features-generation'],
  ['./features/workflow', 'features-workflow'],
  ['./features/evaluation', 'features-evaluation'],
  ['./features/toolkits', 'features-toolkits'],
]);

const VALID_MIGRATION_DECISIONS = new Set([
  'retain-redesign',
  'retain-direct',
  'delete-hardcut',
  'defer-blocking',
  'owner-decision',
]);

const FORBIDDEN_BASE_EXPORTS = [
  './adapters/',
  './migration-proofs',
  './ai-provider',
  './ai-app',
  './scope',
  './scope/',
  './world',
  './platform-catalog',
  './runtime/browser',
  './runtime/agent-identity',
];

const FORBIDDEN_BASE_DEPENDENCIES = [
  '@grpc/grpc-js',
];

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

async function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(await fs.readFile(absolutePath, 'utf8'));
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function currentPackageSubpath(exportKey) {
  if (exportKey === '.') {
    return '@nimiplatform/sdk';
  }
  if (!exportKey.startsWith('./')) {
    throw new Error(`unexpected SDK export key: ${exportKey}`);
  }
  return `@nimiplatform/sdk/${exportKey.slice(2)}`;
}

function collectPackageExports(packageJson) {
  return Object.keys(packageJson.exports ?? {}).sort();
}

function collectMigrationEntries(raw) {
  const entries = [];
  const chunks = raw.split(/\n(?=  - current_package_subpath: )/g);
  for (const chunk of chunks) {
    const surface = chunk.match(/current_package_subpath:\s*"([^"]+)"/)?.[1];
    if (!surface) continue;
    const decision = chunk.match(/\n\s+decision:\s*([a-z-]+)/)?.[1] ?? '';
    const targetOwner = chunk.match(/\n\s+target_owner:\s*([^\n]+)/)?.[1]?.trim() ?? '';
    entries.push({ surface, decision, targetOwner });
  }
  return entries;
}

function assertExportNode(exportKey, exportNode, sourceRelativePath, violations) {
  if (!exportNode || typeof exportNode !== 'object') {
    violations.push(`sdks/typescript package export ${exportKey} must use { types, default }`);
    return;
  }
  const defaultTarget = exportNode.default;
  const typesTarget = exportNode.types;
  if (typeof defaultTarget !== 'string' || typeof typesTarget !== 'string') {
    violations.push(`sdks/typescript package export ${exportKey} must define string default and types targets`);
    return;
  }
  const expectedDefault = `./dist/${sourceRelativePath.replace(/\.ts$/, '.js')}`;
  const expectedTypes = `./dist/${sourceRelativePath.replace(/\.ts$/, '.d.ts')}`;
  if (defaultTarget !== expectedDefault) {
    violations.push(`sdks/typescript package export ${exportKey} default must be ${expectedDefault}, got ${defaultTarget}`);
  }
  if (typesTarget !== expectedTypes) {
    violations.push(`sdks/typescript package export ${exportKey} types must be ${expectedTypes}, got ${typesTarget}`);
  }
}

async function main() {
  const violations = [];
  const baselineSdkPackage = await readJson(baselineSdkPackageJsonPath);
  const vnextPackage = await readJson('sdks/typescript/package.json');
  const workspaceRaw = await fs.readFile(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const matrixRaw = await fs.readFile(migrationMatrixPath, 'utf8');
  const targetExportMapRaw = await fs.readFile(targetExportMapPath, 'utf8');
  const runtimeIndexRaw = await fs.readFile(path.join(sdksTypescriptRoot, 'runtime', 'index.ts'), 'utf8');
  const rootIndexRaw = await fs.readFile(path.join(sdksTypescriptRoot, 'index.ts'), 'utf8');
  const aiRunnerIndexRaw = await fs.readFile(path.join(sdksTypescriptRoot, 'core', 'ai-runner', 'index.ts'), 'utf8');
  const workspaceIncludesVNextPackage =
    workspaceRaw.includes("  - 'sdks/typescript'") || workspaceRaw.includes('  - "sdks/typescript"');
  const workspaceCutoverState = String(vnextPackage.nimi?.workspaceCutover ?? '');
  const activeWorkspaceHardcut = workspaceCutoverState === 'active-local-hardcut';

  if (vnextPackage.name !== '@nimiplatform/sdk') {
    violations.push(`sdks/typescript/package.json name must be @nimiplatform/sdk, got ${String(vnextPackage.name)}`);
  }
  if (vnextPackage.private !== true) {
    violations.push('sdks/typescript/package.json must stay private before cutover');
  }
  if (vnextPackage.type !== 'module') {
    violations.push('sdks/typescript/package.json must be type=module');
  }
  if (vnextPackage.nimi?.preCutover !== true) {
    violations.push('sdks/typescript/package.json must mark nimi.preCutover=true');
  }
  if (workspaceIncludesVNextPackage && !activeWorkspaceHardcut) {
    violations.push('pnpm-workspace.yaml must not include sdks/typescript unless sdks/typescript/package.json marks nimi.workspaceCutover=active-local-hardcut');
  }
  if (!workspaceIncludesVNextPackage && activeWorkspaceHardcut) {
    violations.push('sdks/typescript/package.json marks active-local-hardcut but pnpm-workspace.yaml does not include sdks/typescript');
  }
  for (const dependencyName of FORBIDDEN_BASE_DEPENDENCIES) {
    if (Object.hasOwn(vnextPackage.dependencies ?? {}, dependencyName)) {
      violations.push(`sdks/typescript base dependencies must not include Node-only package ${dependencyName}`);
    }
    if (!Object.hasOwn(vnextPackage.peerDependencies ?? {}, dependencyName)) {
      violations.push(`sdks/typescript must declare ${dependencyName} as an optional peer for node-grpc Runtime transport`);
    }
    if (vnextPackage.peerDependenciesMeta?.[dependencyName]?.optional !== true) {
      violations.push(`sdks/typescript peer dependency ${dependencyName} must be marked optional`);
    }
  }
  if (/import\s+\{[^}]*createRuntimeNodeGrpcTransport[^}]*\}\s+from\s+['"]\.\/node-grpc['"]/.test(runtimeIndexRaw)) {
    violations.push('runtime/index.ts must not statically import createRuntimeNodeGrpcTransport from node-grpc');
  }
  if (/export\s+\{[^}]*createRuntimeNodeGrpcTransport[^}]*\}\s+from\s+['"]\.\/node-grpc['"]/.test(runtimeIndexRaw)) {
    violations.push('runtime/index.ts must not re-export createRuntimeNodeGrpcTransport from the browser-safe Runtime facade');
  }
  for (const [label, source] of [
    ['index.ts', rootIndexRaw],
    ['runtime/index.ts', runtimeIndexRaw],
    ['core/ai-runner/index.ts', aiRunnerIndexRaw],
  ]) {
    if (/from\s+['"]node:/.test(source)) {
      violations.push(`${label} must not import Node built-ins from a browser-safe SDK facade`);
    }
  }
  if (aiRunnerIndexRaw.includes('./trace-fixture')) {
    violations.push('core/ai-runner/index.ts must not re-export test trace fixtures from the production AI runner facade');
  }

  const vnextExports = collectPackageExports(vnextPackage);
  const expectedImplementedExports = [...REQUIRED_IMPLEMENTED_EXPORTS.keys()].sort();
  if (JSON.stringify(vnextExports) !== JSON.stringify(expectedImplementedExports)) {
    violations.push(
      `sdks/typescript implemented exports mismatch: expected ${expectedImplementedExports.join(', ')}, got ${vnextExports.join(', ')}`,
    );
  }

  for (const forbiddenExport of FORBIDDEN_BASE_EXPORTS) {
    const leaked = vnextExports.find((exportKey) => exportKey === forbiddenExport || exportKey.startsWith(forbiddenExport));
    if (leaked) {
      violations.push(`base vNext SDK export must not expose legacy/adapter surface ${leaked}`);
    }
  }

  for (const [exportKey, sourceRelativePath] of REQUIRED_IMPLEMENTED_EXPORTS) {
    const sourcePath = normalizePath(path.join('sdks', 'typescript', sourceRelativePath));
    if (!await pathExists(sourcePath)) {
      violations.push(`sdks/typescript export ${exportKey} source missing: ${sourcePath}`);
    }
    assertExportNode(exportKey, vnextPackage.exports?.[exportKey], sourceRelativePath, violations);

    const targetId = EXPECTED_TARGET_EXPORT_IDS.get(exportKey);
    if (targetId && !targetExportMapRaw.includes(`id: ${targetId}`)) {
      violations.push(`target export map missing id for implemented export ${exportKey}: ${targetId}`);
    }
  }

  for (const requiredTargetId of ['root', 'app', 'features-workflow']) {
    if (!targetExportMapRaw.includes(`id: ${requiredTargetId}`)) {
      violations.push(`target export map missing required vNext target id: ${requiredTargetId}`);
    }
  }

  const baselineSdkSurfaces = collectPackageExports(baselineSdkPackage).map(currentPackageSubpath).sort();
  const migrationEntries = collectMigrationEntries(matrixRaw);
  const migrationBySurface = new Map(migrationEntries.map((entry) => [entry.surface, entry]));
  for (const surface of baselineSdkSurfaces) {
    const entry = migrationBySurface.get(surface);
    if (!entry) {
      violations.push(`migration matrix missing archived baseline SDK surface: ${surface}`);
      continue;
    }
    if (!VALID_MIGRATION_DECISIONS.has(entry.decision)) {
      violations.push(`migration matrix surface ${surface} has invalid decision: ${entry.decision}`);
    }
    if (!entry.targetOwner) {
      violations.push(`migration matrix surface ${surface} missing target_owner`);
    }
  }

  const extraSurfaces = [...migrationBySurface.keys()].filter((surface) => !baselineSdkSurfaces.includes(surface));
  if (extraSurfaces.length > 0) {
    violations.push(`migration matrix has unknown archived baseline SDK surfaces: ${extraSurfaces.join(', ')}`);
  }

  if (violations.length > 0) {
    process.stderr.write('SDK vNext package contract check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `SDK vNext package contract check passed ` +
      `(${vnextExports.length} implemented export(s), ` +
      `${migrationEntries.length} migration row(s), ` +
      `workspace_cutover=${workspaceCutoverState || 'inactive'})\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-package-contract failed: ${message}\n`);
  process.exitCode = 1;
});
