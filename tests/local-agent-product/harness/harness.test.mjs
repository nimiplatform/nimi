import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assessAccessibilityAudit,
  assessObservedProcessBudget,
  beginObservedProcess,
  createObservedProcessLedger,
  inspectNetworkAuthorityMaterial,
  isRuntimeObservedProcessMismatch,
  isRuntimeRestartUiTransition,
  isTypedProjectRevocationDenial,
  resolveHostRustToolchainHomes,
  waitForObservedProcessConnection,
} from './dev-kernel-contract.mjs';
import { startProcess } from './cross-app-driver.mjs';
import {
  decodeDesktopRuntimeUnaryResponse,
  probeRealRealmBrowserLoginAuthority,
} from './dev-kernel-cross-app-driver.mjs';
import {
  classifyRememberedInitialGrantPosture,
  selectRememberedProjectAuthorizations,
} from './dev-kernel-local-development-driver.mjs';
import { resolvePortableProcessInvocation } from './process-command.mjs';
import { readLocalAgentTestArchitecture } from './registry.mjs';
import { validateArchitecture, validateJourneyRepeatIsolation, validateJourneyResult } from './validation.mjs';

const clone = (value) => structuredClone(value);
const devKernelCrossAppDriverSource = [
  'dev-kernel-cross-app-driver.mjs',
  'dev-kernel-host-driver.mjs',
  'dev-kernel-first-run-driver.mjs',
  'dev-kernel-local-development-driver.mjs',
  'dev-kernel-result-driver.mjs',
].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');
const firstRunConnectivitySource = fs.readFileSync(
  path.join(import.meta.dirname, 'run-first-run-connectivity.mjs'),
  'utf8',
);
const browserAuthDriverSource = [
  'dev-kernel-browser-auth-driver.mjs',
  'dev-kernel-browser-auth-chrome.mjs',
].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');

test('portable process invocation executes the pnpm CLI through Node without a Windows shell', () => {
  assert.deepEqual(
    resolvePortableProcessInvocation('pnpm', ['test'], {
      platform: 'win32',
      pnpmCliPath: 'C:\\tools\\pnpm.cjs',
    }),
    { command: process.execPath, args: ['C:\\tools\\pnpm.cjs', 'test'] },
  );
  assert.deepEqual(
    resolvePortableProcessInvocation('pnpm', ['test'], { platform: 'linux' }),
    { command: 'pnpm', args: ['test'] },
  );
  assert.deepEqual(
    resolvePortableProcessInvocation('go', ['test'], { platform: 'win32' }),
    { command: 'go', args: ['test'] },
  );
});

