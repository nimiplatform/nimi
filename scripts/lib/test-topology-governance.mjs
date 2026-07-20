import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadRegistry } from './release-gate/registry-loader.mjs';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
export const defaultRepoRoot = path.resolve(helperDir, '..', '..');
export const policyRel = '.nimi/spec/platform/kernel/tables/test-governance-policy.yaml';

const WORKSPACE_LANE = 'workspace_regression';
const WORKSPACE_GATE_ID = 'gate.workflow.workspace-regression';
const WORKSPACE_ROOT_COMMAND = 'node scripts/run-workspace-tests.mjs';
const PHASE_STATE_RE = /(?:^|[_-])(legacy|quarantine|candidate|wave|phase|remove-after|remove_after)(?:$|[_-])/iu;
const RUST_TEST_RE = /#\s*\[\s*(?:test|cfg\s*\(\s*test\s*\))\s*\]/u;

export function parseCliArgs(argv) {
  const options = { help: false, report: false, suite: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--report') options.report = true;
    else if (arg === '--suite') {
      options.suite = String(argv[index + 1] || '').trim();
      if (!options.suite || options.suite.startsWith('--')) throw new Error('--suite requires a value');
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function usage() {
  return [
    'Usage: node scripts/check-test-inventory.mjs [--report] [--suite <id>]',
    '',
    'Validates the canonical executable test-suite topology against the current filesystem,',
    'release-gate registry, and stable root pnpm test command.',
  ].join('\n');
}

export function loadTestPolicy(repoRoot = defaultRepoRoot) {
  const filePath = path.join(repoRoot, policyRel);
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

export function checkTestTopology({ repoRoot = defaultRepoRoot, policy = null, registry = null } = {}) {
  const errors = [];
  let resolvedPolicy = policy;
  if (!resolvedPolicy) {
    try {
      resolvedPolicy = loadTestPolicy(repoRoot);
    } catch (error) {
      return failure([`${policyRel} must parse as YAML: ${error.message}`]);
    }
  }
  if (resolvedPolicy?.version !== 2 || !Array.isArray(resolvedPolicy?.suites)) {
    return failure([`${policyRel} must declare executable topology version 2 with suites`]);
  }

  const census = resolvedPolicy.census || {};
  const excludeDirs = new Set(stringList(census.exclude_dirs));
  const excludePaths = new Set(stringList(census.exclude_paths).map(normalizeRel));
  const activeRoots = stringList(census.active_roots);
  const allActiveFiles = discoverActiveFiles(repoRoot, activeRoots, excludeDirs, excludePaths, errors);
  const allActiveSet = new Set(allActiveFiles);
  const conventionalPatterns = stringList(census.include_globs);
  const censusFiles = new Set(
    allActiveFiles.filter((file) => conventionalPatterns.some((pattern) => matchesGlob(file, pattern))),
  );
  for (const file of allActiveFiles) {
    if (file.endsWith('.rs') && RUST_TEST_RE.test(readText(repoRoot, file, errors))) censusFiles.add(file);
  }

  const suiteReports = [];
  const suiteIds = new Set();
  const gateIds = new Set();
  const workspaceOrders = new Set();
  const mappedByFile = new Map();
  const suites = resolvedPolicy.suites;
  for (const suite of suites) {
    const id = String(suite?.id || '').trim();
    if (!id) {
      errors.push('suite row missing id');
      continue;
    }
    if (suiteIds.has(id)) errors.push(`duplicate suite id ${id}`);
    suiteIds.add(id);
    if (PHASE_STATE_RE.test(id) || PHASE_STATE_RE.test(JSON.stringify(suite))) {
      errors.push(`${id}: active_quarantine_or_phase_state`);
    }
    const gateId = String(suite?.gate_id || '').trim();
    if (gateIds.has(gateId)) errors.push(`${id}: duplicate suite gate_id ${gateId}`);
    gateIds.add(gateId);
    if (suite?.lane === WORKSPACE_LANE) {
      const order = Number(suite?.workspace_order);
      if (!Number.isInteger(order) || order <= 0) errors.push(`${id}: invalid workspace_order`);
      else if (workspaceOrders.has(order)) errors.push(`${id}: duplicate workspace_order ${order}`);
      workspaceOrders.add(order);
    }

    const selected = expandSuiteSelectors({
      allActiveFiles,
      allActiveSet,
      errors,
      repoRoot,
      suite,
    });
    for (const file of selected) {
      censusFiles.add(file);
      const owners = mappedByFile.get(file) || [];
      owners.push(id);
      mappedByFile.set(file, owners);
    }
    if (selected.size === 0) errors.push(`${id}: empty_or_missing_suite_selector`);
    suiteReports.push({
      id,
      lane: String(suite?.lane || ''),
      gateId,
      fileCount: selected.size,
      command: String(suite?.command || ''),
    });
  }

  for (const file of [...censusFiles].sort(comparePath)) {
    const owners = mappedByFile.get(file) || [];
    if (owners.length === 0) errors.push(`unmapped_test_source ${file}`);
    else if (owners.length > 1) errors.push(`multiply_mapped_test_source ${file}: ${owners.join(', ')}`);
  }
  for (const file of mappedByFile.keys()) {
    if (!censusFiles.has(file)) errors.push(`suite selector resolved non-test source ${file}`);
  }

  const resolvedRegistry = registry || loadRegistryFrom(repoRoot, errors);
  if (resolvedRegistry) validateGateBindings(resolvedRegistry, suites, errors);
  validateWorkspaceEntrypoint(repoRoot, resolvedRegistry, errors);
  validateWorkspaceSurfaces(suites, errors);

  return {
    ok: errors.length === 0,
    errors,
    totalFiles: censusFiles.size,
    totalSuites: suiteReports.length,
    suiteReports: suiteReports.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function failure(errors) {
  return { ok: false, errors, totalFiles: 0, totalSuites: 0, suiteReports: [] };
}

function loadRegistryFrom(repoRoot, errors) {
  const previousCwd = process.cwd();
  try {
    process.chdir(repoRoot);
    const result = loadRegistry();
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `release registry: ${error}`));
      return null;
    }
    return result.registry;
  } finally {
    process.chdir(previousCwd);
  }
}

function discoverActiveFiles(repoRoot, activeRoots, excludeDirs, excludePaths, errors) {
  const files = [];
  for (const root of activeRoots) {
    const normalizedRoot = normalizeRel(root);
    const absoluteRoot = path.join(repoRoot, normalizedRoot);
    if (!fs.existsSync(absoluteRoot)) {
      errors.push(`census active root missing: ${normalizedRoot}`);
      continue;
    }
    walk(absoluteRoot, normalizedRoot);
  }
  return [...new Set(files)].sort(comparePath);

  function walk(absoluteDir, relativeDir) {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relative = normalizeRel(path.posix.join(relativeDir.replaceAll('\\', '/'), entry.name));
      if ([...excludePaths].some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`))) continue;
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        walk(path.join(absoluteDir, entry.name), relative);
      } else if (entry.isFile()) files.push(relative);
    }
  }
}

function expandSuiteSelectors({ allActiveFiles, allActiveSet, errors, repoRoot, suite }) {
  const id = String(suite?.id || '<unknown>');
  const selected = new Set();
  const selectors = suite?.selectors || {};
  for (const pattern of stringList(selectors.globs)) {
    const matches = allActiveFiles.filter((file) => matchesGlob(file, pattern));
    if (matches.length === 0) errors.push(`${id}: selector glob matched zero files: ${pattern}`);
    for (const file of matches) selected.add(file);
  }
  for (const relative of stringList(selectors.files)) {
    const file = normalizeRel(relative);
    if (!allActiveSet.has(file)) errors.push(`${id}: selector file missing or outside active roots: ${file}`);
    else selected.add(file);
  }
  for (const pattern of stringList(selectors.rust_inline_globs)) {
    const matches = allActiveFiles.filter((file) => (
      file.endsWith('.rs')
      && matchesGlob(file, pattern)
      && RUST_TEST_RE.test(readText(repoRoot, file, errors))
    ));
    if (matches.length === 0) errors.push(`${id}: Rust selector matched zero inline-test files: ${pattern}`);
    for (const file of matches) selected.add(file);
  }
  return selected;
}

function validateGateBindings(registry, suites, errors) {
  const byId = new Map((Array.isArray(registry?.gates) ? registry.gates : []).map((gate) => [gate.id, gate]));
  for (const suite of suites) {
    const id = String(suite?.id || '<unknown>');
    const gate = byId.get(suite?.gate_id);
    if (!gate) {
      errors.push(`${id}: unresolved_suite_command_or_gate ${String(suite?.gate_id || '<missing>')}`);
      continue;
    }
    if (gate.command !== suite.command) errors.push(`${id}: suite command differs from ${gate.id}`);
    if (String(gate.cwd || '.') !== String(suite.cwd || '.')) errors.push(`${id}: suite cwd differs from ${gate.id}`);
    if (suite.lane === 'live_provider') {
      if (!gate.tiers?.includes('live')) errors.push(`${id}: live suite gate must include live tier`);
    } else if (!gate.tiers?.includes('release')) {
      errors.push(`${id}: non-live suite gate must include release tier`);
    }
  }
}

function validateWorkspaceEntrypoint(repoRoot, registry, errors) {
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch (error) {
    errors.push(`package.json must parse: ${error.message}`);
    return;
  }
  if (packageJson?.scripts?.test !== WORKSPACE_ROOT_COMMAND) {
    errors.push(`workspace_regression_not_reachable: package.json scripts.test must equal ${WORKSPACE_ROOT_COMMAND}`);
  }
  const gate = registry?.gates?.find((row) => row.id === WORKSPACE_GATE_ID);
  if (!gate) errors.push(`workspace_regression_not_reachable: missing ${WORKSPACE_GATE_ID}`);
  else {
    if (gate.command !== 'pnpm test') errors.push(`${WORKSPACE_GATE_ID} command must be pnpm test`);
    if (!gate.tiers?.includes('regression')) errors.push(`${WORKSPACE_GATE_ID} must include regression tier`);
  }
}

function validateWorkspaceSurfaces(suites, errors) {
  const workspaceSuites = suites.filter((suite) => suite?.lane === WORKSPACE_LANE);
  const providers = new Map();
  for (const suite of workspaceSuites) {
    for (const surface of stringList(suite?.provides_workspace_surfaces)) {
      if (providers.has(surface)) errors.push(`workspace surface ${surface} has multiple providers`);
      providers.set(surface, suite.id);
    }
  }
  for (const surface of ['sdk_dist', 'kit_dist']) {
    if (!providers.has(surface)) errors.push(`workspace surface ${surface} has no provider suite`);
  }
  for (const suite of workspaceSuites) {
    for (const surface of stringList(suite?.requires_workspace_surfaces)) {
      if (!providers.has(surface)) errors.push(`${suite.id}: required workspace surface ${surface} has no provider`);
      const provider = workspaceSuites.find((row) => row.id === providers.get(surface));
      if (provider && Number(provider.workspace_order) >= Number(suite.workspace_order)) {
        errors.push(`${suite.id}: workspace surface ${surface} provider must run earlier`);
      }
    }
  }
}

function readText(repoRoot, relative, errors) {
  try {
    return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  } catch (error) {
    errors.push(`failed to read ${relative}: ${error.message}`);
    return '';
  }
}

function stringList(value) {
  return (Array.isArray(value) ? value : []).map((entry) => String(entry || '').trim()).filter(Boolean);
}

function normalizeRel(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
}

function comparePath(left, right) {
  return left.localeCompare(right);
}

export function matchesGlob(relativePath, pattern) {
  const input = normalizeRel(relativePath);
  const normalizedPattern = normalizeRel(pattern);
  let source = '^';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    if (char === '*' && normalizedPattern[index + 1] === '*') {
      index += 1;
      if (normalizedPattern[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  source += '$';
  return new RegExp(source, 'u').test(input);
}

export function renderTopologyReport(result, suiteFilter = '') {
  const rows = result.suiteReports.filter((row) => !suiteFilter || row.id === suiteFilter);
  if (suiteFilter && rows.length === 0) return `unknown suite: ${suiteFilter}`;
  return [
    `test topology: ${result.totalSuites} suites / ${result.totalFiles} test-bearing sources`,
    ...rows.map((row) => `${row.id}\t${row.lane}\t${row.fileCount}\t${row.gateId}\t${row.command}`),
  ].join('\n');
}

export const _internal = { RUST_TEST_RE, WORKSPACE_GATE_ID, WORKSPACE_ROOT_COMMAND };
