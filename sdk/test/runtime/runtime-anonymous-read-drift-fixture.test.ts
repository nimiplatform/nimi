/**
 * Wave 2 (topic 2026-05-10-runtime-bearer-revocation-contract-closure)
 * drift-fixture tests for the anonymous_read classifier.
 *
 * These tests run the mainline drift script
 * (scripts/check-runtime-rpc-auth-posture-sdk-drift.mjs) against a
 * mutated copy of the SDK classifier source to confirm that:
 *
 *   - The script exits non-zero when the SDK omits an anonymous_read
 *     method id present in the spec table.
 *   - The script exits non-zero when the SDK adds a fake method id
 *     not present in the spec table's anonymous_read slice.
 *   - The script exits zero on the unmodified SDK source.
 *
 * Implementation note: rather than mutate the live source file, we
 * extract the source-locator regex from the script, construct a small
 * synthetic copy with a swapped path, and invoke the script with an
 * env var override. The drift script accepts an environment override
 * `RUNTIME_RPC_AUTH_POSTURE_SDK_DRIFT_SDK_SOURCE` for the SDK source
 * path, so we point it at a temp-dir copy. (If the script does not
 * accept overrides, this test scaffold copies the unmutated source as
 * the baseline check and skips the mutation paths with a clear note —
 * the in-process classifier shape test still guards size invariants.)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..', '..', '..', '..');
const driftScript = join(repoRoot, 'scripts', 'check-runtime-rpc-auth-posture-sdk-drift.mjs');
const sdkSourceRel = 'nimi/sdk/src/runtime/method-ids.ts';
const sdkSourceAbs = join(repoRoot, sdkSourceRel);

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

function makeIsolatedRepoCopy(mutator: (source: string) => string): string {
  const workdir = mkdtempSync(join(tmpdir(), 'sdk-drift-fixture-'));
  // Mirror just the two paths the drift script reads.
  const tableRel = 'nimi/.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture.yaml';
  const tableSrcAbs = join(repoRoot, tableRel);
  const tableDstAbs = join(workdir, tableRel);
  mkdirSync(dirname(tableDstAbs), { recursive: true });
  copyFileSync(tableSrcAbs, tableDstAbs);

  const sdkSrcContent = readFileSync(sdkSourceAbs, 'utf8');
  const sdkDstAbs = join(workdir, sdkSourceRel);
  mkdirSync(dirname(sdkDstAbs), { recursive: true });
  writeFileSync(sdkDstAbs, mutator(sdkSrcContent), 'utf8');

  return workdir;
}

test('drift script exits 0 against the unmodified SDK source (sanity baseline)', () => {
  if (!existsSync(driftScript)) {
    assert.fail(`drift script missing at ${driftScript}`);
  }
  const { code, stdout, stderr } = runDriftScript();
  assert.equal(
    code,
    0,
    `drift script must exit 0 on unmodified source.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
  );
});

// Returns a mutator that operates only inside the
// `RuntimeAnonymousReadMethodIds` array body — leaves the unrelated
// `RuntimeMethodIds` dictionary at the top of the file untouched.
function inAnonymousReadArrayOnly(
  bodyMutator: (body: string) => string,
): (source: string) => string {
  return (source) => {
    const arrayBlockRe = /(export\s+const\s+RuntimeAnonymousReadMethodIds\s*:\s*readonly\s+string\[\][^=]*=\s*Object\.freeze\(\s*\[)([\s\S]*?)(\]\s*\)\s*;)/;
    const match = arrayBlockRe.exec(source);
    if (!match) {
      throw new Error('fixture setup: RuntimeAnonymousReadMethodIds array not found');
    }
    const head = match[1];
    const body = match[2];
    const tail = match[3];
    const mutatedBody = bodyMutator(body);
    if (mutatedBody === body) {
      throw new Error('fixture setup: body mutator did not change the array body');
    }
    return source.replace(arrayBlockRe, head + mutatedBody + tail);
  };
}

test('drift script exits non-zero when the SDK omits one anonymous_read method id', () => {
  const targetMethodId = '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth';
  const workdir = makeIsolatedRepoCopy(
    inAnonymousReadArrayOnly((body) => {
      const lineRe = new RegExp(`\\s*'${escapeForRegExp(targetMethodId)}',\\s*\\n`);
      return body.replace(lineRe, '\n');
    }),
  );
  try {
    const { code, stdout, stderr } = runDriftScript(workdir);
    assert.notEqual(
      code,
      0,
      `drift script must exit non-zero when an anonymous_read method id is missing from the SDK.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
    assert.ok(
      stderr.includes('missing') || stderr.includes(targetMethodId),
      `expected stderr to mention the missing method id; got:\n${stderr}`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

test('drift script exits non-zero when the SDK adds a fake method id', () => {
  const fakeMethodId = '/nimi.runtime.v1.RuntimeFakeService/FakeMethod';
  const workdir = makeIsolatedRepoCopy(
    inAnonymousReadArrayOnly((body) => `\n  '${fakeMethodId}',${body}`),
  );
  try {
    const { code, stdout, stderr } = runDriftScript(workdir);
    assert.notEqual(
      code,
      0,
      `drift script must exit non-zero when SDK contains a fake method id.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
    assert.ok(
      stderr.includes('not classified') || stderr.includes(fakeMethodId),
      `expected stderr to mention the fake method id; got:\n${stderr}`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
});

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
