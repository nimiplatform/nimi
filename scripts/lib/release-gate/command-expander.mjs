import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

const PNPM_BUILTINS = new Set([
  'add', 'audit', 'config', 'create', 'deploy', 'dlx', 'env', 'exec', 'fetch',
  'help', 'i', 'import', 'init', 'install', 'link', 'list', 'ls', 'outdated',
  'pack', 'patch', 'patch-commit', 'prune', 'publish', 'rb', 'rebuild', 'recursive',
  'remove', 'rm', 'root', 'setup', 'store', 'unlink', 'uninstall', 'up', 'update',
  'why',
]);

export function normalizeCommand(command) {
  return String(command || '').replace(/\\\r?\n/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export function splitShellCommands(body) {
  return String(body || '')
    .replace(/\\\r?\n/gu, ' ')
    .split(/(?:\r?\n|&&)/gu)
    .map(normalizeCommand)
    .filter(Boolean);
}

export function loadPackageScriptCatalog(rootDir) {
  const root = path.resolve(rootDir);
  const rootPackage = readPackage(path.join(root, 'package.json'), '.');
  const byName = new Map();
  const byDir = new Map();

  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  const workspace = fs.existsSync(workspacePath)
    ? YAML.parse(fs.readFileSync(workspacePath, 'utf8')) ?? {}
    : {};
  for (const pattern of Array.isArray(workspace.packages) ? workspace.packages : []) {
    for (const directory of expandWorkspacePattern(root, String(pattern))) {
      const relativeDir = path.relative(root, directory).replaceAll(path.sep, '/');
      const entry = readPackage(path.join(directory, 'package.json'), relativeDir);
      if (!entry) continue;
      byDir.set(relativeDir, entry);
      if (entry.name) byName.set(entry.name, entry);
    }
  }
  return { rootDir: root, root: rootPackage, byName, byDir };
}

export function expandCommandLeaves(command, catalog, options = {}) {
  const cwd = normalizeCwd(options.cwd ?? '.');
  const context = cwd === '.' ? catalog.root : catalog.byDir.get(cwd) ?? { dir: cwd, scripts: {} };
  return expand(command, catalog, context, new Set());
}

export function findDuplicateRegisteredLeaves(document, registry, catalog) {
  const registeredLeaves = new Set();
  for (const gate of registry.gates ?? []) {
    for (const leaf of expandCommandLeaves(gate.command, catalog, { cwd: gate.cwd ?? '.' })) {
      registeredLeaves.add(leaf.key);
    }
  }

  const duplicates = [];
  for (const [jobId, job] of Object.entries(document?.jobs ?? {})) {
    const observed = new Map();
    for (const [stepIndex, step] of (job?.steps ?? []).entries()) {
      if (typeof step?.run !== 'string') continue;
      const cwd = step['working-directory'] ?? job?.defaults?.run?.['working-directory'] ?? '.';
      for (const segment of splitShellCommands(step.run)) {
        for (const leaf of expandCommandLeaves(segment, catalog, { cwd })) {
          if (!registeredLeaves.has(leaf.key)) continue;
          const locations = observed.get(leaf.key) ?? { leaf, steps: [] };
          locations.steps.push(stepIndex + 1);
          observed.set(leaf.key, locations);
        }
      }
    }
    for (const { leaf, steps } of observed.values()) {
      if (steps.length > 1) duplicates.push({ jobId, leaf, steps });
    }
  }
  return duplicates;
}

export function findDuplicateGateLeavesByTier(registry, catalog) {
  const leavesByTier = new Map();
  for (const gate of registry.gates ?? []) {
    const leaves = new Map(
      expandCommandLeaves(gate.command, catalog, { cwd: gate.cwd ?? '.' })
        .map((expanded) => [expanded.key, expanded]),
    );
    for (const tier of gate.tiers ?? []) {
      const observed = leavesByTier.get(tier) ?? new Map();
      for (const expanded of leaves.values()) {
        const occurrence = observed.get(expanded.key) ?? { leaf: expanded, gateIds: [] };
        occurrence.gateIds.push(gate.id);
        observed.set(expanded.key, occurrence);
      }
      leavesByTier.set(tier, observed);
    }
  }

  return [...leavesByTier.entries()]
    .flatMap(([tier, observed]) => [...observed.values()]
      .filter(({ gateIds }) => gateIds.length > 1)
      .map(({ leaf: expanded, gateIds }) => ({ tier, leaf: expanded, gateIds })))
    .sort((left, right) => (
      left.tier.localeCompare(right.tier)
      || left.leaf.key.localeCompare(right.leaf.key)
    ));
}

export function findUnlockedCargoGateLeaves(registry, catalog) {
  const unlocked = [];
  const lockRequiredSubcommands = new Set(['build', 'check', 'clippy', 'test']);
  for (const gate of registry.gates ?? []) {
    for (const expanded of expandCommandLeaves(gate.command, catalog, { cwd: gate.cwd ?? '.' })) {
      const tokens = shellTokens(expanded.command);
      if (tokens[0] !== 'cargo' || !lockRequiredSubcommands.has(tokens[1]) || tokens.includes('--locked')) {
        continue;
      }
      unlocked.push({ gateId: gate.id, leaf: expanded });
    }
  }
  return unlocked.sort((left, right) => (
    left.gateId.localeCompare(right.gateId)
    || left.leaf.key.localeCompare(right.leaf.key)
  ));
}

function expand(command, catalog, context, visiting) {
  const normalized = normalizeCommand(command);
  const invocation = parsePnpmScriptInvocation(normalized);
  if (!invocation) return [leaf(context.dir, normalized)];

  const target = resolveTarget(invocation, catalog, context);
  const body = target?.scripts?.[invocation.script];
  if (typeof body !== 'string') return [leaf(context.dir, normalized)];

  const visitKey = `${target.dir}:${invocation.script}`;
  if (visiting.has(visitKey)) {
    throw new Error(`package script cycle while expanding ${visitKey}`);
  }
  const nextVisiting = new Set(visiting);
  nextVisiting.add(visitKey);
  return splitShellCommands(body).flatMap((segment) => (
    expand(segment, catalog, target, nextVisiting)
  ));
}

function parsePnpmScriptInvocation(command) {
  const tokens = shellTokens(command);
  const pnpmIndex = tokens.indexOf('pnpm');
  if (pnpmIndex < 0 || tokens.slice(0, pnpmIndex).some((token) => !/^[A-Za-z_][A-Za-z0-9_]*=.*/u.test(token))) {
    return null;
  }

  let index = pnpmIndex + 1;
  let filterPkg;
  let dirPath;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '--filter' || token === '-F') {
      filterPkg = tokens[index + 1];
      index += 2;
      continue;
    }
    if (token.startsWith('--filter=')) {
      filterPkg = token.slice('--filter='.length);
      index += 1;
      continue;
    }
    if (token === '--dir' || token === '-C') {
      dirPath = tokens[index + 1];
      index += 2;
      continue;
    }
    if (token.startsWith('--dir=')) {
      dirPath = token.slice('--dir='.length);
      index += 1;
      continue;
    }
    if (token.startsWith('-')) return null;
    break;
  }
  if (tokens[index] === 'run') index += 1;
  const script = tokens[index];
  if (!script || PNPM_BUILTINS.has(script) || tokens.length !== index + 1) return null;
  return { script, filterPkg, dirPath };
}

