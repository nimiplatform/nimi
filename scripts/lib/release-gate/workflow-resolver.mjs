// Workflow yml resolver — walk .github/workflows/*.yml and verify every
// `run: pnpm <script>` reference resolves to a defined package.json
// `scripts.*` entry in the root or a workspace package.
//
// Owner: scripts (W4 deliverable for topic
// 2026-05-10-release-preflight-gate-authority-hardcut).
// Authority: P-RELG-011 (registry consumers must resolve), enforced
// at the workflow surface so dead step references cannot accumulate.
//
// Determinism: file system walk in sorted order; no network; no env
// reads beyond cwd. Offline-safe.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const WORKFLOWS_REL_DIR = path.join('.github', 'workflows');

// pnpm verbs that are built-in commands, not script names. When the
// first non-flag token after `pnpm` is one of these, the line does not
// reference a user script and is skipped.
const PNPM_BUILTIN_VERBS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'uninstall',
  'update',
  'up',
  'outdated',
  'audit',
  'exec',
  'dlx',
  'create',
  'init',
  'pack',
  'publish',
  'list',
  'ls',
  'why',
  'store',
  'patch',
  'patch-commit',
  'rebuild',
  'rb',
  'fetch',
  'import',
  'link',
  'unlink',
  'prune',
  'deploy',
  'licenses',
  'env',
  'setup',
  'config',
  'recursive',
  'help',
  'root',
  'bin',
  'doctor',
  'why-pkg',
]);

/**
 * Discover workflow yaml files under .github/workflows/.
 * Returns absolute paths sorted alphabetically for deterministic walks.
 */
export function findWorkflowFiles(rootDir) {
  const dir = path.resolve(rootDir, WORKFLOWS_REL_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) continue;
    files.push(path.join(dir, entry.name));
  }
  files.sort();
  return files;
}

/**
 * Best-effort shell-token parser for a `run:` line tail. Supports
 * single quotes and double quotes; does NOT expand shell variables or
 * subshells (resolution operates on the static script name only). If
 * parsing encounters something it cannot tokenize cleanly, it returns
 * null and the line is treated as not-a-pnpm-script-reference.
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === '#') break; // inline comment
    let token = '';
    let quote = null;
    while (i < input.length) {
      const c = input[i];
      if (quote) {
        if (c === quote) {
          quote = null;
          i += 1;
          continue;
        }
        if (c === '\\' && quote === '"' && i + 1 < input.length) {
          token += input[i + 1];
          i += 2;
          continue;
        }
        token += c;
        i += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        i += 1;
        continue;
      }
      if (c === ' ' || c === '\t') break;
      // Stop at shell separators — anything after is a follow-up
      // command, not pnpm argv.
      if (c === '|' || c === '&' || c === ';' || c === '>') {
        i = input.length;
        break;
      }
      token += c;
      i += 1;
    }
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

/**
 * Parse a single `run:` line and return either:
 *   { kind: 'script', script, filterPkg, dirPath, recursive, raw }
 *   { kind: 'builtin', verb }
 *   { kind: 'skip' }   // no pnpm reference, or unparseable
 */
