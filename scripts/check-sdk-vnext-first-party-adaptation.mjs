#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const inventoryPath = path.join(
  repoRoot,
  'config',
  'sdk-vnext-migration',
  'typescript-app-adaptation-inventory.yaml',
);
const vnextPackagePath = path.join(repoRoot, 'sdks', 'typescript', 'package.json');
const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
const FIRST_PARTY_TSCONFIG_ROOTS = ['apps', 'kit', 'examples'];

const VALID_RULE_DECISIONS = new Set(['retain-redesign', 'retain-direct', 'hardcut', 'owner-decision']);
const VALID_ENTRY_STATUSES = new Set(['implemented', 'pending', 'blocked']);
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
const IMPORT_PATTERN = /(?:from\s+['"]|import\(['"]|require\(['"])(@nimiplatform\/sdk(?:\/[A-Za-z0-9_.\/-]+)?)/gu;

function readYaml(filePath) {
  return YAML.parse(readFileSync(filePath, 'utf8'));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function existsRelative(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
}

function walkFiles(root, output = []) {
  const absoluteRoot = path.join(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return output;
  }
  for (const entry of readdirSync(absoluteRoot)) {
    if (SKIP_DIRS.has(entry)) continue;
    const absolutePath = path.join(absoluteRoot, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walkFiles(relative(absolutePath), output);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(absolutePath))) {
      output.push(relative(absolutePath));
    }
  }
  return output;
}

function walkTsconfigFiles(root, output = []) {
  const absoluteRoot = path.join(repoRoot, root);
  if (!existsSync(absoluteRoot)) {
    return output;
  }
  for (const entry of readdirSync(absoluteRoot)) {
    if (SKIP_DIRS.has(entry)) continue;
    const absolutePath = path.join(absoluteRoot, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walkTsconfigFiles(relative(absolutePath), output);
      continue;
    }
    if (/^tsconfig(?:\.[^.]+)?\.json$/u.test(entry)) {
      output.push(relative(absolutePath));
    }
  }
  return output;
}

function isCurrentSdkAliasTarget(target) {
  const normalized = String(target).replaceAll('\\', '/');
  return normalized.startsWith('../sdk/')
    || normalized.startsWith('../../sdk/')
    || normalized.includes('/sdk/src/')
    || normalized.includes('/sdk/dist/')
    || normalized.includes('/sdk/src')
    || normalized.includes('/sdk/dist');
}

function validateNoCurrentSdkTsconfigAliases(activeWorkspaceHardcut, violations) {
  if (!activeWorkspaceHardcut) {
    return;
  }
  const tsconfigs = FIRST_PARTY_TSCONFIG_ROOTS.flatMap((root) => walkTsconfigFiles(root));
  for (const tsconfig of tsconfigs) {
    const json = readJson(path.join(repoRoot, tsconfig));
    const paths = json?.compilerOptions?.paths;
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
      continue;
    }
    for (const [alias, targets] of Object.entries(paths)) {
      if (!alias.startsWith('@nimiplatform/sdk')) {
        continue;
      }
      const targetList = Array.isArray(targets) ? targets : [targets];
      for (const target of targetList) {
        if (isCurrentSdkAliasTarget(target)) {
          violations.push(
            `${tsconfig} maps ${alias} to current sdk baseline target ${String(target)} during active workspace hardcut`,
          );
        }
      }
    }
  }
}

function scanSdkImports(sourceRoot) {
  const counts = new Map();
  let total = 0;
  for (const file of walkFiles(sourceRoot)) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      counts.set(specifier, (counts.get(specifier) ?? 0) + 1);
      total += 1;
    }
  }
  return { counts, total };
}

function assertSameStringList(label, expected, actual, violations) {
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  if (JSON.stringify(expectedSorted) !== JSON.stringify(actualSorted)) {
    violations.push(`${label} mismatch: expected ${expectedSorted.join(', ')}, got ${actualSorted.join(', ')}`);
  }
}

