#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function fail(message) {
  throw new Error(`Realm v3 protected sentinel failed: ${message}`);
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const index = argv.indexOf('--manifest');
  const relative = index >= 0 ? String(argv[index + 1] || '').trim() : 'config/realm-v3/protected-sentinel.json';
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    fail('manifest must be a repository-relative path');
  }
  return { manifestPath: path.join(repoRoot, relative) };
}

function assertNoDiff(baseline, target) {
  const result = spawnSync('git', ['diff', '--quiet', baseline, '--', target], { cwd: repoRoot });
  if (result.status !== 0) fail(`protected path changed from baseline: ${target}`);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', target);
  if (untracked) fail(`protected path contains untracked files: ${target}: ${untracked}`);
  return {
    path: target,
    baselineObject: git('rev-parse', `${baseline}:${target}`),
    currentHeadObject: git('rev-parse', `HEAD:${target}`),
  };
}

function worktreeObject(target) {
  return git('hash-object', '--', target);
}

function assertAncestor(ancestor, descendant, label) {
  const relation = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoRoot });
  if (relation.status !== 0) fail(`${label}: ${ancestor} is not an ancestor of ${descendant}`);
}

function assertCommitTree(record, label) {
  const commit = git('rev-parse', `${record.commit}^{commit}`);
  const tree = git('rev-parse', `${record.commit}^{tree}`);
  if (commit !== record.commit || tree !== record.tree) {
    fail(`${label} commit/tree mismatch: commit=${commit} tree=${tree}`);
  }
  return { commit, tree };
}

function resolveImplementationBaseline(manifest, authorityBaseline) {
  const baseline = manifest.implementationBaseline;
  if (!baseline || baseline.schemaVersion !== 'nimi.realm-v3-protected-implementation-baseline/v1') {
    fail('unsupported protected implementation baseline');
  }

  const previous = baseline.previous;
  if (!previous || previous.schemaVersion !== 'nimi.realm-v3-inherited-protected-baseline/v1') {
    fail('missing previous inherited protected baseline');
  }
  const previousIdentity = assertCommitTree(previous, 'previous protected baseline');
  const previousParents = git('show', '-s', '--format=%P', previousIdentity.commit).split(/\s+/u);
  if (previousParents.length !== 2
    || previousParents[0] !== previous.localParent
    || previousParents[1] !== previous.remoteParent) {
    fail(`previous protected baseline merge parents mismatch: ${previousParents.join(' ')}`);
  }

  const admitted = baseline.admitted;
  if (!admitted || admitted.changeClass !== 'ecosystem_third_party_permission_authority_hardcut') {
    fail('implementation baseline has no admitted permission-authority hardcut');
  }
  const admittedIdentity = assertCommitTree(admitted, 'admitted protected baseline');
  const admittedParents = git('show', '-s', '--format=%P', admittedIdentity.commit).split(/\s+/u);
  if (admittedParents.length !== 1 || admittedParents[0] !== admitted.parent) {
    fail(`admitted protected baseline parent mismatch: ${admittedParents.join(' ')}`);
  }
  if (!Array.isArray(admitted.authorityRefs)
    || admitted.authorityRefs.length === 0
    || admitted.authorityRefs.some((value) => typeof value !== 'string' || value.trim() === '')) {
    fail('admitted protected baseline has no authority references');
  }
  if (new Set(admitted.authorityRefs).size !== admitted.authorityRefs.length) {
    fail('admitted protected baseline repeats authority references');
  }

  assertAncestor(authorityBaseline, previousIdentity.commit, 'authority-to-previous baseline lineage');
  assertAncestor(previousIdentity.commit, admittedIdentity.commit, 'previous-to-admitted baseline lineage');
  assertAncestor(admittedIdentity.commit, 'HEAD', 'admitted baseline-to-current lineage');

  const changedPaths = manifest.immutablePaths
    .filter((target) => spawnSync(
      'git',
      ['diff', '--quiet', previousIdentity.commit, admittedIdentity.commit, '--', target],
      { cwd: repoRoot },
    ).status !== 0)
    .sort();
  const declaredChangedPaths = Array.isArray(admitted.protectedChangePaths)
    ? [...admitted.protectedChangePaths].sort()
    : [];
  if (new Set(declaredChangedPaths).size !== declaredChangedPaths.length
    || JSON.stringify(changedPaths) !== JSON.stringify(declaredChangedPaths)) {
    fail(`admitted protected path inventory mismatch: expected=${changedPaths.join(',')} declared=${declaredChangedPaths.join(',')}`);
  }

  return {
    commit: admittedIdentity.commit,
    tree: admittedIdentity.tree,
    previous: {
      commit: previousIdentity.commit,
      tree: previousIdentity.tree,
      localParent: previous.localParent,
      remoteParent: previous.remoteParent,
    },
    admission: {
      changeClass: admitted.changeClass,
      parent: admitted.parent,
      authorityRefs: admitted.authorityRefs,
      protectedChangePaths: declaredChangedPaths,
    },
  };
}