function parsePnpmRunLine(line) {
  // Accept either `run: <cmd>` or `- run: <cmd>` (YAML list item form).
  const m = /^\s*-?\s*run:\s*(.+?)\s*$/.exec(line);
  if (!m) return { kind: 'skip' };
  const tail = m[1];
  // Only pnpm-prefixed lines participate. The line may begin with
  // env-var assignments (e.g. `FOO=1 pnpm bar`); accept that pattern.
  const pnpmAt = tail.match(/(^|\s)pnpm(\s|$)/);
  if (!pnpmAt) return { kind: 'skip' };
  const afterPnpm = tail.slice(pnpmAt.index + pnpmAt[0].length);
  const tokens = tokenize(afterPnpm);
  if (tokens.length === 0) return { kind: 'skip' };

  let i = 0;
  let filterPkg = null;
  let dirPath = null;
  let recursive = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '--filter' || t === '-F') {
      filterPkg = tokens[++i];
      i += 1;
      continue;
    }
    if (t.startsWith('--filter=')) {
      filterPkg = t.slice('--filter='.length);
      i += 1;
      continue;
    }
    if (t === '--dir' || t === '-C') {
      dirPath = tokens[++i];
      i += 1;
      continue;
    }
    if (t.startsWith('--dir=')) {
      dirPath = t.slice('--dir='.length);
      i += 1;
      continue;
    }
    if (t === '--recursive' || t === '-r') {
      recursive = true;
      i += 1;
      continue;
    }
    if (t.startsWith('-')) {
      // Generic flag with optional value; if it looks like `--key=value`
      // we already advanced past it. Otherwise advance one.
      if (t.includes('=')) {
        i += 1;
      } else {
        i += 1;
      }
      continue;
    }
    break;
  }
  if (i >= tokens.length) return { kind: 'skip' };

  let firstToken = tokens[i];
  // Strip an explicit `run` separator: `pnpm --filter X run script-name`
  if (firstToken === 'run' && i + 1 < tokens.length) {
    firstToken = tokens[i + 1];
  }

  if (PNPM_BUILTIN_VERBS.has(firstToken)) {
    return { kind: 'builtin', verb: firstToken };
  }

  return {
    kind: 'script',
    script: firstToken,
    filterPkg,
    dirPath,
    recursive,
  };
}

/**
 * Extract every pnpm script reference from a workflow yaml file.
 * Each reference includes file + 1-based line number.
 */
export function extractPnpmReferences(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const refs = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parsePnpmRunLine(lines[i]);
    if (parsed.kind !== 'script') continue;
    refs.push({
      file: filePath,
      line: i + 1,
      script: parsed.script,
      filterPkg: parsed.filterPkg,
      dirPath: parsed.dirPath,
      recursive: parsed.recursive,
    });
  }
  return refs;
}

/**
 * Build the catalog of resolvable scripts across the workspace.
 *
 * Returns an object:
 *   {
 *     root: Set<string>,                        // root package.json scripts
 *     byPkgName: Map<string, Set<string>>,      // workspace pkg.name → scripts
 *     byPkgDir: Map<string, Set<string>>,       // workspace dir (relative)→ scripts
 *   }
 *
 * Workspace discovery uses pnpm-workspace.yaml `packages:` globs. Glob
 * support is intentionally narrow: we only handle exact paths and a
 * trailing `/*` wildcard, which is what nimi's workspace config uses.
 */
export function loadAvailableScripts(rootDir) {
  const root = new Set();
  const byPkgName = new Map();
  const byPkgDir = new Map();

  // root package.json
  const rootPkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    for (const k of Object.keys(rootPkg.scripts ?? {})) root.add(k);
  }

  // pnpm-workspace.yaml
  const workspaceYaml = path.join(rootDir, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceYaml)) {
    return { root, byPkgName, byPkgDir };
  }
  const workspaceDoc = YAML.parse(fs.readFileSync(workspaceYaml, 'utf8')) ?? {};
  const patterns = Array.isArray(workspaceDoc.packages) ? workspaceDoc.packages : [];

  for (const pat of patterns) {
    const matchedDirs = expandWorkspacePattern(rootDir, pat);
    for (const dir of matchedDirs) {
      const pkgPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      } catch {
        continue; // skip unparseable package.json (not our problem here)
      }
      const scripts = new Set(Object.keys(pkg.scripts ?? {}));
      const relDir = path.relative(rootDir, dir);
      byPkgDir.set(relDir, scripts);
      if (typeof pkg.name === 'string') {
        byPkgName.set(pkg.name, scripts);
      }
    }
  }

  return { root, byPkgName, byPkgDir };
}

function expandWorkspacePattern(rootDir, pattern) {
  // Support: exact path ("kit"), trailing /* ("apps/*"), or trailing /**.
  // Reject anything more elaborate so we fail-loud rather than guess.
  if (pattern.includes('**')) {
    // Treat as recursive but bounded one level (good enough for nimi).
    const head = pattern.replace(/\*\*$/, '').replace(/\/$/, '');
    return walkOneLevel(path.join(rootDir, head));
  }
  if (pattern.endsWith('/*')) {
    const head = pattern.slice(0, -2);
    return walkOneLevel(path.join(rootDir, head));
  }
  const exact = path.join(rootDir, pattern);
  return fs.existsSync(exact) ? [exact] : [];
}

