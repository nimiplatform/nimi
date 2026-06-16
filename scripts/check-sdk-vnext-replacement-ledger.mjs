#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ledgerPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-replacement-coverage-ledger.yaml',
);
const inventoryPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-app-adaptation-inventory.yaml',
);
const vnextPackagePath = path.join(repoRoot, 'sdks', 'typescript', 'package.json');
const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
const baselineSdkSourceRoot = 'archive/sdk-pre-vnext-20260606/src';
const acceptanceMode = process.argv.includes('--acceptance');

const VALID_REPLACEMENT_STATUSES = new Set(['implemented', 'hardcut', 'deferred', 'pending', 'owner-decision']);
const VALID_EVIDENCE_CLASSES = new Set(['replacement', 'hardcut', 'baseline-regression', 'proof-only']);
const VALID_ADAPTATION_STATUSES = new Set(['implemented', 'pending', 'blocked']);
const REQUIRED_VISIBLE_ROWS = new Set([
  'root-platform-composition',
  'first-party-app-adaptation',
]);
const REQUIRED_INVENTORY_IDS = new Set([
  'desktop',
  'tester',
  'avatar',
  'web',
  'kit-core',
  'examples-sdk',
  'examples-app-template',
  'migration-proofs',
]);
const IMPORT_SCAN_ROOTS = ['apps', 'kit', 'examples'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.tmp',
  '.next',
  '.turbo',
  '.svelte-kit',
]);

