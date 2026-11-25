import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openDurableFullStorage } from '../dist-electron/durable-sqlite.js';
import {
  buildMinimalShellEnv,
  extractWorkspaceEnvCanarySecrets,
  isControlPlanePath,
  isSensitivePath,
  redactCanarySecrets,
  resolveSafeWorkspacePath,
  sanitizeBidi,
  StreamingCanaryRedactor,
  truncateUtf8Bytes,
} from '../dist-electron/security-policy.js';
import {
  SecureWorkspaceExecutionEnv,
  WorkspaceWriteCoordinator,
} from '../dist-electron/secure-workspace-env.js';
import {
  decodeBodyStepStreamEvent,
  HarnessBodySymbiosisClient,
  logicalAgentModelId,
} from '../dist-electron/body-symbiosis.js';
import { handleEngineWorkerRequest } from '../dist-electron/engine-worker.js';

test('FT-10: openDurableFullStorage verifies WAL + synchronous=FULL (2) via readback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nimi-harness-wal-'));
  try {
    const dbPath = join(dir, 'session.sqlite');
    const opened = await openDurableFullStorage(dbPath);
    try {
      assert.equal(opened.journalMode, 'wal');
      assert.equal(opened.synchronous, 2);
    } finally {
      await opened.db.close();
    }
    const workerRes = await handleEngineWorkerRequest({
      id: 'w-1',
      kind: 'verify-sqlite-durability',
      dbPath,
    });
    assert.equal(workerRes.ok, true);
    assert.deepEqual(workerRes.result, { journalMode: 'wal', synchronous: 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('FT-11 & FT-12: Gates 2 & 3 path guards, trailing-space/sub-.git/..notes.md, sensitive hard-deny, control-plane wall, streaming redactor & UTF-8 byte truncation', () => {
  const root = process.platform === 'win32' ? 'D:\\work\\demo' : '/tmp/work/demo';
  for (const bad of ['@secret.txt', 'file:///etc/passwd', '\\\\?\\C:\\Windows', 'note.txt:ads', 'foo./bar.ts', '../outside.txt', '.env ', 'package.json ', 'CON', 'dir/nul.txt']) {
    assert.throws(() => resolveSafeWorkspacePath(root, bad), `expected reject for ${bad}`);
  }
  assert.equal(resolveSafeWorkspacePath(root, 'src/app.ts').relativePosix, 'src/app.ts');
  // Legitimate filenames starting with ".." MUST NOT be false-blocked as parent traversal.
  assert.equal(resolveSafeWorkspacePath(root, '..notes.md').relativePosix, '..notes.md');

  // Gate 3 sensitive hard-deny
  for (const sens of ['.env', '.env ', '.env.local', 'sub/.env.production', 'keys/id_rsa', 'cert.pem', 'tls.key', '.ssh/config', '.npmrc']) {
    assert.equal(isSensitivePath(sens), true, `expected sensitive deny for ${sens}`);
  }
  assert.equal(isSensitivePath('.env.example'), false);
  assert.equal(isSensitivePath('src/index.ts'), false);

  // Gate 3 control-plane file wall (case-folded, normalized at ANY depth!)
  for (const cp of ['.git/config', './.git/config', 'sub/.git/hooks/pre-commit', '.GITHUB/workflows/ci.yml', 'PACKAGE.JSON', 'vitest.config.ts', 'tsconfig.json', 'Makefile', 'deploy.PS1', 'build.rs']) {
    assert.equal(isControlPlanePath(cp), true, `expected control-plane match for ${cp}`);
  }
  assert.equal(isControlPlanePath(join(root, '.git', 'config'), root), true);
  assert.equal(isControlPlanePath('src/components/Button.tsx'), false);

  // Bidi stripping
  assert.equal(sanitizeBidi('safe\u202eevil\u202c.ts'), 'safeevil.ts');

  // Cross-chunk streaming canary redaction
  const secret = 'sk_live_split_secret_987654321';
  const redactor = new StreamingCanaryRedactor([secret]);
  const out1 = redactor.push('prefix sk_live_split_');
  const out2 = redactor.push('secret_987654321 suffix');
  const out3 = redactor.flush();
  const joined = out1 + out2 + out3;
  assert.ok(!joined.includes(secret));
  assert.ok(joined.includes('[REDACTED_WORKSPACE_SECRET]'));

  // Exact UTF-8 byte truncation without corrupting multi-byte CJK scalars
  const cjk = '你好世界测试内容';
  const truncated = truncateUtf8Bytes(cjk, 7);
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= 7);
  assert.equal(truncated, '你好');
});

test('FT-13 & FT-14: Gates 1, 2, 4, 6, 7 — Real NTFS write/snapshot persistence/delete-restore conflict, native fail-closed, hardlink reject, spill redirect, inheritEnv:false, .env canary redaction & Windows Job Object grandchild 0-residue', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'nimi-harness-gates-'));
  const workspace = join(baseDir, 'repo');
  const dataRoot = join(baseDir, 'data');
  const outsideDir = join(baseDir, 'outside');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(workspace, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await mkdir(outsideDir, { recursive: true });

    // Fork 4: Missing native host MUST fail closed on Windows/macOS (NO silent fallback!).
    if (process.platform === 'win32' || process.platform === 'darwin') {
      const failClosedEnv = new SecureWorkspaceExecutionEnv({
        sessionId: 'sess-fail-closed',
        workspaceRoot: workspace,
        explicitDevWorkspace: true,
        dataRoot,
        securityHost: null,
      });
      const readDenied = await failClosedEnv.readTextFile('hello.txt', context);
      assert.equal(readDenied.ok, false);
      const execDenied = await failClosedEnv.exec('echo hi', { timeout: 5 }, context);
      assert.equal(execDenied.ok, false);
    }

    // Seed .env (root + nested subdir) with secret canaries and normal benign vars.
    const canarySecret = 'sk_live_canary_998877665544332211';
    const nestedSecret = 'ghp_nested_subdir_secret_77665544';
    const canaryB64 = Buffer.from(canarySecret, 'utf8').toString('base64');
    await writeFile(join(workspace, '.env'), `NODE_ENV=production\nAPI_SECRET_KEY=${canarySecret}\n`, 'utf8');
    await mkdir(join(workspace, 'services', 'api'), { recursive: true });
    await writeFile(join(workspace, 'services', 'api', '.env.local'), `GITHUB_TOKEN=${nestedSecret}\n`, 'utf8');
    await writeFile(join(workspace, 'hello.txt'), 'original-v1', 'utf8');

    const extracted = await extractWorkspaceEnvCanarySecrets(workspace);
    assert.ok(extracted.includes(canarySecret));
    assert.ok(extracted.includes(nestedSecret));

    const env = new SecureWorkspaceExecutionEnv({
      sessionId: 'sess-sec-1',
      workspaceRoot: workspace,
      explicitDevWorkspace: true,
      dataRoot,
    });

    // Gate 3: Reading .env MUST fail closed.
    const readEnvRes = await env.readTextFile('.env', context);
    assert.equal(readEnvRes.ok, false);

    // Gate 6: Typed write persists snapshot index across restart -> restorePreWriteSnapshot recovers original-v1!
    const writeRes = await env.writeFile('hello.txt', 'modified-v2', context);
    assert.equal(writeRes.ok, true);
    assert.equal(await readFile(join(workspace, 'hello.txt'), 'utf8'), 'modified-v2');

    // Simulate Harness process restart: reload persisted snapshots & recentAiEdits from disk!
    const restartedEnv = new SecureWorkspaceExecutionEnv({
      sessionId: 'sess-sec-1',
      workspaceRoot: workspace,
      explicitDevWorkspace: true,
      dataRoot,
    });
    const snaps = restartedEnv.getSnapshots();
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].relativePath, 'hello.txt');
    assert.equal(restartedEnv.getRecentAiEditedFiles().length, 1);

    // External modification causes restore conflict (fail closed)!
    await writeFile(join(workspace, 'hello.txt'), 'external-edit-v3', 'utf8');
    await assert.rejects(() => restartedEnv.restorePreWriteSnapshot(snaps[0].snapshotId));

    // When disk matches afterSha256, restore succeeds atomically!
    await writeFile(join(workspace, 'hello.txt'), 'modified-v2', 'utf8');
    const restored = await restartedEnv.restorePreWriteSnapshot(snaps[0].snapshotId);
    assert.equal(restored.restored, true);
    assert.equal(await readFile(join(workspace, 'hello.txt'), 'utf8'), 'original-v1');

    // Delete snapshot restore MUST fail closed if user created a new file at the deleted path!
    const delRes = await restartedEnv.remove('hello.txt', undefined, context);
    assert.equal(delRes.ok, true);
    const delSnap = restartedEnv.getSnapshots().at(-1);
    assert.equal(delSnap?.afterSha256, null);
    await writeFile(join(workspace, 'hello.txt'), 'user-created-new-file', 'utf8');
    await assert.rejects(() => restartedEnv.restorePreWriteSnapshot(delSnap.snapshotId));

    // Gate 2: NTFS Hardlink escape (nNumberOfLinks > 1) MUST be rejected on Windows via compiled Rust addon!
    if (process.platform === 'win32') {
      const outsideTarget = join(outsideDir, 'secret-outside.txt');
      await writeFile(outsideTarget, 'outside-secret', 'utf8');
      await link(outsideTarget, join(workspace, 'hardlink-escape.txt'));
      const hlRead = await env.readTextFile('hardlink-escape.txt', context);
      assert.equal(hlRead.ok, false, 'Hardlink escape MUST be blocked by Rust nNumberOfLinks == 1 check');
    }

    // Gate 7: createTempFile redirects strictly inside <dataRoot>/spill/ (NEVER os.tmpdir()).
    const spillFile = await env.createTempFile({ prefix: 'out-', suffix: '.log' }, context);
    assert.equal(spillFile.ok, true);
    assert.ok(resolve(spillFile.value).startsWith(resolve(join(dataRoot, 'spill'))));

    // Gate 4 Layer 1: Non-dev workspace refuses string shell AND interpreter array exec!
    const nonDevEnv = new SecureWorkspaceExecutionEnv({
      sessionId: 'sess-nondev',
      workspaceRoot: workspace,
      explicitDevWorkspace: false,
      dataRoot,
    });
    assert.equal((await nonDevEnv.exec('echo blocked', undefined, context)).ok, false);
    assert.equal((await nonDevEnv.exec(['node', '-e', 'console.log(1)'], undefined, context)).ok, false);

    // Gate 4 Layers 1 & 3: inheritEnv: false (parent env not leaked) + .env canary redaction (raw + base64)!
    // NOTE: options.timeout is in SECONDS matching pi-durable ShellExecOptions!
    process.env.NIMI_SUPER_SECRET_PARENT_LEAK = 'LEAKED_PARENT_VALUE_999';
    let capturedOut = '';
    try {
      const cmd = process.platform === 'win32'
        ? `Write-Output "PARENT=$env:NIMI_SUPER_SECRET_PARENT_LEAK RAW=${canarySecret} B64=${canaryB64} ENV=production"`
        : `echo "PARENT=$NIMI_SUPER_SECRET_PARENT_LEAK RAW=${canarySecret} B64=${canaryB64} ENV=production"`;
      const execRes = await env.exec(cmd, {
        timeout: 15,
        onOutput: text => { capturedOut += text; },
      }, context);
      assert.equal(execRes.ok, true);
    } finally {
      delete process.env.NIMI_SUPER_SECRET_PARENT_LEAK;
    }
    assert.ok(!capturedOut.includes('LEAKED_PARENT_VALUE_999'), `Parent env leaked into child: ${capturedOut}`);
    assert.ok(!capturedOut.includes(canarySecret), `Raw .env secret leaked in stdout: ${capturedOut}`);
    assert.ok(!capturedOut.includes(canaryB64), `Base64 .env secret leaked in stdout: ${capturedOut}`);
    assert.ok(capturedOut.includes('[REDACTED_WORKSPACE_SECRET]'), `Expected redaction marker in stdout: ${capturedOut}`);
    assert.ok(capturedOut.includes('ENV=production'), `Benign literal should NOT be false-positive redacted: ${capturedOut}`);

    // Gate 1 (Windows Live Win32 Job Object): Grandchild process MUST have 0 residue after timeout (seconds)!
    if (process.platform === 'win32') {
      const pidFile = join(workspace, 'grandchild.pid');
      const spawnGrandchildCmd = `$p = Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -PassThru -WindowStyle Hidden; Set-Content -Path '${pidFile}' -Value $p.Id; Start-Sleep -Seconds 30`;
      const timeoutRes = await env.exec(spawnGrandchildCmd, { timeout: 1.5 }, context);
      assert.equal(timeoutRes.ok, false);
      assert.equal(timeoutRes.error.code, 'timeout');
      const rawPid = await readFile(pidFile, 'utf8').catch(() => '');
      const gcPid = Number.parseInt(rawPid.trim(), 10);
      if (Number.isFinite(gcPid) && gcPid > 0) {
        let alive = true;
        try {
          process.kill(gcPid, 0);
        } catch {
          alive = false;
        }
        assert.equal(alive, false, `Grandchild PID ${gcPid} survived Win32 Job Object termination!`);
      }
    }

    // Gate 6: Overlapping workspace write coordinator freezes & serializes ancestor/descendant writes.
    const coord = new WorkspaceWriteCoordinator();
    coord.freezeWorkspace(workspace);
    assert.equal(coord.isFrozen(join(workspace, 'sub', 'dir')), true);
    coord.unfreezeWorkspace(workspace);
    assert.equal(coord.isFrozen(join(workspace, 'sub', 'dir')), false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('FT-19..22: HarnessBodySymbiosisClient decodes protobuf-ts payload oneof, enforces acked===true, drains tombstones BEFORE projections, enforces AuthorizeBodySideEffect fail-closed, retries beforeCompact, and streams inference', async () => {
  assert.equal(logicalAgentModelId('agent-alpha'), 'local-agent:agent-alpha');

  // Verify canonical protobuf-ts oneof decoding!
  const decodedDone = decodeBodyStepStreamEvent({
    eventIndex: 2,
    effectiveContextBudgetTokens: 96_000,
    payload: {
      oneofKind: 'done',
      done: {
        finishReason: 'stop',
        usageInputTokens: '420',
        usageOutputTokens: '80',
        stepMac: 'mac-step-1',
        compactionSummary: 'Summary via protobuf-ts oneof',
        postCompactionMac: 'mac-post-1',
        effectiveContextBudgetTokens: 96_000,
      },
    },
  });
  assert.equal(decodedDone?.kind, 'done');
  assert.equal(decodedDone?.compactionSummary, 'Summary via protobuf-ts oneof');
  assert.equal(decodedDone?.usageInputTokens, 420);

  const events = [];
  let compactionAttempts = 0;
  let allowSideEffect = true;

  const fakeClient = {
    async registerBodyCarrier() {
      events.push('register');
      return {
        leaseEpoch: '7',
        heartbeatIntervalMs: 60_000,
        pendingTombstones: [
          { outboxId: 'ob-purge-1', commandKind: 3, workSessionRef: 'ws-old', agentBinding: 'agent-alpha' },
          { outboxId: 'ob-inv-1', commandKind: 2, workSessionRef: 'ws-live', agentBinding: 'agent-alpha' },
        ],
        pendingIntents: [
          { outboxId: 'ob-intent-1', commandKind: 1, workSessionRef: 'ws-live', agentBinding: 'agent-alpha', payloadJson: '{"text":"hello"}' },
        ],
      };
    },
    async heartbeatBodyCarrier() { return { renewed: true, leaseEpoch: '7' }; },
    async unregisterBodyCarrier() { events.push('unregister'); return { unregistered: true }; },
    async subscribeBodyOutbox() {
      return (async function* () { /* idle live stream */ })();
    },
    async ackBodyOutbox(req) {
      events.push(`ack:${req.outboxId}`);
      return { acked: true, outboxId: req.outboxId };
    },
    async authorizeBodySideEffect() {
      return allowSideEffect
        ? { authorized: true }
        : { authorized: false, denyReason: 'memory_read_set_invalidated', memoryInvalidated: true };
    },
    async reportBodySessionProjection(req) {
      events.push(`proj:${req.workSessionRef}:seq=${req.projectionSeq}`);
      return { applied: true, acceptedProjectionSeq: req.projectionSeq };
    },
    async streamLocalAgentBodyStep(req) {
      if (req.purpose === 1) {
        return (async function* () {
          yield { eventIndex: 0, effectiveContextBudgetTokens: 128_000, payload: { oneofKind: 'textDelta', textDelta: 'Hello ' } };
          yield { eventIndex: 1, effectiveContextBudgetTokens: 128_000, payload: { oneofKind: 'toolCallActivity', toolCallActivity: { callId: 'c1', toolName: 'read', argumentsDeltaBytes: 12, accumulatedBytes: 12 } } };
          yield { eventIndex: 2, effectiveContextBudgetTokens: 128_000, payload: { oneofKind: 'done', done: { finishReason: 'stop', usageInputTokens: '10', usageOutputTokens: '5', stepMac: 'm1', compactionSummary: '', postCompactionMac: '', effectiveContextBudgetTokens: 128_000 } } };
        })();
      }
      compactionAttempts += 1;
      if (compactionAttempts === 1) {
        throw new Error('transient network hiccup');
      }
      return (async function* () {
        yield {
          eventIndex: 0,
          effectiveContextBudgetTokens: 128_000,
          payload: {
            oneofKind: 'done',
            done: {
              finishReason: 'stop',
              compactionSummary: 'Verified compacted summary',
              postCompactionMac: 'mac-abc-123',
              usageInputTokens: '500',
              usageOutputTokens: '100',
              effectiveContextBudgetTokens: 128_000,
            },
          },
        };
      })();
    },
  };

  const controller = new AbortController();
  const symbiosis = new HarnessBodySymbiosisClient({
    deviceId: 'dev-win-1',
    client: fakeClient,
    handlers: {
      async onPurgeSession(ref) { events.push(`purge:${ref}`); },
      async onPurgeAgent(agent) { events.push(`purge-agent:${agent}`); },
      async onInvalidateMemory(ref) { events.push(`invalidate:${ref}`); },
      async onNewIntent(env) { events.push(`intent:${env.outboxId}`); },
      async onReconcileAfterTombstones() {
        return [{ workSessionRef: 'ws-live', status: 'interrupted', title: 'Live Session' }];
      },
    },
  });

  await symbiosis.start(controller.signal);

  assert.deepEqual(events, [
    'register',
    'purge:ws-old',
    'ack:ob-purge-1',
    'invalidate:ws-live',
    'ack:ob-inv-1',
    'proj:ws-live:seq=1',
    'intent:ob-intent-1',
    'ack:ob-intent-1',
  ]);

  // Stream inference via StreamLocalAgentBodyStep (purpose=1)
  const stepKinds = [];
  for await (const ev of symbiosis.streamInferenceStep({
    agentHandle: 'handle-alpha',
    agentBinding: 'agent-alpha',
    workSessionRef: 'ws-live',
    workingMessages: [{ role: 'user', contentJson: '"hi"' }],
    tools: [],
  })) {
    stepKinds.push(ev.kind);
  }
  assert.deepEqual(stepKinds, ['textDelta', 'toolCallActivity', 'done']);

  // AuthorizeBodySideEffect allows when valid and throws fail-closed when invalidated!
  await symbiosis.authorizeSideEffect({
    workSessionRef: 'ws-live',
    callId: 'call_1',
    toolName: 'edit_file',
    actionKind: 'file_write',
    payloadHash: 'hash1',
  });
  allowSideEffect = false;
  await assert.rejects(
    () => symbiosis.authorizeSideEffect({
      workSessionRef: 'ws-live',
      callId: 'call_1',
      toolName: 'edit_file',
      actionKind: 'file_write',
      payloadHash: 'hash1',
    }),
    /memory_read_set_invalidated/,
  );

  // Compaction executes 2 bounded retries and decodes protobuf-ts payload.oneofKind === 'done'!
  const compacted = await symbiosis.executeCompactionWithRetries({
    workSessionRef: 'ws-live',
    agentBinding: 'agent-alpha',
    workingMessages: [{ role: 'user', contentJson: '"turn 1"' }],
    keptTailMessages: [{ role: 'user', contentJson: '"turn 9"' }],
  }, 2);
  assert.equal(compactionAttempts, 2);
  assert.equal(compacted.summary, 'Verified compacted summary');
  assert.equal(compacted.postCompactionMac, 'mac-abc-123');
  assert.equal(symbiosis.getEffectiveContextBudgetTokens(), 128_000);

  const { ReasonCode } = await import('@nimiplatform/sdk/runtime/generated');
  fakeClient.streamLocalAgentBodyStep = async function* () {
    yield { payload: { oneofKind: 'failed', failed: { reasonCode: ReasonCode.AI_CONFIG_INVALID, message: 'Missing model.' } } };
  };
  await assert.rejects(symbiosis.executeCompactionWithRetries({
    workSessionRef: 'ws-live', agentBinding: 'agent-alpha', workingMessages: [], keptTailMessages: [],
  }), { reasonCode: 'AI_CONFIG_INVALID', message: 'Missing model.' });

  controller.abort();
  await symbiosis.stop();
});

test('Sanity: buildMinimalShellEnv omits arbitrary secrets & extractWorkspaceEnvCanarySecrets skips benign literals', async () => {
  const minimal = buildMinimalShellEnv({ PATH: '/bin', AWS_SECRET_ACCESS_KEY: 'super-secret', LANG: 'en' });
  assert.equal(minimal.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(minimal.LANG, 'C.UTF-8');
  const redacted = redactCanarySecrets('token=abc1234567890 ok=production', ['abc1234567890']);
  assert.equal(redacted, 'token=[REDACTED_WORKSPACE_SECRET] ok=production');
});