function walkOneLevel(parentDir) {
  if (!fs.existsSync(parentDir)) return [];
  const entries = fs.readdirSync(parentDir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;
    if (e.name === 'node_modules') continue;
    out.push(path.join(parentDir, e.name));
  }
  out.sort();
  return out;
}

/**
 * Resolve each reference against the workspace catalog. Returns the
 * subset of references that did NOT resolve, with a reason code
 * attached.
 */
export function resolveWorkflowReferences(refs, available, rootDir) {
  const unresolved = [];
  for (const ref of refs) {
    const reason = checkReference(ref, available, rootDir);
    if (reason) {
      unresolved.push({ ...ref, reason });
    }
  }
  return unresolved;
}

// A token contains a dynamic expansion when it embeds a GitHub Actions
// expression (`${{ ... }}`) or any shell variable (`$VAR` or `${VAR}`).
// Static resolution cannot evaluate these; the resolver skips them.
function hasDynamicExpansion(s) {
  if (typeof s !== 'string') return false;
  if (s.includes('${{')) return true;
  return /\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/.test(s);
}

function checkReference(ref, available, rootDir) {
  // If the script name itself is dynamic, we cannot resolve it; skip.
  if (hasDynamicExpansion(ref.script)) return null;

  // Recursive runs without a script name target every workspace's
  // scripts.<name>. If at least one workspace defines it, accept.
  if (ref.recursive) {
    for (const scripts of available.byPkgDir.values()) {
      if (scripts.has(ref.script)) return null;
    }
    if (available.root.has(ref.script)) return null;
    return 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED_RECURSIVE';
  }

  if (ref.filterPkg) {
    if (hasDynamicExpansion(ref.filterPkg)) return null;
    const scripts = available.byPkgName.get(ref.filterPkg);
    if (!scripts) return 'WORKFLOW_PNPM_FILTER_PACKAGE_UNKNOWN';
    if (!scripts.has(ref.script)) return 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED';
    return null;
  }

  if (ref.dirPath) {
    // Dynamic expansions cannot be resolved statically; skip.
    if (hasDynamicExpansion(ref.dirPath)) return null;
    const normalized = path.normalize(ref.dirPath).replace(/^\.\//, '');
    const scripts = available.byPkgDir.get(normalized);
    if (!scripts) {
      // Fall back: maybe the dir is a non-workspace package; if a
      // package.json exists there, read it ad-hoc.
      const adHocPath = path.join(rootDir, normalized, 'package.json');
      if (!fs.existsSync(adHocPath)) {
        return 'WORKFLOW_PNPM_DIR_PATH_UNKNOWN';
      }
      try {
        const adHocPkg = JSON.parse(fs.readFileSync(adHocPath, 'utf8'));
        const adHocScripts = new Set(Object.keys(adHocPkg.scripts ?? {}));
        if (!adHocScripts.has(ref.script)) {
          return 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED';
        }
        return null;
      } catch {
        return 'WORKFLOW_PNPM_DIR_PATH_UNKNOWN';
      }
    }
    if (!scripts.has(ref.script)) return 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED';
    return null;
  }

  // No filter, no dir → must be in root package.json
  if (!available.root.has(ref.script)) {
    return 'WORKFLOW_PNPM_REFERENCE_UNRESOLVED';
  }
  return null;
}

/**
 * One-call entry: discover, extract, resolve. Returns
 *   { ok: true, scanned, references } when every reference resolves
 *   { ok: false, scanned, references, unresolved } otherwise
 */
export function checkWorkflowReferences(rootDir = process.cwd()) {
  const files = findWorkflowFiles(rootDir);
  const available = loadAvailableScripts(rootDir);
  const allRefs = [];
  for (const f of files) {
    for (const r of extractPnpmReferences(f)) allRefs.push(r);
  }
  const unresolved = resolveWorkflowReferences(allRefs, available, rootDir);
  if (unresolved.length === 0) {
    return { ok: true, scanned: files.length, references: allRefs };
  }
  return {
    ok: false,
    scanned: files.length,
    references: allRefs,
    unresolved,
  };
}