function assertAuthorizedAuthorityMigration(baseline, implementationBaseline, migration) {
  if (!migration || typeof migration !== 'object') fail('authorized authority migration must be an object');
  const target = String(migration.path || '').trim();
  if (!target || path.isAbsolute(target) || target.split(/[\\/]/u).includes('..')) {
    fail('authorized authority migration path must be repository-relative');
  }
  const baselineObject = git('rev-parse', `${baseline}:${target}`);
  if (baselineObject !== migration.baselineObject) {
    fail(`authorized authority baseline object mismatch for ${target}: expected=${migration.baselineObject} actual=${baselineObject}`);
  }
  const admittedObject = git('rev-parse', `${implementationBaseline}:${target}`);
  if (admittedObject !== migration.authorizedObject) {
    fail(`authorized authority object is not bound to the admitted implementation baseline for ${target}: expected=${migration.authorizedObject} actual=${admittedObject}`);
  }
  const currentWorktreeObject = worktreeObject(target);
  if (currentWorktreeObject !== admittedObject) {
    fail(`protected authority changed outside its exact authorized migration: ${target}: expected=${migration.authorizedObject} actual=${currentWorktreeObject}`);
  }
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', target);
  if (untracked) fail(`authorized authority path contains untracked files: ${target}: ${untracked}`);
  if (migration.authorizationState !== 'authority_aligned_and_implemented') {
    fail(`authorized authority migration has invalid authorization state: ${target}`);
  }
  if (!Array.isArray(migration.authorityRefs)
    || migration.authorityRefs.length === 0
    || migration.authorityRefs.some((value) => typeof value !== 'string' || value.trim() === '')) {
    fail(`authorized authority migration has no authority references: ${target}`);
  }
  if (!Array.isArray(migration.requiredUnchangedSemantics) || migration.requiredUnchangedSemantics.length === 0) {
    fail(`authorized authority migration has no preserved semantic inventory: ${target}`);
  }
  return {
    path: target,
    baselineObject,
    authorizedObject: migration.authorizedObject,
    currentWorktreeObject,
    authorizationState: migration.authorizationState,
    authorityRefs: migration.authorityRefs,
    allowedChange: migration.allowedChange,
    requiredUnchangedSemantics: migration.requiredUnchangedSemantics,
  };
}

function normalizeBrokerInventory(source) {
  const pattern = /const expectedOperationIDs = \[[\s\S]*?\n  \];/u;
  const matches = source.match(new RegExp(pattern.source, 'gu')) || [];
  if (matches.length !== 1) fail(`shared broker validator expected one operation inventory, found ${matches.length}`);
  return source.replace(pattern, 'const expectedOperationIDs = [\n    /* realm-v3-operation-inventory */\n  ];');
}

function check({ manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 'nimi.realm-v3-protected-sentinel/v2') {
    fail('unsupported manifest schema');
  }
  const baselineCommit = git('rev-parse', `${manifest.baselineCommit}^{commit}`);
  const baselineTree = git('rev-parse', `${manifest.baselineCommit}^{tree}`);
  if (baselineCommit !== manifest.baselineCommit || baselineTree !== manifest.baselineTree) {
    fail(`baseline commit/tree mismatch: commit=${baselineCommit} tree=${baselineTree}`);
  }
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', baselineCommit, 'HEAD'], { cwd: repoRoot });
  if (ancestor.status !== 0) fail('current Nimi HEAD does not descend from protected baseline');
	const implementationBaseline = resolveImplementationBaseline(manifest, baselineCommit);

  const immutable = manifest.immutablePaths.map((target) => assertNoDiff(implementationBaseline.commit, target));
  const authorityAndValidators = manifest.protectedAuthorityAndValidatorPaths
    .map((target) => assertNoDiff(baselineCommit, target));
  const migrationPaths = new Set();
  const authorizedAuthorityMigrations = (manifest.authorizedAuthorityMigrations ?? []).map((migration) => {
    if (migrationPaths.has(migration.path)) fail(`duplicate authorized authority migration: ${migration.path}`);
    migrationPaths.add(migration.path);
    if (manifest.immutablePaths.includes(migration.path) || manifest.protectedAuthorityAndValidatorPaths.includes(migration.path)) {
      fail(`authorized authority migration duplicates a zero-diff protected path: ${migration.path}`);
    }
    return assertAuthorizedAuthorityMigration(baselineCommit, implementationBaseline.commit, migration);
  });

  const exception = manifest.narrowException;
  let narrowException = null;
  if (exception !== undefined) {
    const baselineObject = git('rev-parse', `${baselineCommit}:${exception.path}`);
    if (baselineObject !== exception.baselineObject) {
      fail(`shared broker baseline object mismatch: expected=${exception.baselineObject} actual=${baselineObject}`);
    }
    const baselineSource = execFileSync('git', ['show', `${baselineCommit}:${exception.path}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const currentSource = fs.readFileSync(path.join(repoRoot, exception.path), 'utf8');
    const baselineProtectedHash = sha256(normalizeBrokerInventory(baselineSource));
    const currentProtectedHash = sha256(normalizeBrokerInventory(currentSource));
    if (currentProtectedHash !== baselineProtectedHash) {
      fail(`${exception.path} changed outside ${exception.allowedSection}`);
    }
    narrowException = {
      path: exception.path,
      allowedSection: exception.allowedSection,
      baselineObject,
      currentHeadObject: git('rev-parse', `HEAD:${exception.path}`),
      protectedSemanticHash: currentProtectedHash,
      requiredUnchangedSemantics: exception.requiredUnchangedSemantics,
    };
  }

  return {
    schemaVersion: 'nimi.realm-v3-protected-sentinel-result/v1',
    verdict: 'PASS',
    baselineCommit,
    baselineTree,
    implementationBaseline,
    currentCommit: git('rev-parse', 'HEAD'),
    currentTree: git('rev-parse', 'HEAD^{tree}'),
    immutable,
    authorityAndValidators,
    authorizedAuthorityMigrations,
    narrowException,
    protectedDiffs: 0,
    authorizedAuthorityDiffs: authorizedAuthorityMigrations.length,
    unapprovedProtectedDiffs: 0,
  };
}

try {
  const result = check(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[check:realm-v3:protected-sentinel] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