function readYaml(filePath) {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function normalize(relativePath) {
  return relativePath.replaceAll(path.sep, '/').replace(/\/+$/u, '');
}

function existsRelative(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
}

function walkFiles(root, predicate, output = []) {
  const absoluteRoot = path.join(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return output;
  }
  for (const entry of readdirSync(absoluteRoot)) {
    if (SKIP_DIRS.has(entry)) continue;
    const absolutePath = path.join(absoluteRoot, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walkFiles(relative(absolutePath), predicate, output);
      continue;
    }
    const rel = relative(absolutePath);
    if (predicate(rel)) {
      output.push(rel);
    }
  }
  return output;
}

function collectBaselineSdkSourceFiles() {
  return walkFiles(baselineSdkSourceRoot, (file) => {
    if (!file.endsWith('.ts')) return false;
    const segments = file.split('/');
    return !segments.includes('generated') && !segments.includes('gen');
  }).sort();
}

function collectVNextHandwrittenSourceFiles() {
  return walkFiles('sdks/typescript', (file) => {
    if (!file.endsWith('.ts')) return false;
    const segments = file.split('/');
    return !segments.includes('dist') && !segments.includes('core-generated');
  }).sort();
}

function sourceRootMatches(sourceRoot, file) {
  const root = normalize(sourceRoot);
  if (!root) return false;
  if (root.endsWith('.ts') || root.endsWith('.tsx') || root.endsWith('.js')) {
    return file === root;
  }
  return file === root || file.startsWith(`${root}/`);
}

function countSdkImports() {
  const counts = new Map();
  let total = 0;
  const importPattern = /(?:from\s+['"]|import\(['"]|require\(['"])(@nimiplatform\/sdk(?:\/[A-Za-z0-9_.\/-]+)?)/gu;
  for (const root of IMPORT_SCAN_ROOTS) {
    const files = walkFiles(root, (file) => SOURCE_EXTENSIONS.has(path.extname(file)));
    for (const file of files) {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      const matches = [...text.matchAll(importPattern)];
      if (matches.length === 0) continue;
      total += matches.length;
      for (const inventoryRoot of REQUIRED_INVENTORY_IDS.keys()) {
        // Inventory ids are not always source roots.
        void inventoryRoot;
      }
      for (const [id, sourceRoot] of inventorySourceRoots()) {
        if (sourceRootMatches(sourceRoot, file)) {
          counts.set(id, (counts.get(id) ?? 0) + matches.length);
        }
      }
    }
  }
  return { counts, total };
}

let cachedInventorySourceRoots = null;
function inventorySourceRoots() {
  if (cachedInventorySourceRoots) return cachedInventorySourceRoots;
  if (!existsSync(inventoryPath)) return [];
  const inventory = readYaml(inventoryPath);
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  cachedInventorySourceRoots = entries
    .map((entry) => [String(entry?.id ?? ''), String(entry?.source_root ?? '')])
    .filter(([id, sourceRoot]) => id && sourceRoot);
  return cachedInventorySourceRoots;
}

function validateLedger() {
  const violations = [];
  const warnings = [];
  if (!existsSync(ledgerPath)) {
    throw new Error(`missing ledger: ${relative(ledgerPath)}`);
  }
  const ledger = readYaml(ledgerPath);
  if (ledger?.protocol_id !== 'sdks_typescript_replacement_coverage_ledger') {
    violations.push('ledger must use protocol_id sdks_typescript_replacement_coverage_ledger');
  }

  const baselineFiles = collectBaselineSdkSourceFiles();
  const vnextFiles = collectVNextHandwrittenSourceFiles();

  const surfaces = Array.isArray(ledger?.surfaces) ? ledger.surfaces : [];
  const rowsById = new Map();
  const blockers = [];
  const sourceRows = [];

  for (const surface of surfaces) {
    const id = String(surface?.id ?? '');
    if (!id) {
      violations.push('surface row missing id');
      continue;
    }
    if (rowsById.has(id)) {
      violations.push(`duplicate surface row ${id}`);
    }
    rowsById.set(id, surface);

    const status = String(surface?.replacement_status ?? '');
    const evidenceClass = String(surface?.evidence_class ?? '');
    const sourceRoots = Array.isArray(surface?.current_source_roots) ? surface.current_source_roots.map(String) : [];
    const vnextTargets = Array.isArray(surface?.vnext_targets) ? surface.vnext_targets.map(String) : [];
    const gates = Array.isArray(surface?.verification_gates) ? surface.verification_gates.map(String) : [];
    const blocker = surface?.acceptance_blocker === true;

    if (!VALID_REPLACEMENT_STATUSES.has(status)) {
      violations.push(`surface ${id} has invalid replacement_status ${status}`);
    }
    if (!VALID_EVIDENCE_CLASSES.has(evidenceClass)) {
      violations.push(`surface ${id} has invalid evidence_class ${evidenceClass}`);
    }
    if (vnextTargets.length === 0) {
      violations.push(`surface ${id} must list vnext_targets`);
    }
    if (!String(surface?.required_binding ?? '').trim()) {
      violations.push(`surface ${id} must record required_binding`);
    }
    if (gates.length === 0) {
      violations.push(`surface ${id} must list verification_gates`);
    }
    if (blocker) {
      blockers.push(id);
      if (!String(surface?.blocker_reason ?? '').trim()) {
        violations.push(`surface ${id} acceptance_blocker=true must record blocker_reason`);
      }
    }
    if ((status === 'pending' || status === 'owner-decision' || status === 'deferred') && !blocker) {
      violations.push(`surface ${id} status ${status} must be an acceptance blocker`);
    }
    if (status === 'hardcut' && !String(surface?.hardcut_reason ?? '').trim()) {
      violations.push(`surface ${id} hardcut must record hardcut_reason`);
    }
    if (evidenceClass === 'proof-only' && status === 'implemented' && blocker) {
      violations.push(`surface ${id} proof-only evidence must not be an acceptance blocker row`);
    }
    for (const sourceRoot of sourceRoots) {
      if (!existsRelative(sourceRoot)) {
        violations.push(`surface ${id} current_source_root missing: ${sourceRoot}`);
      }
      sourceRows.push({ id, sourceRoot });
    }
  }

  for (const requiredRow of REQUIRED_VISIBLE_ROWS) {
    if (!rowsById.has(requiredRow)) {
      violations.push(`ledger must keep visible Replacement coverage row: ${requiredRow}`);
    }
  }

  const unassigned = [];
  const multiplyAssigned = [];
  for (const file of baselineFiles) {
    const assigned = sourceRows.filter((row) => sourceRootMatches(row.sourceRoot, file)).map((row) => row.id);
    if (assigned.length === 0) {
      unassigned.push(file);
    } else if (assigned.length > 1) {
      multiplyAssigned.push(`${file} => ${assigned.join(', ')}`);
    }
  }
  if (unassigned.length > 0) {
    violations.push(`archived baseline SDK source files are not assigned to Replacement coverage ledger rows:\n  ${unassigned.join('\n  ')}`);
  }
  if (multiplyAssigned.length > 0) {
    violations.push(`archived baseline SDK source files are assigned to multiple Replacement coverage ledger rows:\n  ${multiplyAssigned.join('\n  ')}`);
  }

  if (acceptanceMode && blockers.length > 0) {
    violations.push(`Replacement coverage acceptance is blocked: blockers=${blockers.join(', ')}`);
  }
  if (!acceptanceMode && blockers.length > 0) {
    warnings.push(`Replacement coverage acceptance remains blocked by: ${blockers.join(', ')}`);
  }

  return {
    violations,
    warnings,
    assignedFiles: baselineFiles.length - unassigned.length,
    baselineFiles: baselineFiles.length,
    vnextFiles: vnextFiles.length,
    blockers,
  };
}

function validateInventory() {
  const violations = [];
  const warnings = [];
  if (!existsSync(inventoryPath)) {
    throw new Error(`missing inventory: ${relative(inventoryPath)}`);
  }
  const inventory = readYaml(inventoryPath);
  const vnextPackage = readJson(vnextPackagePath);
  const workspaceRaw = readFileSync(workspacePath, 'utf8');
  const workspaceIncludesVNextPackage =
    workspaceRaw.includes("  - 'sdks/typescript'") || workspaceRaw.includes('  - "sdks/typescript"');
  const activeWorkspaceHardcut =
    workspaceIncludesVNextPackage && vnextPackage.nimi?.workspaceCutover === 'active-local-hardcut';
  if (inventory?.catalog_id !== 'sdks_typescript_app_adaptation_inventory') {
    violations.push('inventory must use catalog_id sdks_typescript_app_adaptation_inventory');
  }
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const entriesById = new Map();
  for (const entry of entries) {
    const id = String(entry?.id ?? '');
    if (!id) {
      violations.push('inventory entry missing id');
      continue;
    }
    if (entriesById.has(id)) {
      violations.push(`duplicate inventory entry ${id}`);
    }
    entriesById.set(id, entry);
    const status = String(entry?.adaptation_status ?? '');
    if (!VALID_ADAPTATION_STATUSES.has(status)) {
      violations.push(`inventory ${id} has invalid adaptation_status ${status}`);
    }
    if (!String(entry?.source_root ?? '').trim()) {
      violations.push(`inventory ${id} must record source_root`);
    } else if (!existsRelative(String(entry.source_root))) {
      violations.push(`inventory ${id} source_root missing: ${String(entry.source_root)}`);
    }
    if (!Array.isArray(entry?.required_flow_inventory) || entry.required_flow_inventory.length === 0) {
      violations.push(`inventory ${id} must list required_flow_inventory`);
    }
    const blocker = entry?.acceptance_blocker === true;
    if ((status === 'pending' || status === 'blocked') && !blocker) {
      violations.push(`inventory ${id} status ${status} must be an acceptance blocker`);
    }
    if (status === 'implemented' && blocker) {
      violations.push(`inventory ${id} implemented entry must not remain an acceptance blocker`);
    }
  }
  for (const id of REQUIRED_INVENTORY_IDS) {
    const entry = entriesById.get(id);
    if (!entry) {
      violations.push(`inventory missing required entry ${id}`);
      continue;
    }
  }

  const { total: liveTotal } = countSdkImports();

  const blockerIds = entries
    .filter((entry) => entry?.acceptance_blocker === true)
    .map((entry) => String(entry.id));
  if (blockerIds.length > 0 && !acceptanceMode) {
    warnings.push(`App adaptation remains blocked by: ${blockerIds.join(', ')}`);
  }
  if (acceptanceMode && blockerIds.length > 0) {
    violations.push(`App adaptation acceptance is blocked by: ${blockerIds.join(', ')}`);
  }

  return { violations, warnings, blockerIds, liveTotal, activeWorkspaceHardcut };
}

function main() {
  const ledger = validateLedger();
  const inventory = validateInventory();
  const violations = [...ledger.violations, ...inventory.violations];
  const warnings = [...ledger.warnings, ...inventory.warnings];

  for (const warning of warnings) {
    process.stdout.write(`[check-sdk-vnext-replacement-ledger] ${warning}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write('SDK vNext replacement coverage ledger check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `SDK vNext replacement coverage ledger check passed ` +
      `(assigned_baseline_files=${ledger.assignedFiles}/${ledger.baselineFiles}, ` +
      `vnext_handwritten_files=${ledger.vnextFiles}, ` +
      `replacement_blockers=${ledger.blockers.length}, ` +
      `live_app_import_refs=${inventory.liveTotal}, ` +
      `active_workspace_hardcut=${inventory.activeWorkspaceHardcut ? 'yes' : 'no'}, ` +
      `app_blockers=${inventory.blockerIds.length})\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-replacement-ledger failed: ${message}\n`);
  process.exitCode = 1;
}