test('dev-kernel Desktop journey invokes the final Electron standard shell carrier', () => {
  assert.match(devKernelCrossAppDriverSource, /window\.__NIMI_ELECTRON_RUNTIME__/);
  assert.match(devKernelCrossAppDriverSource, /NIMI_STANDARD_SHELL_COMMANDS\['runtime-lifecycle\.status'\]/);
  assert.doesNotMatch(devKernelCrossAppDriverSource, /window\.__TAURI_INTERNALS__/);
  assert.doesNotMatch(devKernelCrossAppDriverSource, /['"]runtime_bridge_status['"]/);
});

test('Runtime unary decoder accepts a canonical empty protobuf but rejects a missing carrier field', () => {
  const codec = {
    decodeResponse(bytes) {
      assert.equal(bytes.byteLength, 0);
      return { jobs: [] };
    },
  };
  assert.deepEqual(
    decodeDesktopRuntimeUnaryResponse(codec, { responseBytesBase64: '' }, '/runtime/ListJobs'),
    { jobs: [] },
  );
  assert.throws(
    () => decodeDesktopRuntimeUnaryResponse(codec, {}, '/runtime/ListJobs'),
    /returned no response bytes field/u,
  );
});

test('dev-kernel Electron journeys isolate real Chrome auth inside the trial root', () => {
  for (const source of [devKernelCrossAppDriverSource, firstRunConnectivitySource]) {
    assert.match(source, /NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: browserCaptureFile/u);
    assert.match(source, /browserAuthSafeChildEnvironment\(process\.env\)/u);
    assert.match(source, /NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT/);
  }
  assert.match(browserAuthDriverSource, /launchPersistentContext\(profileRoot,[\s\S]*channel: 'chrome'/u);
  assert.match(browserAuthDriverSource, /requireTrialDescendant[\s\S]*browser-auth-private/u);
  assert.match(browserAuthDriverSource, /page\.locator\('input'\)[\s\S]*replaceAll\(credential\.email/u);
  assert.doesNotMatch(browserAuthDriverSource, /request\.postData|allHeaders|authorization.*header/iu);
  assert.doesNotMatch(browserAuthDriverSource, /dev-kernel-browser-auth-failed[^\n]+cause/iu);
});

test('real Realm login preflight requires a web login continuation and rejects automatic callback', async () => {
  let mode = 'web-login';
  let origin = '';
  const server = http.createServer((request, response) => {
    const authorization = new URL(request.url || '/', origin);
    if (mode === 'automatic-callback') {
      response.writeHead(302, { location: authorization.searchParams.get('redirect_uri') || '/' });
    } else {
      const login = new URL('http://localhost:3000/login');
      login.searchParams.set('oauth_next', authorization.toString());
      response.writeHead(302, { location: login.toString() });
    }
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
    const positive = await probeRealRealmBrowserLoginAuthority(origin, 'http://localhost:3000');
    assert.equal(positive.automaticLoopbackCallbackObserved, false);
    assert.equal(positive.oauthNextOrigin, origin);
    mode = 'automatic-callback';
    await assert.rejects(
      () => probeRealRealmBrowserLoginAuthority(origin, 'http://localhost:3000'),
      /invalid browser-login continuation/u,
    );
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('process capture persists full logs while bounding in-memory diagnostics', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-process-capture-'));
  try {
    const stdoutPath = path.join(root, 'stdout.log');
    const stderrPath = path.join(root, 'stderr.log');
    const handle = startProcess(process.execPath, [
      '-e',
      "process.stdout.write('A'.repeat(256)); process.stderr.write('B'.repeat(192));",
    ], { stdoutPath, stderrPath, maxCapturedBytes: 64 });
    const result = await handle.completed;
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'A'.repeat(64));
    assert.equal(result.stderr, 'B'.repeat(64));
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, true);
    assert.equal(fs.readFileSync(stdoutPath, 'utf8'), 'A'.repeat(256));
    assert.equal(fs.readFileSync(stderrPath, 'utf8'), 'B'.repeat(192));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('host Rust toolchain roots remain outside product HOME isolation and fail closed on ambiguity', () => {
  const hostHome = path.join(os.tmpdir(), 'nimi-host-home');
  assert.deepEqual(resolveHostRustToolchainHomes({ env: {}, hostHome }), {
    rustupHome: path.resolve(hostHome, '.rustup'),
    cargoHome: path.resolve(hostHome, '.cargo'),
  });
  assert.deepEqual(resolveHostRustToolchainHomes({
    env: { RUSTUP_HOME: path.join(hostHome, 'rustup'), CARGO_HOME: path.join(hostHome, 'cargo') },
  }), {
    rustupHome: path.resolve(hostHome, 'rustup'),
    cargoHome: path.resolve(hostHome, 'cargo'),
  });
  assert.throws(
    () => resolveHostRustToolchainHomes({ env: { RUSTUP_HOME: 'relative', CARGO_HOME: 'also-relative' } }),
    /absolute paths/,
  );
  assert.throws(
    () => resolveHostRustToolchainHomes({
      env: { RUSTUP_HOME: hostHome, CARGO_HOME: hostHome },
    }),
    /must remain distinct/,
  );
});

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function expectFailure(failures, pattern) {
  assert.ok(failures.some((failure) => pattern.test(failure)), `expected ${pattern}, got ${JSON.stringify(failures)}`);
}

function validArchitecture() {
  const architecture = readLocalAgentTestArchitecture();
  assert.deepEqual(validateArchitecture(architecture), []);
  return architecture;
}

function sourceState() {
  return {
    schemaVersion: 'nimi.local-agent-product-source-state/v3',
    nimiCommit: 'a'.repeat(40),
    realmCommit: 'b'.repeat(40),
    nimiSourceTreeSha256: 'c'.repeat(64),
    realmSourceTreeSha256: 'd'.repeat(64),
    testPointCatalogSha256: 'e'.repeat(64),
    journeyRegistrySha256: 'f'.repeat(64),
    executionPolicySha256: '1'.repeat(64),
    conversationScenarioRegistrySha256: '3'.repeat(64),
    sourceDigest: '2'.repeat(64),
  };
}

function createValidJourneyFixture() {
  const architecture = validArchitecture();
  const journey = architecture.journeys.journeys.find((row) => row.journey_id === 'full-chain-core');
  const points = architecture.points.points.filter((point) => point.execution_binding?.journey_id === journey.journey_id);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-journey-validation-'));
  const safePath = path.join(root, 'safe-evidence.json');
  const providerPath = path.join(root, 'provider-capture-summary.json');
  fs.writeFileSync(safePath, '{"safe":true}\n');
  fs.writeFileSync(providerPath, `${JSON.stringify({
    complete: true,
    contextLaneOrderVerified: true,
    contextLaneIds: [
      'runtime_policy', 'output_contract', 'source_identity', 'source_behavior', 'world_context',
      'relationship_context', 'source_knowledge', 'canonical_memory', 'conversation_history', 'capability_context',
    ],
  })}\n`);
  const trialId = 'full-chain-core:L2:core:1';
  const started = Date.parse('2026-07-12T00:00:00.000Z');
  const checkpointIndex = new Map(journey.checkpoints.map((checkpoint, index) => [checkpoint.checkpoint_id, index]));
  const assertionsByCheckpoint = new Map(journey.checkpoints.map((checkpoint) => [checkpoint.checkpoint_id, []]));
  for (const point of points) {
    const target = point.execution_binding.checkpoint_ids[0];
    assertionsByCheckpoint.get(target).push(...point.assertion_ids.map((assertionId) => ({ assertionId, outcome: 'passed' })));
  }
  const checkpoints = journey.checkpoints.map((checkpoint, index) => ({
    checkpointId: checkpoint.checkpoint_id,
    prerequisiteIds: checkpoint.prerequisite_ids,
    startedAt: new Date(started + index * 10).toISOString(),
    completedAt: new Date(started + index * 10 + 5).toISOString(),
    correlations: { runtimeInstanceId: 'runtime-1', sourceRefs: [], localAgentRefs: [], turnIds: [] },
    assertions: assertionsByCheckpoint.get(checkpoint.checkpoint_id),
    artifactRefs: ['safe-evidence'],
    outcome: 'passed',
  }));
  const result = {
    schemaVersion: 'nimi.local-agent-product-journey-result/v2',
    journeyTrialId: trialId,
    journeyId: journey.journey_id,
    tier: 'L2',
    batch: 'core',
    repeatIndex: 1,
    sourceState: sourceState(),
    environmentIdentity: {
      rootId: 'isolated-root-1',
      accountIds: ['account-1'],
      worldIds: ['world-1'],
      sourceIds: ['source-1'],
      runtimeSourceRefs: ['runtime-source-1'],
      localAgentIds: ['agent-1'],
      processStarts: journey.environment.start_limits,
    },
    durationMs: 1000,
    checkpoints,
    leafResults: points.map((point) => ({
      leafId: point.point_id,
      journeyTrialId: trialId,
      checkpointIds: point.execution_binding.checkpoint_ids,
      assertionIds: point.assertion_ids,
      evidenceRefs: ['safe-evidence'],
      outcome: 'passed',
      failureClass: null,
    })),
    artifacts: [{ artifactId: 'safe-evidence', path: safePath, sha256: sha256(safePath), bytes: fs.statSync(safePath).size, privacyClass: 'safe_evidence' }, { artifactId: 'provider-capture-summary', path: providerPath, sha256: sha256(providerPath), bytes: fs.statSync(providerPath).size, privacyClass: 'safe_evidence' }],
    processProblems: [],
    privacy: { ok: true, findings: [] },
    outcome: 'passed',
  };
  assert.deepEqual(validateJourneyResult({ architecture, journey, result, expectedSourceState: sourceState() }), []);
  return { architecture, journey, result, root, checkpointIndex };
}

test('architecture rejects a deleted leaf mapping', () => {
  const architecture = validArchitecture();
  const mutated = clone(architecture);
  const journey = mutated.journeys.journeys.find((row) => row.journey_id === 'full-chain-core');
  const point = mutated.points.points.find((row) => row.execution_binding?.journey_id === journey.journey_id);
  for (const checkpoint of journey.checkpoints) checkpoint.covered_leaf_ids = checkpoint.covered_leaf_ids.filter((id) => id !== point.point_id);
  expectFailure(validateArchitecture(mutated), /mapping|covered/i);
});

test('architecture rejects a nonexistent checkpoint', () => {
  const mutated = clone(validArchitecture());
  const point = mutated.points.points.find((row) => row.minimum_sufficient_layer === 'L2');
  point.execution_binding.checkpoint_ids = ['checkpoint-does-not-exist'];
  expectFailure(validateArchitecture(mutated), /checkpoint-does-not-exist/);
});

test('architecture rejects dev-kernel owner-minimal checkpoint reordering', () => {
  const mutated = clone(validArchitecture());
  const journey = mutated.journeys.journeys.find((row) => row.journey_id === 'dev-kernel-core');
  const processMismatch = journey.checkpoints.find((row) => row.checkpoint_id === 'process-mismatch-denied');
  processMismatch.prerequisite_ids = ['zero-grant-session'];
  expectFailure(validateArchitecture(mutated), /dev-kernel-core.*checkpoint graph/i);
});

test('architecture rejects replacing the Desktop Tauri product prerequisite with Electron', () => {
  const mutated = clone(validArchitecture());
  const journey = mutated.journeys.journeys.find((row) => row.journey_id === 'dev-kernel-core');
  journey.prerequisites = journey.prerequisites.map((value) => (
    value === 'desktop_tauri_candidate' ? 'desktop_electron_build' : value
  ));
  expectFailure(validateArchitecture(mutated), /dev-kernel-core.*checkpoint graph/i);
});

test('architecture rejects reactivating historical direct-daemon mappings', () => {
  const mutated = clone(validArchitecture());
  const historical = mutated.journeys.journeys.find((row) => row.journey_id === 'full-chain-core');
  historical.execution_disposition = 'active_checkpoint';
  historical.positive_runtime_path = 'direct_daemon';
  mutated.policy.gates.core.journeys = [{ journey_id: 'full-chain-core', repeats: 1 }];
  mutated.policy.gates.acceptance.journeys.push('full-chain-core');
  expectFailure(validateArchitecture(mutated), /non-executable|historical|direct-daemon|core gates/i);
});

test('process-mismatch checkpoint distinguishes stale supervised and raw uncarried denial', () => {
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'process-replaced' } }), true);
  assert.equal(isRuntimeObservedProcessMismatch({ probeKind: 'raw-uncarried', lastError: { reasonCode: 'runtime-service-untrusted' } }), true);
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'runtime-service-untrusted' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({
    probeKind: 'raw-uncarried',
    fixedServiceStable: true,
    fixedServiceProcessId: 42,
    runtimeCandidateId: `dev-kernel-runtime-${'a'.repeat(32)}`,
    lastError: { reasonCode: 'runtime-service-unavailable' },
  }), true);
  assert.equal(isRuntimeObservedProcessMismatch({ probeKind: 'raw-uncarried', lastError: { reasonCode: 'runtime-service-unavailable' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({ probeKind: 'raw-uncarried', lastError: { reasonCode: 'process-replaced' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'protected-carrier-required' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch({ lastError: { reasonCode: 'no-grant' } }), false);
  assert.equal(isRuntimeObservedProcessMismatch(null), false);
});

test('remembered initial grant posture preserves exact revoked history without admitting other terminal states', () => {
  assert.equal(classifyRememberedInitialGrantPosture({ state: 'session-bound-zero-grant' }), 'session-zero-grant');
  assert.equal(classifyRememberedInitialGrantPosture({
    state: 'access-lost',
    lastError: { reasonCode: 'grant-revoked' },
  }), 'revoked-grant-history');
  for (const evidence of [
    { state: 'error', lastError: { reasonCode: 'grant-revoked' } },
    { state: 'access-lost', lastError: { reasonCode: 'revoked' } },
    { state: 'access-lost', lastError: { reasonCode: 'grant-superseded' } },
    { state: 'access-lost', lastError: { reasonCode: 'account-changed' } },
    { state: 'runtime-unavailable', lastError: { reasonCode: 'runtime-service-unavailable' } },
  ]) {
    assert.equal(classifyRememberedInitialGrantPosture(evidence), null);
  }
});

test('remembered authorization selection uses the public Electron decision literal', () => {
  const target = {
    selector: 'remembered-new',
    appId: 'nimi.zhiyu',
    accountId: 'account-primary',
    persistence: 'allow-remember-project',
    state: 'active',
    updatedAtUnixMs: 200,
  };
  const selected = selectRememberedProjectAuthorizations([
    { ...target, selector: 'remembered-old', updatedAtUnixMs: 100 },
    target,
    { ...target, selector: 'semantic-name-is-not-the-projection', persistence: 'remember_project' },
    { ...target, selector: 'run-once', persistence: 'allow-run-once' },
    { ...target, selector: 'wrong-account', accountId: 'account-secondary' },
  ], { accountId: 'account-primary', state: 'active' });
  assert.deepEqual(selected.map((row) => row.selector), ['remembered-new', 'remembered-old']);
});

test('project revoke checkpoint requires an attempted selected operation and typed denial', () => {
  const valid = {
    attempted: true,
    operationId: 'runtime_agent.conversation.open',
    denial: {
      state: 'access-lost',
      lastError: {
        reasonCode: 'revoked',
        actionHint: 'readmit_local_development_project',
        message: 'The local-development project authorization was revoked.',
        retryable: false,
      },
    },
  };
  assert.equal(isTypedProjectRevocationDenial(valid), true);
  assert.equal(isTypedProjectRevocationDenial({ ...valid, attempted: false }), false);
  assert.equal(isTypedProjectRevocationDenial({ processTerminated: true, runs: [{ state: 'revoked' }] }), false);
  assert.equal(isTypedProjectRevocationDenial({
    ...valid,
    denial: { ...valid.denial, lastError: { ...valid.denial.lastError, reasonCode: 'grant-revoked' } },
  }), false);
});

test('fixed-service restart checkpoint requires visible unavailable then recovered UI states', () => {
  const valid = {
    before: { processId: 101 },
    after: { processId: 202 },
    unavailableUi: { state: 'runtime-unavailable', reasonCode: 'runtime-service-unavailable' },
    recoveredUi: { state: 'open-granted', openPermissionState: 'granted' },
  };
  assert.equal(isRuntimeRestartUiTransition(valid), true);
  assert.equal(isRuntimeRestartUiTransition({ ...valid, unavailableUi: null }), false);
  assert.equal(isRuntimeRestartUiTransition({ ...valid, recoveredUi: { state: 'runtime-unavailable', openPermissionState: '' } }), false);
  assert.equal(isRuntimeRestartUiTransition({ ...valid, after: { processId: 101 } }), false);
});

test('renderer observation starts before the process and detects network authority material', async () => {
  const order = [];
  let resolveConnection;
  const launch = beginObservedProcess({
    connect: () => {
      order.push('observer-started');
      return new Promise((resolve) => { resolveConnection = resolve; });
    },
    start: () => {
      order.push('process-started');
      return { pid: 42 };
    },
  });
  assert.deepEqual(order, ['observer-started', 'process-started']);
  assert.deepEqual(launch.handle, { pid: 42 });
  resolveConnection({ page: 'renderer' });
  assert.deepEqual(await launch.connectionPromise, { page: 'renderer' });

  assert.deepEqual(inspectNetworkAuthorityMaterial({ url: 'https://example.test/safe', headers: {} }), {
    authorizationHeaderObserved: false,
    secretTextObserved: false,
  });
  assert.equal(inspectNetworkAuthorityMaterial({ headers: { Authorization: 'Bearer private-value' } }).authorizationHeaderObserved, true);
  assert.equal(inspectNetworkAuthorityMaterial({ url: 'https://example.test/?access_token=private-value' }).secretTextObserved, true);
  assert.equal(inspectNetworkAuthorityMaterial({ postData: 'refresh_token=private-value' }).secretTextObserved, true);
});

test('renderer observation fails immediately with persisted launcher diagnostics when the process exits', async () => {
  const handle = {
    child: { exitCode: 17, signalCode: null },
    completed: Promise.resolve({ code: 17, signal: null }),
    snapshot: () => ({
      code: 17,
      signal: null,
      stdoutPath: 'desktop.stdout.log',
      stderrPath: 'desktop.stderr.log',
      stdout: '',
      stderr: 'rustc host unavailable',
    }),
  };
  await assert.rejects(
    waitForObservedProcessConnection({
      connectionPromise: new Promise(() => {}),
      handle,
      label: 'Desktop',
    }),
    /Desktop.*desktop\.stderr\.log.*rustc host unavailable/,
  );
});

test('dev-kernel process starts are derived from an observed deduplicated ledger and bounded by maxima', () => {
  const ledger = createObservedProcessLedger();
  ledger.observe('provider', `fixture:${process.pid}`);
  ledger.observe('realm', `fixture:${process.pid}`);
  ledger.observe('runtime', 'pid:101');
  ledger.observe('runtime', 'pid:101');
  ledger.observe('runtime', 'pid:202');
  ledger.observe('desktop', 'pid:303');
  for (const identity of ['pid:401', 'pid:402', 'pid:403', 'generation:2', 'pid:404', 'pid:405']) {
    ledger.observe('zhiyu', identity, { kind: identity.startsWith('generation:') ? 'supervised-process-replacement' : 'process-start' });
  }
  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.processStarts, { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 6 });
  assert.deepEqual(
    assessObservedProcessBudget(
      snapshot.processStarts,
      { provider: 1, realm: 1, runtime: 3, desktop: 1, zhiyu: 6 },
      { provider: 1, realm: 1, runtime: 2, desktop: 1, zhiyu: 6 },
    ),
    { ok: true, overages: [], missing: [] },
  );
  assert.equal(assessObservedProcessBudget(
    { ...snapshot.processStarts, runtime: 4 },
    { provider: 1, realm: 1, runtime: 3, desktop: 1, zhiyu: 6 },
  ).ok, false);
});

test('accessibility acceptance requires an exposed document, named controls, language, and real inputs', () => {
  const audit = {
    dom: { lang: 'zh-CN', visibleButtons: 2, inputs: 1 },
    accessibility: [
      { role: 'RootWebArea', name: 'Nimi', ignored: false },
      { role: 'button', name: '重试', ignored: false },
      { role: 'textbox', name: '消息', ignored: false },
    ],
  };
  assert.equal(assessAccessibilityAudit(audit, { requiresInput: true }).ok, true);
  assert.deepEqual(
    assessAccessibilityAudit({
      dom: { lang: '', visibleButtons: 1, inputs: 0 },
      accessibility: [{ role: 'button', name: '', ignored: false }],
    }, { requiresInput: true }).findings,
    ['missing-exposed-document-root', 'unnamed-interactive-controls:1', 'document-language-missing', 'input-control-missing'],
  );
});

test('architecture rejects duplicate or conflicting leaf owners', () => {
  const mutated = clone(validArchitecture());
  mutated.points.points.push({ ...mutated.points.points[0], owner_iteration: 'I8' });
  expectFailure(validateArchitecture(mutated), /duplicate|owner/i);
});

test('result rejects prerequisite failure followed by a forged downstream pass', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.checkpoints[0].outcome = 'failed';
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /prerequisite|downstream/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects artifact hash drift', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.artifacts[0].sha256 = '0'.repeat(64);
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /artifact hash/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects source digest drift', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.sourceState.sourceDigest = '0'.repeat(64);
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /source state|source digest/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects privacy findings', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.privacy = { ok: false, findings: ['token'] };
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /privacy/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects a tier budget overrun', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.durationMs = fixture.journey.time_budget_ms + 1;
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /budget|duration/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects a leaf mapped without evidence', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.leafResults[0].evidenceRefs = [];
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /evidence/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('architecture rejects the old leaf runner becoming required again', () => {
  const mutated = clone(validArchitecture());
  mutated.policy.active_required_runner = 'tests/local-agent-product/harness/run-tier.mjs';
  expectFailure(validateArchitecture(mutated), /leaf|run-tier|active runner/i);
});

test('gate rejects logical account, world, source, and agent identity reuse across Journey repeats', () => {
  const fixture = createValidJourneyFixture();
  try {
    const second = clone(fixture.result);
    second.journeyTrialId = 'full-chain-core:L2:core-stability:2';
    second.repeatIndex = 2;
    second.environmentIdentity.rootId = 'isolated-root-2';
    expectFailure(validateJourneyRepeatIsolation([fixture.result, second]), /reused logical environment identity/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});
