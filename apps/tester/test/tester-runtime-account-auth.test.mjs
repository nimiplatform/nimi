import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildWithTsc } from './tsc-build.mjs';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-account-auth-'));
  buildWithTsc([
    '--outDir', buildDir,
    '--rootDir', 'src',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--skipLibCheck', 'true',
    '--types', 'node',
    '--noEmit', 'false',
    'src/shell/auth/runtime-platform.ts',
    'src/shell/local-app-runtime-platform.ts',
    'src/tester/tester-ai-config-store.ts',
    'src/tester/tester-runtime.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return buildDir;
}

async function importRuntimePlatform() {
  return import(pathToFileURL(path.join(buildModule(), 'shell/auth/runtime-platform.js')).href);
}

async function importLocalAppRuntimePlatform() {
  return import(pathToFileURL(path.join(buildModule(), 'shell/local-app-runtime-platform.js')).href);
}

async function importTesterRuntime() {
  return import(pathToFileURL(path.join(buildModule(), 'tester/tester-runtime.js')).href);
}

function ownerUnavailable(command) {
  return Object.assign(new Error('Admitted App operation owner is unavailable'), {
    code: 'runtime-permission-denied',
    reasonCode: 'local-app-owner-unavailable',
    actionHint: 'refresh_local_app_runtime_projection',
    source: 'runtime',
    details: { command, retryable: false },
  });
}

test.after(() => {
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});

test('Tester Electron lifecycle has no protected-session termination coupling', () => {
  const electronMain = readFileSync(path.join(root, 'src-electron/main.ts'), 'utf8');
  assert.doesNotMatch(electronMain, /onProtectedSessionFailure|supervised-host-reopen/u);
  assert.match(electronMain, /registerNimiElectronAppBridge\(\{/u);
  assert.match(electronMain, /await createMainWindow\(\)/u);
});

test('Tester local-app projection fails closed before a protected carrier is available', async () => {
  const runtimePlatform = await importRuntimePlatform();

  assert.equal(runtimePlatform.runtimeAccountLoginEnabled, false);
  const projection = await runtimePlatform.getRuntimePlatformProjection();
  assert.equal(projection.status, 'action-required');
  assert.equal(projection.mode, 'local-app');
  assert.equal(projection.reasonCode, 'renderer-standard-shell-host-unavailable');
  assert.equal(projection.actionHint, 'start_fixed_runtime_service');
  assert.equal('client' in projection, false);
  assert.equal('accountCaller' in projection, false);
  assert.equal('accountRuntime' in projection, false);
});

test('Tester presents typed unavailable posture without terminating its App carrier', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      throw Object.assign(new Error('Protected App Access is unavailable'), {
        code: 'runtime-permission-denied',
        reasonCode: 'local-app-operation-unavailable',
        actionHint: 'refresh_local_app_runtime_projection',
        source: 'runtime',
        details: { command, retryable: true },
      });
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    runtimePlatform.clearRuntimePlatformProjection();
    const projection = await runtimePlatform.getRuntimePlatformProjection();
    assert.deepEqual(projection, {
      status: 'action-required',
      mode: 'local-app',
      reasonCode: 'local-app-operation-unavailable',
      actionHint: 'wait_for_app_access_admission',
      message: 'Protected App Access is unavailable until Runtime admits a fresh access session.',
      messageKey: 'Auth.runtime.messages.operationUnavailable',
    });
    assert.deepEqual(calls, [
      { command: 'nimi.shell.localApp.sessionStatus', payload: {} },
    ]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester names a signed-out account without reporting carrier distrust', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command) {
      throw Object.assign(new Error('Runtime account is not authenticated'), {
        code: 'runtime-unauthenticated',
        reasonCode: 'runtime-unauthenticated',
        actionHint: 'refresh_local_app_runtime_projection',
        source: 'runtime',
        details: { command, retryable: false },
      });
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    runtimePlatform.clearRuntimePlatformProjection();
    const projection = await runtimePlatform.getRuntimePlatformProjection();
    assert.deepEqual(projection, {
      status: 'action-required',
      mode: 'local-app',
      reasonCode: 'runtime-unauthenticated',
      actionHint: 'sign_in_to_nimi_desktop',
      message: 'No Nimi account is signed in. Sign in through Nimi Desktop, then retry.',
      messageKey: 'Auth.runtime.messages.unauthenticated',
    });
    assert.doesNotMatch(projection.message, /untrusted|carrier|machine/iu);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester preserves a bound identity session without treating it as App Access', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      assert.equal(command, 'nimi.shell.localApp.sessionStatus');
      return {
        state: 'ready',
        reasonCode: 'action-executed',
        retryable: false,
        currentUser: {
          state: 'ready',
          value: { handle: '@halliday', displayName: 'Halliday', avatarUrl: null },
          reasonCode: 'action-executed',
          retryable: false,
        },
      };
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    runtimePlatform.clearRuntimePlatformProjection();
    const projection = await runtimePlatform.getRuntimePlatformProjection();
    assert.equal(projection.status, 'ready');
    assert.equal(projection.mode, 'local-app');
    assert.deepEqual(projection.localAppSession, {
      mode: 'local-app',
      state: 'session-bound',
      sessionBound: true,
      reasonCode: 'action-executed',
      actionHint: 'continue_local_app_session',
      retryable: false,
    });
    assert.deepEqual(calls, [{ command: 'nimi.shell.localApp.sessionStatus', payload: {} }]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester app-private storage reaches typed ingress and preserves owner-unavailable', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      throw ownerUnavailable(command);
    },
    listen() { return () => {}; },
  };
  try {
    const { getTesterLocalAppClient } = await importLocalAppRuntimePlatform();

    await assert.rejects(
      getTesterLocalAppClient().storage.writeJson('settings/profile.json', { theme: 'calm' }),
      (error) => {
        assert.equal(error?.code, 'runtime-permission-denied');
        assert.equal(error?.reasonCode, 'local-app-owner-unavailable');
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, 'nimi.shell.storage.writeJson');
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester reports typed owner unavailability after protected ingress', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      if (command === 'nimi.shell.localApp.sessionStatus') {
        return {
          state: 'ready',
          reasonCode: 'action-executed',
          retryable: false,
          currentUser: {
            state: 'ready',
            value: { handle: '@halliday', displayName: 'Halliday', avatarUrl: null },
            reasonCode: 'action-executed',
            retryable: false,
          },
        };
      }
      throw ownerUnavailable(command);
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    const { runTesterCapability } = await importTesterRuntime();
    runtimePlatform.clearRuntimePlatformProjection();

    const result = await runTesterCapability({
      capabilityId: 'text.generate',
      prompt: 'Write an acceptance note.',
      parameters: { temperature: 0.7, topP: 0.9, maxTokens: 1024 },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'runtime-call-failed');
    assert.match(result.message, /owner is unavailable/u);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { command: 'nimi.shell.localApp.sessionStatus', payload: {} });
    assert.equal(calls[1]?.command, 'nimi.shell.localApp.textGenerateCandidate');
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

function readyRuntimeDependencies(client, overrides = {}) {
  return {
    async getRuntimeProjection() { return { status: 'ready', mode: 'local-app' }; },
    getLocalAppClient() { return client; },
    ...overrides,
  };
}

function fakeLocalAppClient(overrides = {}) {
  const unavailable = (name) => async () => {
    throw Object.assign(new Error(`${name} was not configured by this test.`), {
      reasonCode: 'TEST_METHOD_UNAVAILABLE',
    });
  };
  return {
    ai: {
      text: {
        generateCandidate: overrides.generateCandidate ?? unavailable('text.generateCandidate'),
        streamTurn: overrides.streamTurn ?? unavailable('text.streamTurn'),
      },
      scenario: {
        execute: overrides.executeScenario ?? unavailable('scenario.execute'),
      },
      scenarioJobs: {
        submit: overrides.submitScenarioJob ?? unavailable('scenarioJobs.submit'),
        get: overrides.getScenarioJob ?? unavailable('scenarioJobs.get'),
        subscribe: overrides.subscribeScenarioJob ?? unavailable('scenarioJobs.subscribe'),
        cancel: overrides.cancelScenarioJob ?? unavailable('scenarioJobs.cancel'),
      },
      artifacts: {
        read: overrides.readArtifact ?? unavailable('artifacts.read'),
      },
      voiceAssets: {
        list: overrides.listVoiceAssets ?? unavailable('voiceAssets.list'),
      },
    },
    storage: {
      assets: {
        adoptArtifact: overrides.adoptArtifact ?? unavailable('storage.assets.adoptArtifact'),
        remove: overrides.removeAsset ?? unavailable('storage.assets.remove'),
      },
    },
  };
}

function localTextSubscription(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    async cancel() {},
  };
}

function localScenarioJobSubscription(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    async cancel() {},
  };
}

function localVoiceJob(status, source, overrides = {}) {
  return {
    jobId: `job-${source}`,
    scenarioType: 'voice-create',
    status,
    progressPercent: status === 'completed' ? 100 : 0,
    progressCurrentStep: status === 'completed' ? 1 : 0,
    progressTotalSteps: 1,
    reasonCode: '',
    reasonDetail: '',
    artifacts: [],
    traceId: `trace-${source}`,
    createdAt: null,
    updatedAt: null,
    transcriptionText: '',
    ...overrides,
  };
}

function localVoiceAsset(source) {
  return {
    voiceAssetId: `voice-${source}`,
    creationSource: source,
    status: 'active',
    createdAt: null,
    updatedAt: null,
    expiresAt: null,
  };
}

function artifactRunnerSuccess(capabilityId, mimeType, previewUrl, previewSource = 'inline-bytes') {
  const artifact = {
    artifactId: `artifact:${capabilityId}`,
    mimeType,
    ...(previewUrl ? { previewUrl } : {}),
    previewSource,
  };
  return {
    ok: true,
    capabilityId,
    message: `${capabilityId} completed`,
    output: {
      kind: 'test-artifacts',
      jobId: `job:${capabilityId}`,
      jobStatus: 'COMPLETED',
      artifactCount: 1,
      firstArtifact: artifact,
      artifacts: [artifact],
    },
    trace: { traceId: `trace:${capabilityId}` },
  };
}

const MEDIA_HAPPY_CASES = [
  ['image.generate', 'imageGenerate', 'image/png', 'data:image/png;base64,AQ=='],
  ['video.generate', 'videoGenerate', 'video/mp4', 'data:video/mp4;base64,AQ=='],
  ['audio.synthesize', 'speechSynthesize', 'audio/mpeg', 'data:audio/mpeg;base64,AQ=='],
];

for (const [capabilityId, runnerName, mimeType, previewUrl] of MEDIA_HAPPY_CASES) {
  test(`Tester ${capabilityId} assembles the Local App Scenario Job adapter and projects artifact preview`, async () => {
    const { runTesterCapability } = await importTesterRuntime();
    const adoptionCalls = [];
    const client = fakeLocalAppClient({
      async adoptArtifact(input) {
        adoptionCalls.push(input);
        return {
          relativePath: input.relativePath,
          mediaType: mimeType,
          sizeBytes: 33 * 1024 * 1024,
          sha256: `sha256:${'a'.repeat(64)}`,
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-09T00:00:00.000Z',
        };
      },
    });
    const jobClient = { marker: `job-client:${capabilityId}` };
    const calls = [];
    const parameters = capabilityId === 'image.generate'
      ? { negativePrompt: 'no fog', count: 2, size: '768x512', seed: 0, aspectRatio: '3:2', quality: 'hd', style: 'natural', referenceImageArtifactId: 'artifact-reference', mask: 'https://example.test/mask.png' }
      : capabilityId === 'video.generate'
        ? { mode: 'i2v-reference', referenceArtifactId: 'artifact-reference', negativePrompt: 'no shake', resolution: '720p', frames: 49, seed: 0, generateAudio: false, ratio: '16:9', durationSec: 2, fps: 24, cameraFixed: false, watermark: true, draft: false, returnLastFrame: true, serviceTier: 'standard', executionExpiresAfterSec: 60 }
        : { voiceKind: 'preset', voicePreset: 'voice-preset', language: 'en', audioFormat: 'mp3', sampleRateHz: 0, speed: 0, pitch: 0, volume: 0, emotion: 'calm', timingMode: 'word' };
    const result = await runTesterCapability({ capabilityId, prompt: `run ${capabilityId}`, scenarioId: 'scenario-1', parameters }, readyRuntimeDependencies(client, {
      createScenarioJobClient(ai) {
        assert.equal(ai, client.ai);
        return jobClient;
      },
      runners: {
        async [runnerName](input) {
          calls.push(input);
          assert.equal(input.runtime.ai, jobClient);
          assert.equal(input.appId, 'nimi.tester');
          assert.equal(input.scenarioId, 'scenario-1');
          return artifactRunnerSuccess(capabilityId, mimeType, previewUrl);
        },
      },
    }));

    assert.equal(result.ok, true);
    assert.equal(result.output.kind, 'artifacts');
    assert.equal(result.output.firstArtifact.mediaType, mimeType);
    assert.equal(result.output.firstArtifact.sizeBytes, 33 * 1024 * 1024);
    assert.equal(result.output.firstArtifact.sha256, `sha256:${'a'.repeat(64)}`);
    assert.match(result.output.firstArtifact.relativePath, new RegExp(`^media/${capabilityId.replaceAll('.', '-')}/[0-9a-f]{64}\\.asset$`, 'u'));
    assert.equal(result.output.firstArtifact.previewSource, 'managed-asset');
    assert.equal('artifactId' in result.output.firstArtifact, false);
    assert.equal('url' in result.output.firstArtifact, false);
    assert.deepEqual(adoptionCalls, [{
      artifactId: `artifact:${capabilityId}`,
      relativePath: result.output.firstArtifact.relativePath,
      overwrite: false,
    }]);
    assert.equal(calls.length, 1);
    if (capabilityId === 'image.generate') {
      assert.equal(calls[0].negativePrompt, 'no fog');
      assert.equal(calls[0].count, 2);
      assert.equal(calls[0].seed, 0);
      assert.equal(calls[0].referenceImageArtifactId, 'artifact-reference');
      assert.equal(calls[0].referenceImages, undefined);
      assert.equal(calls[0].mask, 'https://example.test/mask.png');
    } else if (capabilityId === 'video.generate') {
      assert.equal(calls[0].mode, 'i2v-reference');
      assert.deepEqual(calls[0].content, [{ type: 'artifact-ref', role: 'reference-image', artifactId: 'artifact-reference' }]);
      assert.deepEqual(calls[0].options, {
        resolution: '720p', ratio: '16:9', durationSec: 2, frames: 49, fps: 24, seed: 0,
        cameraFixed: false, watermark: true, generateAudio: false, draft: false,
        serviceTier: 'standard', executionExpiresAfterSec: 60, returnLastFrame: true,
      });
    } else {
      assert.deepEqual(calls[0].voiceRef, { kind: 'preset_voice_id', presetVoiceId: 'voice-preset' });
      assert.equal(calls[0].sampleRateHz, 0);
      assert.equal(calls[0].speed, 0);
      assert.equal(calls[0].pitch, 0);
      assert.equal(calls[0].volume, 0);
      assert.equal(calls[0].timingMode, 'word');
    }
  });
}

test('Tester adopts every returned video artifact including the requested last frame', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const adoptionCalls = [];
  const client = fakeLocalAppClient({
    async adoptArtifact(input) {
      adoptionCalls.push(input);
      const lastFrame = input.artifactId === 'artifact:last-frame';
      return {
        relativePath: input.relativePath,
        mediaType: lastFrame ? 'image/png' : 'video/mp4',
        sizeBytes: lastFrame ? 2048 : 4096,
        sha256: `sha256:${lastFrame ? 'b' : 'a'}`.padEnd(71, lastFrame ? 'b' : 'a'),
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      };
    },
  });
  const videoArtifact = {
    artifactId: 'artifact:video',
    mimeType: 'video/mp4',
    previewSource: 'metadata-only',
  };
  const lastFrameArtifact = {
    artifactId: 'artifact:last-frame',
    mimeType: 'image/png',
    previewSource: 'metadata-only',
  };
  const result = await runTesterCapability({
    capabilityId: 'video.generate',
    prompt: 'ocean wave',
    parameters: { returnLastFrame: true },
  }, readyRuntimeDependencies(client, {
    createScenarioJobClient() { return { marker: 'job-client:video.generate' }; },
    runners: {
      async videoGenerate() {
        return {
          ok: true,
          capabilityId: 'video.generate',
          message: 'video.generate completed',
          output: {
            kind: 'video-artifacts',
            jobId: 'job:video-with-last-frame',
            jobStatus: 'COMPLETED',
            artifactCount: 2,
            firstArtifact: videoArtifact,
            artifacts: [videoArtifact, lastFrameArtifact],
          },
        };
      },
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.output.kind, 'artifacts');
  assert.equal(result.output.artifacts.length, 2);
  assert.deepEqual(result.output.artifacts.map((artifact) => artifact.mediaType), ['video/mp4', 'image/png']);
  assert.equal(result.output.firstArtifact.relativePath, result.output.artifacts[0].relativePath);
  assert.equal(new Set(result.output.artifacts.map((artifact) => artifact.relativePath)).size, 2);
  assert.deepEqual(adoptionCalls.map((call) => call.artifactId), ['artifact:video', 'artifact:last-frame']);
});

test('Tester removes already adopted artifacts when a later artifact adoption fails', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const adoptionCalls = [];
  const removalCalls = [];
  const client = fakeLocalAppClient({
    async adoptArtifact(input) {
      adoptionCalls.push(input);
      if (input.artifactId === 'artifact:last-frame') throw new Error('last-frame adoption unavailable');
      return {
        relativePath: input.relativePath,
        mediaType: 'video/mp4',
        sizeBytes: 4096,
        sha256: `sha256:${'a'.repeat(64)}`,
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      };
    },
    async removeAsset(relativePath) {
      removalCalls.push(relativePath);
      return { removed: true };
    },
  });
  const result = await runTesterCapability({
    capabilityId: 'video.generate',
    prompt: 'ocean wave',
    parameters: { returnLastFrame: true },
  }, readyRuntimeDependencies(client, {
    createScenarioJobClient() { return { marker: 'job-client:video.generate' }; },
    runners: {
      async videoGenerate() {
        return {
          ok: true,
          capabilityId: 'video.generate',
          message: 'video.generate completed',
          output: {
            kind: 'video-artifacts',
            jobId: 'job:video-partial-adoption',
            jobStatus: 'COMPLETED',
            artifactCount: 2,
            firstArtifact: { artifactId: 'artifact:video', mimeType: 'video/mp4', previewSource: 'metadata-only' },
            artifacts: [
              { artifactId: 'artifact:video', mimeType: 'video/mp4', previewSource: 'metadata-only' },
              { artifactId: 'artifact:last-frame', mimeType: 'image/png', previewSource: 'metadata-only' },
            ],
          },
        };
      },
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.deepEqual(adoptionCalls.map((call) => call.artifactId), ['artifact:video', 'artifact:last-frame']);
  assert.deepEqual(removalCalls, [adoptionCalls[0].relativePath]);
});

test('Tester adopts metadata-only video without reading the source artifact body', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  let readCalls = 0;
  const client = fakeLocalAppClient({
    async readArtifact() {
      readCalls += 1;
      throw new Error('source artifact body must not be read');
    },
    async adoptArtifact(input) {
      return {
        relativePath: input.relativePath,
        mediaType: 'video/mp4',
        sizeBytes: 35 * 1024 * 1024,
        sha256: `sha256:${'b'.repeat(64)}`,
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
      };
    },
  });
  const result = await runTesterCapability({
    capabilityId: 'video.generate',
    prompt: 'ocean wave',
  }, readyRuntimeDependencies(client, {
    createScenarioJobClient() { return { marker: 'job-client:video.generate' }; },
    runners: {
      async videoGenerate() {
        return artifactRunnerSuccess('video.generate', 'video/mp4', undefined, 'metadata-only');
      },
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(result.output.kind, 'artifacts');
  assert.equal(result.output.firstArtifact.previewSource, 'managed-asset');
  assert.equal(result.output.firstArtifact.sizeBytes, 35 * 1024 * 1024);
  assert.equal(result.output.firstArtifact.mediaType, 'video/mp4');
  assert.equal(readCalls, 0);
});

test('Tester reports non-success when adoption fails and never falls back to artifact read', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  let readCalls = 0;
  const client = fakeLocalAppClient({
    async readArtifact() { readCalls += 1; },
    async adoptArtifact() { throw new Error('adoption unavailable'); },
  });
  const result = await runTesterCapability({
    capabilityId: 'video.generate',
    prompt: 'ocean wave',
  }, readyRuntimeDependencies(client, {
    createScenarioJobClient() { return { marker: 'job-client:video.generate' }; },
    runners: {
      async videoGenerate() {
        return artifactRunnerSuccess('video.generate', 'video/mp4', undefined, 'metadata-only');
      },
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime-call-failed');
  assert.equal(readCalls, 0);
});

test('Tester text.generate projects the protected Local App candidate happy path without sampling fallbacks', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const calls = [];
  const client = fakeLocalAppClient({
    async generateCandidate(input) {
      calls.push(input);
      return { text: 'generated text', finishReason: 'stop', traceId: 'trace-text' };
    },
  });
  const result = await runTesterCapability({ capabilityId: 'text.generate', prompt: 'hello' }, readyRuntimeDependencies(client));
  assert.deepEqual(calls, [{ messages: [{ role: 'user', text: 'hello' }] }]);
  assert.deepEqual(result.output, { kind: 'text', text: 'generated text', finishReason: 'stop', streamed: false });
  assert.equal(result.trace.traceId, 'trace-text');
});

test('Tester text.generate preserves the complete parameter set including explicit zero values', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const calls = [];
  const client = fakeLocalAppClient({
    async generateCandidate(input) {
      calls.push(input);
      return { text: 'generated text', finishReason: 'stop' };
    },
  });
  await runTesterCapability({
    capabilityId: 'text.generate',
    prompt: 'hello',
    parameters: { temperature: 0, topP: 0, maxTokens: 0, topK: 0, presencePenalty: 0, frequencyPenalty: 0, stop: ['END'], seed: 0 },
  }, readyRuntimeDependencies(client));
  assert.deepEqual(calls[0], {
    messages: [{ role: 'user', text: 'hello' }],
    temperature: 0, topP: 0, maxTokens: 0, topK: 0,
    presencePenalty: 0, frequencyPenalty: 0, stop: ['END'], seed: 0,
  });
});

test('Tester chat.stream runs the Kit streaming face and forwards accumulated partials', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const streamInputs = [];
  const partials = [];
  const client = fakeLocalAppClient({
    async streamTurn(input) {
      streamInputs.push(input);
      return localTextSubscription([
        { type: 'delta', sequence: '1', traceId: 'trace-stream', text: 'hello ' },
        { type: 'delta', sequence: '2', traceId: 'trace-stream', text: 'world' },
        { type: 'completed', sequence: '3', traceId: 'trace-stream', finishReason: 'stop' },
      ]);
    },
  });
  const result = await runTesterCapability({
    capabilityId: 'chat.stream',
    prompt: 'say hello',
    scenarioId: 'chat-1',
    onPartial(value) { partials.push(value); },
    parameters: { temperature: 0, topP: 0, maxTokens: 0, topK: 0, presencePenalty: 0, frequencyPenalty: 0, stop: ['END'], seed: 0 },
  }, readyRuntimeDependencies(client));

  assert.equal(result.ok, true);
  assert.deepEqual(result.output, { kind: 'text', text: 'hello world', finishReason: 'stop', streamed: true });
  assert.deepEqual(partials, ['hello ', 'hello world']);
  assert.equal(streamInputs[0].messages.at(-1).text, 'say hello');
  assert.deepEqual({ ...streamInputs[0], messages: undefined }, {
    messages: undefined,
    temperature: 0, topP: 0, maxTokens: 0, topK: 0,
    presencePenalty: 0, frequencyPenalty: 0, stop: ['END'], seed: 0,
  });
});

test('Tester text.embed executes the closed Local App scenario face and projects vectors', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const calls = [];
  const client = fakeLocalAppClient({
    async executeScenario(spec) {
      calls.push(spec);
      return { output: { type: 'text-embed', vectors: [[0.1, 0.2, 0.3]] }, traceId: 'trace-embed' };
    },
  });
  const result = await runTesterCapability({
    capabilityId: 'text.embed',
    prompt: 'embed me',
    parameters: { inputs: ['first', ' second '] },
  }, readyRuntimeDependencies(client));
  assert.deepEqual(calls, [{ type: 'text-embed', inputs: ['first', 'second'] }]);
  assert.deepEqual(result.output, { kind: 'embedding', vectorCount: 1, dimensions: 3, sample: [0.1, 0.2, 0.3] });
});

test('Tester audio.transcribe supplies inferred MIME and projects the Kit transcript', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const client = fakeLocalAppClient();
  const jobClient = { marker: 'transcribe-job-client' };
  const calls = [];
  const result = await runTesterCapability({
    capabilityId: 'audio.transcribe',
    prompt: 'https://example.test/sample.wav',
    scenarioId: 'stt-1',
  }, readyRuntimeDependencies(client, {
    createScenarioJobClient() { return jobClient; },
    runners: {
      async speechTranscribe(input) {
        calls.push(input);
        return {
          ok: true,
          capabilityId: 'audio.transcribe',
          message: 'transcribed',
          output: { kind: 'transcript', text: 'hello audio', jobId: 'job-stt', jobStatus: 'COMPLETED', artifactCount: 1 },
          trace: { traceId: 'trace-stt' },
        };
      },
    },
  }));
  assert.equal(calls[0].runtime.ai, jobClient);
  assert.equal(calls[0].audioUrl, 'https://example.test/sample.wav');
  assert.equal(calls[0].mimeType, 'audio/wav');
  assert.deepEqual(result.output, { kind: 'transcript', text: 'hello audio', jobId: 'job-stt', jobState: 'COMPLETED', artifactCount: 1 });
});

test('Tester audio.transcribe forwards local bytes and the complete transcription parameters', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const client = fakeLocalAppClient();
  const calls = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await runTesterCapability({
    capabilityId: 'audio.transcribe',
    prompt: '',
    scenarioId: 'stt-bytes',
    parameters: {
      audioFile: { name: 'sample.wav', mimeType: 'audio/wav', sizeBytes: bytes.byteLength, bytes },
      mimeType: 'audio/custom', language: 'zh', timestamps: false, diarization: true,
      speakerCount: 0, prompt: 'names', responseFormat: 'verbose_json',
    },
  }, readyRuntimeDependencies(client, {
    createScenarioJobClient() { return {}; },
    runners: {
      async speechTranscribe(input) {
        calls.push(input);
        return {
          ok: true, capabilityId: 'audio.transcribe', message: 'transcribed',
          output: { kind: 'transcript', text: 'hello', jobId: 'job', jobStatus: 'COMPLETED', artifactCount: 0 },
        };
      },
    },
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].audio, { type: 'bytes', bytes, mimeType: 'audio/custom' });
  assert.equal(calls[0].timestamps, false);
  assert.equal(calls[0].diarization, true);
  assert.equal(calls[0].speakerCount, 0);
  assert.equal(calls[0].prompt, 'names');
  assert.equal(calls[0].responseFormat, 'verbose_json');
});

test('Tester voice.create submits reference audio, waits for the Job, and verifies the VoiceAsset catalog projection', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const source = 'reference-audio';
  const asset = localVoiceAsset(source);
  const submitted = localVoiceJob('submitted', source);
  const completed = localVoiceJob('completed', source);
  const calls = [];
  const client = fakeLocalAppClient({
    async submitScenarioJob(spec) {
      calls.push(['submit', spec]);
      return { job: submitted };
    },
    async subscribeScenarioJob(jobId) {
      calls.push(['subscribe', jobId]);
      return localScenarioJobSubscription([{ eventType: 'completed', sequence: '1', traceId: completed.traceId, timestamp: null, job: completed }]);
    },
    async getScenarioJob(jobId) {
      calls.push(['get', jobId]);
      return {
        job: completed,
        asset,
        voiceReference: { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId },
      };
    },
    async listVoiceAssets(input) {
      calls.push(['list', input]);
      return { assets: [asset], nextPageToken: '' };
    },
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await runTesterCapability({
    capabilityId: 'voice.create',
    prompt: '你好，欢迎来到 Nimi。',
    parameters: {
      creationSource: source,
      referenceAudioFile: { name: 'reference.wav', mimeType: 'audio/wav', sizeBytes: bytes.byteLength, bytes },
      languageHints: 'zh, en',
      preferredName: 'Nimi reference voice',
    },
  }, readyRuntimeDependencies(client));
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['submit', {
    type: 'voice-create',
    creationSource: source,
    referenceAudio: { type: 'bytes', bytes: [1, 2, 3] },
    referenceAudioMime: 'audio/wav',
    languageHints: ['zh', 'en'],
    preferredName: 'Nimi reference voice',
    text: '你好，欢迎来到 Nimi。',
  }]);
  assert.deepEqual(calls.slice(1), [['subscribe', submitted.jobId], ['get', submitted.jobId], ['list', { pageSize: 100 }]]);
  assert.deepEqual(result.output, {
    kind: 'voice-asset', jobId: completed.jobId, jobState: 'completed', voiceAssetId: asset.voiceAssetId,
    creationSource: source, assetStatus: 'active', voiceReference: { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId },
  });
  assert.equal(result.trace.traceId, completed.traceId);
});

test('Tester voice.create submits a text description through the same canonical contract', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const source = 'text-description';
  const asset = localVoiceAsset(source);
  const completed = localVoiceJob('completed', source);
  const submitted = localVoiceJob('submitted', source);
  const calls = [];
  const client = fakeLocalAppClient({
    async submitScenarioJob(spec) {
      calls.push(['submit', spec]);
      return { job: submitted };
    },
    async subscribeScenarioJob(jobId) {
      calls.push(['subscribe', jobId]);
      return localScenarioJobSubscription([{ eventType: 'completed', sequence: '1', traceId: completed.traceId, timestamp: null, job: completed }]);
    },
    async getScenarioJob(jobId) {
      calls.push(['get', jobId]);
      return {
        job: completed,
        asset,
        voiceReference: { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId },
      };
    },
    async listVoiceAssets(input) {
      calls.push(['list', input]);
      return { assets: [asset], nextPageToken: '' };
    },
  });
  const result = await runTesterCapability({
    capabilityId: 'voice.create',
    prompt: 'Warm, clear Mandarin female voice with a calm and friendly delivery.',
    parameters: {
      creationSource: source,
      previewText: '你好，我是 Nimi。',
      language: 'zh',
      preferredName: 'Nimi designed voice',
    },
  }, readyRuntimeDependencies(client));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['submit', {
      type: 'voice-create',
      creationSource: source,
      instructionText: 'Warm, clear Mandarin female voice with a calm and friendly delivery.',
      previewText: '你好，我是 Nimi。',
      language: 'zh',
      preferredName: 'Nimi designed voice',
    }],
	['subscribe', completed.jobId],
    ['get', completed.jobId],
    ['list', { pageSize: 100 }],
  ]);
  assert.equal(result.output.kind, 'voice-asset');
  assert.equal(result.output.voiceAssetId, asset.voiceAssetId);
  assert.equal(result.output.creationSource, source);
});

test('Tester voice.create fails closed when the Job stream ends before a terminal event', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const source = 'text-description';
  const submitted = localVoiceJob('submitted', source);
  const running = localVoiceJob('running', source);
  let gets = 0;
  const client = fakeLocalAppClient({
    async submitScenarioJob() { return { job: submitted }; },
    async subscribeScenarioJob() {
      return localScenarioJobSubscription([{ eventType: 'running', sequence: '1', traceId: running.traceId, timestamp: null, job: running }]);
    },
    async getScenarioJob() {
      gets += 1;
      throw new Error('terminal Get must not run without a terminal event');
    },
  });
  const result = await runTesterCapability({
    capabilityId: 'voice.create',
    prompt: 'Warm, clear Mandarin voice.',
    parameters: { creationSource: source, previewText: '你好', language: 'zh', preferredName: 'Nimi voice' },
  }, readyRuntimeDependencies(client));
  assert.equal(result.ok, false);
  assert.equal(gets, 0);
  assert.match(result.message, /without a terminal event/i);
});

for (const status of ['failed', 'canceled', 'timeout']) {
  test(`Tester voice.create preserves the ${status} terminal reason without Get`, async () => {
    const { runTesterCapability } = await importTesterRuntime();
    const source = 'text-description';
    const submitted = localVoiceJob('submitted', source);
    const reasonCode = status === 'canceled'
      ? 'ACTION_EXECUTED'
      : status === 'timeout'
        ? 'AI_PROVIDER_TIMEOUT'
        : 'AI_PROVIDER_INTERNAL';
    const terminal = localVoiceJob(status, source, {
      reasonCode,
      reasonDetail: `voice terminal ${status}`,
    });
    let gets = 0;
    const client = fakeLocalAppClient({
      async submitScenarioJob() { return { job: submitted }; },
      async subscribeScenarioJob() {
        return localScenarioJobSubscription([{
          eventType: status,
          sequence: '1',
          traceId: terminal.traceId,
          timestamp: null,
          job: terminal,
        }]);
      },
      async getScenarioJob() {
        gets += 1;
        throw new Error('terminal Get must run only after a COMPLETED event');
      },
    });
    const result = await runTesterCapability({
      capabilityId: 'voice.create',
      prompt: 'Warm, clear Mandarin voice.',
      parameters: { creationSource: source, previewText: '你好', language: 'zh', preferredName: 'Nimi voice' },
    }, readyRuntimeDependencies(client));
    assert.equal(result.ok, false);
    assert.equal(result.reason, status === 'canceled'
      ? 'runtime-canceled'
      : status === 'timeout'
        ? 'runtime-timeout'
        : 'runtime-call-failed');
    assert.equal(gets, 0);
    assert.match(result.message, new RegExp(`voice terminal ${status}`, 'u'));
    assert.match(result.message, new RegExp(reasonCode, 'u'));
  });
}

test('Tester speech.bundle runs the Kit voice catalog over the Local App list client', async () => {
  const { runTesterCapability } = await importTesterRuntime();
  const calls = [];
  const client = fakeLocalAppClient({
    async listVoiceAssets(input) {
      calls.push(input);
      return {
        assets: [{ voiceAssetId: 'voice-1', creationSource: 'reference-audio', status: 'active', createdAt: null, updatedAt: null, expiresAt: null }],
        nextPageToken: '',
      };
    },
  });
  const result = await runTesterCapability({ capabilityId: 'speech.bundle', prompt: '' }, readyRuntimeDependencies(client));
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ pageSize: 100, pageToken: '' }]);
  assert.deepEqual(result.output, {
    kind: 'voice-catalog',
    voiceCount: 1,
    sample: [{ voiceId: 'voice-1', creationSource: 'REFERENCE_AUDIO', status: 'ACTIVE' }],
  });
});

const TYPED_FAILURE_CASES = [
  {
    capabilityId: 'text.generate',
    prompt: 'hello',
    expectedReason: 'runtime-call-failed',
    client: () => fakeLocalAppClient({
      async generateCandidate() { throw Object.assign(new Error('text failed'), { reasonCode: 'TEXT_FAILED' }); },
    }),
  },
  {
    capabilityId: 'chat.stream',
    prompt: 'hello',
    expectedReason: 'runtime-call-failed',
    client: () => fakeLocalAppClient({
      async streamTurn() {
        return localTextSubscription([{ type: 'failed', sequence: '1', traceId: 'trace', reasonCode: 'STREAM_FAILED', actionHint: 'retry stream' }]);
      },
    }),
  },
  {
    capabilityId: 'text.embed',
    prompt: 'hello',
    expectedReason: 'runtime-call-failed',
    client: () => fakeLocalAppClient({
      async executeScenario() { throw Object.assign(new Error('embed failed'), { reasonCode: 'EMBED_FAILED' }); },
    }),
  },
  { capabilityId: 'image.generate', prompt: 'image', expectedReason: 'input-invalid', runnerName: 'imageGenerate' },
  { capabilityId: 'video.generate', prompt: 'video', expectedReason: 'runtime-timeout', runnerName: 'videoGenerate' },
  { capabilityId: 'audio.synthesize', prompt: 'speech', expectedReason: 'principal-unauthorized', runnerName: 'speechSynthesize' },
  { capabilityId: 'audio.transcribe', prompt: 'https://example.test/audio.wav', expectedReason: 'runtime-call-failed', runnerName: 'speechTranscribe' },
  {
    capabilityId: 'voice.create',
    prompt: 'voice description',
    parameters: { creationSource: 'text-description' },
    expectedReason: 'runtime-call-failed',
    client: () => fakeLocalAppClient({
      async submitScenarioJob() { throw Object.assign(new Error('voice create failed'), { reasonCode: 'VOICE_CREATE_FAILED' }); },
    }),
  },
  {
    capabilityId: 'speech.bundle',
    prompt: '',
    expectedReason: 'runtime-call-failed',
    client: () => fakeLocalAppClient({
      async listVoiceAssets() { throw Object.assign(new Error('catalog failed'), { reasonCode: 'CATALOG_FAILED' }); },
    }),
  },
];

for (const failureCase of TYPED_FAILURE_CASES) {
  test(`Tester ${failureCase.capabilityId} preserves a typed failure projection`, async () => {
    const { runTesterCapability } = await importTesterRuntime();
    const client = failureCase.client?.() ?? fakeLocalAppClient();
    const runner = async () => ({
      ok: false,
      capabilityId: failureCase.capabilityId,
      reason: failureCase.expectedReason,
      message: `${failureCase.capabilityId} typed failure`,
      error: {
        reasonCode: 'TYPED_FAILURE',
        actionHint: 'inspect_typed_failure',
        traceId: 'trace-typed-failure',
        retryable: true,
        source: 'runtime',
      },
    });
    const dependencies = readyRuntimeDependencies(client, failureCase.runnerName ? {
      createScenarioJobClient() { return {}; },
      runners: { [failureCase.runnerName]: runner },
    } : {});
    const result = await runTesterCapability({ capabilityId: failureCase.capabilityId, prompt: failureCase.prompt, parameters: failureCase.parameters }, dependencies);
    assert.equal(result.ok, false);
    assert.equal(result.reason, failureCase.expectedReason);
    assert.match(result.message, /failed|failure|retry/iu);
    if (failureCase.runnerName) {
      assert.deepEqual(result.diagnostics, {
        reasonCode: 'TYPED_FAILURE',
        actionHint: 'inspect_typed_failure',
        traceId: 'trace-typed-failure',
        retryable: true,
        source: 'runtime',
      });
    }
  });
}