function sdkTargetExportKey(target) {
  if (target === '@nimiplatform/sdk') return '.';
  const prefix = '@nimiplatform/sdk/';
  if (!target.startsWith(prefix)) return null;
  return `./${target.slice(prefix.length)}`;
}

function isKnownSdkSubpath(subpath, rulesBySubpath, vnextExports) {
  if (rulesBySubpath.has(subpath)) return true;
  const exportKey = sdkTargetExportKey(subpath);
  return exportKey !== null && vnextExports.has(exportKey);
}

function validateRule(rule, vnextExports, violations) {
  const currentSubpath = String(rule?.current_subpath ?? '');
  const decision = String(rule?.decision ?? '');
  const targets = Array.isArray(rule?.vnext_targets) ? rule.vnext_targets.map(String) : [];
  if (!currentSubpath) {
    violations.push('subpath migration rule missing current_subpath');
    return;
  }
  if (!VALID_RULE_DECISIONS.has(decision)) {
    violations.push(`subpath migration rule ${currentSubpath} has invalid decision ${decision}`);
  }
  if (targets.length === 0) {
    violations.push(`subpath migration rule ${currentSubpath} must list vnext_targets`);
  }
  if (!String(rule?.reason ?? '').trim()) {
    violations.push(`subpath migration rule ${currentSubpath} must record reason`);
  }
  if (decision === 'hardcut' && !String(rule?.hardcut_reason ?? '').trim()) {
    violations.push(`subpath migration rule ${currentSubpath} hardcut must record hardcut_reason`);
  }
  if (decision === 'owner-decision' && !String(rule?.owner_decision ?? '').trim()) {
    violations.push(`subpath migration rule ${currentSubpath} owner-decision must record owner_decision`);
  }
  for (const target of targets) {
    const exportKey = sdkTargetExportKey(target);
    if (exportKey) {
      if (!vnextExports.has(exportKey)) {
        violations.push(`subpath migration rule ${currentSubpath} targets missing package export ${target}`);
      }
      continue;
    }
    if (target.startsWith('sdks/typescript/') && !existsRelative(target)) {
      violations.push(`subpath migration rule ${currentSubpath} targets missing source root ${target}`);
    }
  }
}

function validateEntry(entry, rulesBySubpath, vnextExports, activeWorkspaceHardcut, violations, warnings) {
  const id = String(entry?.id ?? '');
  const sourceRoot = String(entry?.source_root ?? '');
  const status = String(entry?.adaptation_status ?? '');
  const blocker = entry?.acceptance_blocker === true;
  if (!id) {
    violations.push('inventory entry missing id');
    return { id: '', liveTotal: 0, blocker };
  }
  if (!sourceRoot || !existsRelative(sourceRoot)) {
    violations.push(`inventory ${id} source_root missing: ${sourceRoot}`);
    return { id, liveTotal: 0, blocker };
  }
  if (!VALID_ENTRY_STATUSES.has(status)) {
    violations.push(`inventory ${id} has invalid adaptation_status ${status}`);
  }
  if ((status === 'pending' || status === 'blocked') && !blocker) {
    violations.push(`inventory ${id} status ${status} must remain an acceptance blocker`);
  }
  if (status === 'implemented' && blocker) {
    violations.push(`inventory ${id} is implemented but still marked acceptance_blocker=true`);
  }

  const scanned = scanSdkImports(sourceRoot);

  const currentSubpaths = Array.isArray(entry?.current_subpaths) ? entry.current_subpaths.map(String) : [];
  if (!activeWorkspaceHardcut) {
    assertSameStringList(`inventory ${id} current_subpaths`, currentSubpaths, [...scanned.counts.keys()], violations);
  }

  for (const subpath of scanned.counts.keys()) {
    if (!isKnownSdkSubpath(subpath, rulesBySubpath, vnextExports)) {
      violations.push(`inventory ${id} subpath ${subpath} is neither a recorded current subpath nor an implemented vNext export`);
    }
    const rule = rulesBySubpath.get(subpath);
    if (status === 'implemented' && rule?.decision === 'hardcut') {
      violations.push(`inventory ${id} is implemented but still imports hardcut subpath ${subpath}`);
    }
  }

  const blockers = Array.isArray(entry?.pending_blockers) ? entry.pending_blockers.map(String) : [];
  const usesOwnerDecisionSubpath = [...scanned.counts.keys()].some((subpath) => rulesBySubpath.get(subpath)?.decision === 'owner-decision');
  if (usesOwnerDecisionSubpath && !blockers.includes('root-platform-composition')) {
    violations.push(`inventory ${id} imports owner-decision root surface but does not list root-platform-composition pending_blocker`);
  }
  if (blocker && blockers.length === 0) {
    violations.push(`inventory ${id} acceptance_blocker=true must list pending_blockers`);
  }
  if (blocker) {
    warnings.push(`${id} adaptation remains blocked by: ${blockers.join(', ')}`);
  }
  return { id, liveTotal: scanned.total, blocker };
}