function resolveTarget(invocation, catalog, context) {
  if (invocation.filterPkg) return catalog.byName.get(invocation.filterPkg);
  if (invocation.dirPath && !invocation.dirPath.includes('$')) {
    return catalog.byDir.get(normalizeCwd(invocation.dirPath));
  }
  return context;
}

function shellTokens(command) {
  const matches = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) ?? [];
  return matches.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function leaf(cwd, command) {
  const normalizedCwd = normalizeCwd(cwd);
  return {
    cwd: normalizedCwd,
    command,
    key: `${normalizedCwd}\u0000${command}`,
  };
}

function normalizeCwd(cwd) {
  const normalized = path.normalize(String(cwd || '.')).replaceAll(path.sep, '/');
  return normalized === '' ? '.' : normalized.replace(/^\.\//u, '');
}

function readPackage(packagePath, dir) {
  if (!fs.existsSync(packagePath)) return null;
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return {
    dir,
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    scripts: pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {},
  };
}

function expandWorkspacePattern(root, pattern) {
  if (pattern.endsWith('/*')) {
    const parent = path.join(root, pattern.slice(0, -2));
    if (!fs.existsSync(parent)) return [];
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(parent, entry.name))
      .sort();
  }
  const exact = path.join(root, pattern);
  return fs.existsSync(exact) ? [exact] : [];
}
