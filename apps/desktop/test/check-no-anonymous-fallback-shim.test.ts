/**
 * Drift-gate fixture tests for `scripts/check-no-anonymous-fallback-shim.mjs`.
 *
 * Strategy: copy the script + a synthetic renderer tree into a temp work
 * dir, inject one forbidden pattern at a time, run the script with the
 * temp dir as cwd, and assert non-zero exit. Also assert clean baseline
 * (no fixture, no offenders) exits 0, and that the boundary-preserved
 * files remain unflagged after the bearer-boundary hard cut.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const driftScriptRel = 'scripts/check-no-anonymous-fallback-shim.mjs';
function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, driftScriptRel))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      assert.fail(`repo root containing ${driftScriptRel} not found from ${startDir}`);
    }
    current = parent;
  }
}

const repoRoot = findRepoRoot(dirname(__filename));
const driftScript = join(repoRoot, 'scripts', 'check-no-anonymous-fallback-shim.mjs');
const renderRel = 'apps/desktop/src/shell/renderer';

function runDriftScript(workdirOverride?: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [driftScript], {
    cwd: workdirOverride ?? repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function makeIsolatedRenderer(extraFiles: Array<{ relPath: string; content: string }>): string {
  const workdir = mkdtempSync(join(tmpdir(), 'fallback-shim-fixture-'));
  // The script reads relative to process.cwd(). Create a minimal
  // synthetic renderer tree at the real repo-relative renderer path.
  const renderAbs = join(workdir, renderRel);
  mkdirSync(renderAbs, { recursive: true });
  // Always include one clean baseline file so the scan sees >0 files
  writeFileSync(
    join(renderAbs, 'baseline.ts'),
    "export const baseline = 'wave-3-clean';\n",
    'utf8',
  );
  for (const extra of extraFiles) {
    const abs = join(renderAbs, extra.relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, extra.content, 'utf8');
  }
  return workdir;
}

test('drift gate exists and is executable', () => {
  assert.ok(existsSync(driftScript), `expected drift script at ${driftScript}`);
});

test('drift gate exits 0 against the unmodified renderer (cleaned tree baseline)', () => {
  const { code, stdout, stderr } = runDriftScript();
  assert.equal(
    code,
    0,
    `drift gate must exit 0 on the cleaned renderer.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
  );
});

test('drift gate exits 0 against a synthetic clean tree with only baseline files', () => {
  const workdir = makeIsolatedRenderer([]);
  try {
    const { code } = runDriftScript(workdir);
    assert.equal(code, 0, 'baseline (no offenders) must exit 0');
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate flags withAnonymousReadFallback in a synthetic file', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-fallback-1.ts',
      content: `
async function withAnonymousReadFallback<T>(
  action: () => Promise<T>,
  anonymousAction: () => Promise<T>,
): Promise<T> {
  try { return await action(); } catch { return anonymousAction(); }
}
export { withAnonymousReadFallback };
`,
    },
  ]);
  try {
    const { code, stderr } = runDriftScript(workdir);
    assert.notEqual(code, 0, 'drift gate must exit non-zero when withAnonymousReadFallback appears');
    assert.ok(
      stderr.includes('withAnonymousReadFallback'),
      `expected stderr to mention withAnonymousReadFallback; got:\n${stderr}`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate flags new Runtime(...) constructor calls in a synthetic file', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-new-runtime.ts',
      content: `
import { Runtime } from '@nimiplatform/sdk/runtime';
const second = new Runtime({ appId: 'a', transport: { type: 'tauri-ipc' } });
export { second };
`,
    },
  ]);
  try {
    const { code, stderr } = runDriftScript(workdir);
    assert.notEqual(code, 0, 'drift gate must exit non-zero when new Runtime(...) appears');
    assert.ok(
      stderr.includes('new Runtime('),
      `expected stderr to mention new Runtime( pattern; got:\n${stderr}`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate flags getAnonymousRuntime in a synthetic file', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-anon.ts',
      content: 'function getAnonymousRuntime() { return null; }\nexport { getAnonymousRuntime };\n',
    },
  ]);
  try {
    const { code, stderr } = runDriftScript(workdir);
    assert.notEqual(code, 0);
    assert.ok(stderr.includes('getAnonymousRuntime'), `stderr should mention getAnonymousRuntime: ${stderr}`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate flags authFailedBecauseOfStaleBearer in a synthetic file', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-auth-failed.ts',
      content: 'function authFailedBecauseOfStaleBearer(): boolean { return false; }\nexport { authFailedBecauseOfStaleBearer };\n',
    },
  ]);
  try {
    const { code, stderr } = runDriftScript(workdir);
    assert.notEqual(code, 0);
    assert.ok(stderr.includes('authFailedBecauseOfStaleBearer'), `stderr should mention authFailedBecauseOfStaleBearer: ${stderr}`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate flags anonymousReadUntilMs in a synthetic file', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-window.ts',
      content: 'let anonymousReadUntilMs = 0;\nexport { anonymousReadUntilMs };\n',
    },
  ]);
  try {
    const { code, stderr } = runDriftScript(workdir);
    assert.notEqual(code, 0);
    assert.ok(stderr.includes('anonymousReadUntilMs'), `stderr should mention anonymousReadUntilMs: ${stderr}`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate flags STALE_BEARER_ANONYMOUS_RETRY_MS in a synthetic file', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-const.ts',
      content: 'const STALE_BEARER_ANONYMOUS_RETRY_MS = 60_000;\nexport { STALE_BEARER_ANONYMOUS_RETRY_MS };\n',
    },
  ]);
  try {
    const { code, stderr } = runDriftScript(workdir);
    assert.notEqual(code, 0);
    assert.ok(stderr.includes('STALE_BEARER_ANONYMOUS_RETRY_MS'), `stderr should mention STALE_BEARER_ANONYMOUS_RETRY_MS: ${stderr}`);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate skips files matching .fixture. in their path', () => {
  const workdir = makeIsolatedRenderer([
    {
      relPath: 'features/runtime-config/regression-shim.fixture.ts',
      // intentionally contains an offender — should be skipped because of .fixture. in path
      content: 'function withAnonymousReadFallback() {}\n',
    },
  ]);
  try {
    const { code } = runDriftScript(workdir);
    assert.equal(code, 0, 'fixture-named files must be excluded from the scan');
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift gate leaves boundary-preserved files unflagged (legitimate AUTH_TOKEN_INVALID routing)', () => {
  // The Desktop files documented in the packet as boundary-preserved must
  // still be present in the repo and not flagged by the drift gate. We
  // confirm:
  //   1. The files exist.
  //   2. They contain none of the six forbidden patterns.
  const boundaryFiles = [
    'src/shell/renderer/infra/bootstrap/runtime-bootstrap-account-profile.ts',
    'src/shell/renderer/bridge/runtime-bridge/invoke.ts',
  ];
  const desktopAbs = resolve(dirname(__filename), '..');

  const literalsForbidden = [
    'withAnonymousReadFallback',
    'getAnonymousRuntime',
    'authFailedBecauseOfStaleBearer',
    'anonymousReadUntilMs',
    'STALE_BEARER_ANONYMOUS_RETRY_MS',
  ];
  const newRuntimeRe = /\bnew\s+Runtime\s*\(/;

  for (const rel of boundaryFiles) {
    const abs = resolve(desktopAbs, rel);
    assert.ok(existsSync(abs), `boundary file missing: ${rel}`);
    const content = readFileSync(abs, 'utf8');
    for (const literal of literalsForbidden) {
      assert.ok(
        !content.includes(literal),
        `boundary file ${rel} unexpectedly contains forbidden literal "${literal}" — Wave 3 must not have rewritten it`,
      );
    }
    assert.ok(
      !newRuntimeRe.test(content),
      `boundary file ${rel} unexpectedly contains a new Runtime(...) constructor call`,
    );
  }

});

test('drift gate --json outputs structured JSON', () => {
  const result = spawnSync('node', [driftScript, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(result.status, 0, `expected exit 0 on clean tree; stderr=${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.ok, true);
  assert.equal(typeof parsed.scannedFiles, 'number');
  assert.ok(parsed.scannedFiles > 0, 'expected scannedFiles > 0');
});
