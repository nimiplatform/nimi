// Tests for scripts/generate-lint-chain.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(REPO_ROOT, 'scripts', 'generate-lint-chain.mjs');

const SYNTHETIC_REGISTRY = `schema_version: release-gate-registry/v1
registry_version: "0.0.1"
profile_id: nimi
generated_at: 2026-05-10T00:00:00Z
tiers:
  - id: fast
    semantic: x
  - id: release
    semantic: y
targets:
  - any
reason_codes:
  - id: COMMAND_NONZERO
    semantic: x
gates:
  - id: gate.runtime.go-vet
    description: vet
    command: go vet ./...
    runner: shell
    tiers: [fast, release]
    targets: [any]
    timeout_seconds: 60
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: false
  - id: gate.runtime.go-build
    description: build
    command: go build ./...
    runner: shell
    tiers: [fast, release]
    targets: [any]
    timeout_seconds: 60
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: false
  - id: gate.sdk.test
    description: sdk test
    command: pnpm --filter @nimiplatform/sdk test
    runner: pnpm
    tiers: [release]
    targets: [sdk]
    timeout_seconds: 60
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: false
  - id: gate.runtime.experimental-skipped
    description: experimental should be skipped
    command: echo skip
    runner: shell
    tiers: [fast]
    targets: [any]
    timeout_seconds: 60
    p_relg_anchors: [P-RELG-001]
    parent_p_gov_anchors: [P-GOV-003]
    evidence:
      shape: command_exit
    experimental: true
`;

function makeTempPackageJson(tmpDir) {
  const pkg = {
    name: 'test-pkg',
    version: '1.0.0',
    private: true,
    scripts: {
      build: 'echo build',
      lint: 'echo placeholder-hand-edited',
      test: 'echo test',
    },
  };
  const pkgPath = path.join(tmpDir, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return pkgPath;
}

function runEntry(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (c) => stdout.push(c));
    child.stderr.on('data', (c) => stderr.push(c));
    child.on('close', (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    );
  });
}

test('--help exits 0', { timeout: 5000 }, async () => {
  const r = await runEntry(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage:/);
});

test('write mode regenerates scripts.lint and preserves other fields', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);

    const r = await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /lint chain regenerated/);

    const after = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    // Other scripts preserved
    assert.equal(after.name, 'test-pkg');
    assert.equal(after.version, '1.0.0');
    assert.equal(after.scripts.build, 'echo build');
    assert.equal(after.scripts.test, 'echo test');
    // Lint regenerated: 2 fast-tier gates → joined by ' && '
    // (gate.runtime.experimental-skipped is excluded by experimental:true)
    // Topo with stable id tie-break: gate.runtime.go-build < gate.runtime.go-vet alphabetically
    assert.equal(after.scripts.lint, 'go build ./... && go vet ./...');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--check mode: matches → exit 0', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);

    // First write
    await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    // Then check
    const r = await runEntry(['--check', '--registry-path', registryPath, '--package-json', pkgPath]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /matches projection/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--check mode: drift → exit 1 with diff', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);

    // pkg.scripts.lint is "echo placeholder-hand-edited", projection is different
    const r = await runEntry(['--check', '--registry-path', registryPath, '--package-json', pkgPath]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /DRIFT detected/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('idempotent: second run produces no diff', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);

    await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    const after1 = fs.readFileSync(pkgPath, 'utf8');

    await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    const after2 = fs.readFileSync(pkgPath, 'utf8');

    assert.equal(after1, after2, 'second run must produce identical bytes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('experimental:true gates excluded from projection', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);

    await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    const after = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    // gate.runtime.experimental-skipped's command is 'echo skip'; must NOT appear
    assert.equal(after.scripts.lint.includes('echo skip'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('release-only gates excluded from fast-tier projection', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);

    await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    const after = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    // gate.sdk.test has tiers=[release] only, NOT fast → should NOT appear
    assert.equal(after.scripts.lint.includes('pnpm --filter @nimiplatform/sdk test'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('write mode preserves package.json indent (2 spaces)', { timeout: 10000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = makeTempPackageJson(tmp);
    const before = fs.readFileSync(pkgPath, 'utf8');

    await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    const after = fs.readFileSync(pkgPath, 'utf8');

    // The original was 2-space indent. Generator should NOT reformat the
    // entire file; only the lint string should change. So the indentation
    // markers (\n  ") must still be there.
    assert.equal(before.includes('\n  "scripts":'), true);
    assert.equal(after.includes('\n  "scripts":'), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rejects malformed package.json', { timeout: 5000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(pkgPath, '{this is not valid json');

    const r = await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /failed to parse/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rejects package.json missing scripts.lint', { timeout: 5000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const registryPath = path.join(tmp, 'registry.yaml');
    fs.writeFileSync(registryPath, SYNTHETIC_REGISTRY);
    const pkgPath = path.join(tmp, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({ name: 'x', scripts: { build: 'echo' } }, null, 2) + '\n'
    );

    const r = await runEntry(['--registry-path', registryPath, '--package-json', pkgPath]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /scripts.lint missing/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--check exits 1 with helpful message when registry missing', { timeout: 5000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-lint-'));
  try {
    const pkgPath = makeTempPackageJson(tmp);
    const r = await runEntry([
      '--check',
      '--registry-path',
      path.join(tmp, 'no-such.yaml'),
      '--package-json',
      pkgPath,
    ]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /registry file not found|registry-load error/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