function main() {
  const violations = [];
  const warnings = [];
  if (!existsSync(inventoryPath)) {
    throw new Error(`missing inventory: ${relative(inventoryPath)}`);
  }
  const inventory = readYaml(inventoryPath);
  const vnextPackage = readJson(vnextPackagePath);
  const workspaceRaw = readFileSync(workspacePath, 'utf8');
  const vnextExports = new Set(Object.keys(vnextPackage.exports ?? {}));
  const workspaceIncludesVNextPackage =
    workspaceRaw.includes("  - 'sdks/typescript'") || workspaceRaw.includes('  - "sdks/typescript"');
  const activeWorkspaceHardcut =
    workspaceIncludesVNextPackage && vnextPackage.nimi?.workspaceCutover === 'active-local-hardcut';
  validateNoCurrentSdkTsconfigAliases(activeWorkspaceHardcut, violations);

  if (inventory?.catalog_id !== 'sdks_typescript_app_adaptation_inventory') {
    violations.push('inventory must use catalog_id sdks_typescript_app_adaptation_inventory');
  }
  if (inventory?.scope?.first_party_adaptation_gate !== 'check:sdk-vnext-first-party-adaptation') {
    violations.push('inventory scope.first_party_adaptation_gate must be check:sdk-vnext-first-party-adaptation');
  }

  const rules = Array.isArray(inventory?.subpath_migration_rules) ? inventory.subpath_migration_rules : [];
  const rulesBySubpath = new Map();
  for (const rule of rules) {
    const currentSubpath = String(rule?.current_subpath ?? '');
    if (rulesBySubpath.has(currentSubpath)) {
      violations.push(`duplicate subpath migration rule ${currentSubpath}`);
    }
    rulesBySubpath.set(currentSubpath, rule);
    validateRule(rule, vnextExports, violations);
  }

  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const ids = new Set();
  let liveTotal = 0;
  let blockers = 0;
  for (const entry of entries) {
    const id = String(entry?.id ?? '');
    if (ids.has(id)) {
      violations.push(`duplicate inventory entry ${id}`);
    }
    ids.add(id);
    const result = validateEntry(entry, rulesBySubpath, vnextExports, activeWorkspaceHardcut, violations, warnings);
    liveTotal += result.liveTotal;
    if (result.blocker) blockers += 1;
  }

  for (const warning of warnings) {
    process.stdout.write(`[check-sdk-vnext-first-party-adaptation] ${warning}\n`);
  }
  if (violations.length > 0) {
    process.stderr.write('SDK vNext first-party adaptation check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `SDK vNext first-party adaptation check passed ` +
      `(entries=${entries.length}, live_import_refs=${liveTotal}, migration_rules=${rules.length}, ` +
      `active_workspace_hardcut=${activeWorkspaceHardcut ? 'yes' : 'no'}, blockers=${blockers})\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-first-party-adaptation failed: ${message}\n`);
  process.exitCode = 1;
}
