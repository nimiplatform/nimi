import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function gitFiles(repoRoot) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  }).toString('utf8').split('\0').filter(Boolean).sort();
}

const executionCarrierPaths = new Set([
  'apps/desktop/product-control-node/npm/win32-x64/nimi_desktop_product_control.node',
  'kit/shell/protected-local-node/npm/win32-x64/nimi_shell_protected_local.node',
]);

function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function sourceTreeSha256(repoRoot) {
  const digest = createHash('sha256');
  for (const relative of gitFiles(repoRoot)) {
    const absolute = path.join(repoRoot, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      digest.update(relative).update('\0deleted\0');
      continue;
    }
    digest.update(relative).update('\0');
    if (stat.isSymbolicLink()) {
      digest.update('symlink\0').update(fs.readlinkSync(absolute)).update('\0');
    } else if (stat.isFile()) {
      const content = executionCarrierPaths.has(relative)
        ? execFileSync('git', ['show', `HEAD:${relative}`], { cwd: repoRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
        : fs.readFileSync(absolute);
      digest.update('file\0').update(String(stat.mode & 0o111)).update('\0').update(content).update('\0');
    } else if (stat.isDirectory()) {
      digest.update('directory\0');
    } else {
      throw new Error(`unsupported admitted source entry: ${relative}`);
    }
  }
  return digest.digest('hex');
}

export function captureSourceState(nimiRoot) {
  const configuredRealmRoot = String(process.env.REALM_ROOT || '').trim();
  if (!configuredRealmRoot) {
    throw new Error('REALM_ROOT is required to capture the external Realm authority source state');
  }
  const realmRoot = path.resolve(configuredRealmRoot);
  const state = {
    schemaVersion: 'nimi.local-agent-product-source-state/v3',
    nimiCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: nimiRoot, encoding: 'utf8' }).trim(),
    realmCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: realmRoot, encoding: 'utf8' }).trim(),
    nimiSourceTreeSha256: sourceTreeSha256(nimiRoot),
    realmSourceTreeSha256: sourceTreeSha256(realmRoot),
    testPointCatalogSha256: fileSha256(path.join(nimiRoot, 'config', 'local-agent-product-acceptance-points.yaml')),
    journeyRegistrySha256: fileSha256(path.join(nimiRoot, 'config', 'local-agent-product-journeys.yaml')),
    executionPolicySha256: fileSha256(path.join(nimiRoot, 'config', 'local-agent-product-execution-policy.yaml')),
    conversationScenarioRegistrySha256: fileSha256(path.join(nimiRoot, 'config', 'local-agent-product-conversation-scenarios.yaml')),
  };
  return {
    ...state,
    sourceDigest: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
  };
}

export function assertSourceState(expected, nimiRoot) {
  const actual = captureSourceState(nimiRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`source state changed during acceptance run: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

export function assertAdmittedSourceState(expected, nimiRoot) {
  if (expected?.schemaVersion !== 'nimi.local-agent-product-source-state/v3') {
    throw new Error('invalid admitted source-state schema');
  }
  const actual = captureSourceState(nimiRoot);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', expected.nimiCommit, actual.nimiCommit], {
    cwd: nimiRoot,
    stdio: 'ignore',
  });
  if (ancestor.status !== 0
    || expected.realmCommit !== actual.realmCommit
    || expected.nimiSourceTreeSha256 !== actual.nimiSourceTreeSha256
    || expected.realmSourceTreeSha256 !== actual.realmSourceTreeSha256) {
    throw new Error(`admitted source state does not match current source content: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}
