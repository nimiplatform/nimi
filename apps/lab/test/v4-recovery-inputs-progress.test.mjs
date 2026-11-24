import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const kitRequire = createRequire(path.resolve(root, '../../kit/package.json'));
const { JSDOM } = kitRequire('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
for (const key of [
  'window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement',
  'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'KeyboardEvent',
  'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'File', 'FileReader',
]) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TooltipProvider } = await import('@nimiplatform/kit/ui');

mkdirSync(path.join(root, '.tmp'), { recursive: true });
const buildDir = mkdtempSync(path.join(root, '.tmp', 'v4-lab-regression-'));

await build({
  stdin: {
    contents: `
      export * from './src/ai-studio-core/job-recovery.ts';
      export * from './src/ai-studio-core/non-success-presentation.ts';
      export * from './src/ai-studio-core/section-ai-testing-input.ts';
      export * from './src/ai-studio-core/text-media-replay.ts';
      export { runStudioCapability, createStudioScenarioJobClient, submitStudioLocalJob } from './src/ai-studio-core/runtime.ts';
      export { SectionAITesting } from './src/ai-studio-core/section-ai-testing.tsx';
      export { StudioResult } from './src/ai-studio-core/section-ai-testing-studio-result.tsx';
      export { AIStudioHostProvider } from './src/ai-studio-core/host-context.tsx';
      export { StudioCapabilityParameterContext } from './src/ai-studio-core/contexts.tsx';
      export { composeAIStudioModules } from './src/ai-studio-core/module-registration.ts';
      export { createStudioRunTargetSummary } from './src/ai-studio-core/run-target.ts';
      export { subscribeStudioAIConfigRefresh } from './src/ai-studio-core/ai-config.ts';
      export { studioMediaModule } from './src/studio-modules/studio-media/index.ts';
      export { studioMediaRuntimeHandlers } from './src/studio-modules/studio-media/runtime.ts';
      export { StudioMediaParameterPanel } from './src/studio-modules/studio-media/parameter-panel.tsx';
      export { labImageFaceSwapParameters, runLabImageFaceSwap } from './src/lab/lab-only/face-swap.ts';
      export { labTextExchangeParameters, runLabTextExchange } from './src/lab/lab-only/text-exchange.ts';
      export { LabTextExchangeParameterPanel } from './src/lab/lab-only/capability-test-panels.tsx';
      export { LabReasoningControls, parseLabReasoningBudgetDraft } from './src/lab/lab-only/reasoning-controls.tsx';
      export { LabRendererProvider } from './src/renderer/context.tsx';
      export { IntegrationAssetsPanel } from './src/lab/integrations/integration-assets-panel.tsx';
      export { clearRejectedWorldPending, WORLD_TOUR_RECOVERY_PREFIX } from './src/lab/world-tour/world-tour-runtime.ts';
      export { ScenarioType } from '@nimiplatform/sdk/runtime/generated';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  outfile: path.join(buildDir, 'bundle.mjs'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(path.join(buildDir, 'bundle.mjs')).href);

test.after(() => {
  dom.window.close();
  rmSync(buildDir, { recursive: true, force: true });
});

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256Tag = (bytes) => `sha256:${sha256Hex(bytes)}`;

function createCasAssetFixture(options = {}) {
  const entries = new Map();
  const removed = [];
  const pageSizeLimit = options.pageSize ?? 50;

  function put(relativePath, bytes, mediaType = 'application/json') {
    const buf = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new TextEncoder().encode(String(bytes));
    const asset = { relativePath, mediaType, sizeBytes: buf.byteLength, sha256: sha256Tag(buf) };
    entries.set(relativePath, { asset, bytes: buf });
    return structuredClone(asset);
  }

  const assets = {
    async list({ prefix = '', cursor = '' } = {}) {
      const matching = [...entries.values()]
        .filter((item) => item.asset.relativePath.startsWith(prefix))
        .map((item) => structuredClone(item.asset))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const afterCursor = cursor ? matching.filter((item) => item.relativePath > cursor) : matching;
      const slice = afterCursor.slice(0, pageSizeLimit);
      const nextCursor = afterCursor.length > pageSizeLimit ? slice[slice.length - 1].relativePath : '';
      return { assets: slice, nextCursor };
    },
    async stat(relativePath) {
      const found = entries.get(relativePath);
      if (!found) throw Object.assign(new Error('not found'), { code: 'not-found', reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });
      return structuredClone(found.asset);
    },
    async read({ relativePath }) {
      if (options.onBeforeRead) await options.onBeforeRead(relativePath);
      const found = entries.get(relativePath);
      if (!found) throw Object.assign(new Error('not found'), { code: 'not-found', reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' });
      return {
        asset: structuredClone(found.asset),
        range: { offset: 0, length: found.bytes.byteLength, totalSize: found.bytes.byteLength },
        body: (async function* () { yield new Uint8Array(found.bytes); })(),
      };
    },
    async write({ relativePath, body, mediaType, overwrite, expectedSha256 }) {
      if (options.onBeforeWrite) await options.onBeforeWrite({ relativePath, body, mediaType, overwrite, expectedSha256 });
      const buf = body instanceof Uint8Array ? new Uint8Array(body) : new TextEncoder().encode(String(body));
      const existing = entries.get(relativePath);
      if (expectedSha256 !== undefined) {
        if (existing?.asset.sha256 !== expectedSha256) {
          throw Object.assign(new Error('cas conflict'), { reasonCode: 'APP_STORAGE_CONFLICT' });
        }
      } else if (overwrite === false && existing) {
        throw Object.assign(new Error('already exists'), { reasonCode: 'APP_STORAGE_CONFLICT' });
      }
      const asset = { relativePath, mediaType, sizeBytes: buf.byteLength, sha256: sha256Tag(buf) };
      entries.set(relativePath, { asset, bytes: buf });
      return structuredClone(asset);
    },
    async remove(relativePath) {
      if (options.onRemove) return options.onRemove(relativePath, () => { removed.push(relativePath); return entries.delete(relativePath); });
      removed.push(relativePath);
      return { removed: entries.delete(relativePath) };
    },
  };

  return { entries, removed, put, assets };
}

test('two-phase CAS interleaving 1: concurrent jobId acknowledgement blocks pending->rejected deletion and preserves inputs', async () => {
  const sourceBytes = Uint8Array.of(1, 2, 3, 4);
  let aReadPause;
  let releaseARead;
  let paused = false;
  const fixture = createCasAssetFixture({
    async onBeforeWrite(input) {
      if (paused) return;
      const parsed = JSON.parse(new TextDecoder().decode(input.body));
      if (parsed.state === 'rejected') {
        paused = true;
        aReadPause.resolve();
        await releaseARead.promise;
      }
    },
  });
  const sourceAsset = fixture.put('studio/music/audio-separate-inputs/in-1/source.wav', sourceBytes, 'audio/wav');
  const sourceAudio = { ...sourceAsset, displayName: 'mix.wav', previewSource: 'managed-asset' };
  const id = await mod.beginStudioJobRecovery(fixture.assets, 'audio.separate', sourceAudio);

  aReadPause = Promise.withResolvers();
  releaseARead = Promise.withResolvers();
  const cleanupPromise = mod.cleanupRejectedStudioRecoveryEntry(fixture.assets, 'audio.separate', id);
  await aReadPause.promise;

  // Observer B acknowledges the same clientSubmissionId via lookupSubmission before A's CAS write executes.
  await mod.captureStudioJobRecoveryJobId(fixture.assets, id, 'job-real-123', 'audio.separate');
  releaseARead.resolve();

  const outcome = await cleanupPromise;
  assert.deepEqual(outcome, { removed: false, reason: 'cas-conflict' });
  const surviving = await mod.readStudioJobRecovery(fixture.assets, 'audio.separate');
  assert.equal(surviving.length, 1);
  assert.equal(surviving[0].state, 'acknowledged');
  assert.equal(surviving[0].jobId, 'job-real-123');
  assert.equal(fixture.entries.has(sourceAudio.relativePath), true, 'owned source input must remain intact');
});

test('two-phase CAS interleaving 2: once A wins pending->rejected CAS, B cannot acknowledge a jobId onto it', async () => {
  const removePaused = Promise.withResolvers();
  const releaseRemove = Promise.withResolvers();
  const fixture = createCasAssetFixture({
    async onRemove(relativePath, commit) {
      if (relativePath.startsWith('studio/recovery/')) {
        removePaused.resolve();
        await releaseRemove.promise;
      }
      return { removed: commit() };
    },
  });
  const id = await mod.beginStudioJobRecovery(fixture.assets, 'image.generate');

  const cleanupPromise = mod.forgetPendingStudioJobRecoveryIfUnacknowledged(fixture.assets, 'image.generate', id);
  await removePaused.promise;

  // Record is now state === 'rejected' on disk; B attempting to write jobId must fail closed.
  await assert.rejects(
    () => mod.captureStudioJobRecoveryJobId(fixture.assets, id, 'job-late', 'image.generate'),
    /already rejected or removed/u,
  );

  releaseRemove.resolve();
  const outcome = await cleanupPromise;
  assert.equal(outcome.removed, true);
  assert.equal((await mod.readStudioJobRecovery(fixture.assets, 'image.generate')).length, 0);
});

test('two-phase CAS interleaving 3: unconfirmed assets.remove never deletes owned input artifacts', async () => {
  for (const mode of ['false', 'throw']) {
    const fixture = createCasAssetFixture({
      async onRemove(relativePath, commit) {
        if (relativePath.startsWith('studio/recovery/')) {
          if (mode === 'throw') throw new Error('network lost during remove');
          return { removed: false };
        }
        return { removed: commit() };
      },
    });
    const sourceAsset = fixture.put('studio/music/audio-separate-inputs/in-2/source.wav', Uint8Array.of(9, 8, 7), 'audio/wav');
    const sourceAudio = { ...sourceAsset, displayName: 'src.wav', previewSource: 'managed-asset' };
    const id = await mod.beginStudioJobRecovery(fixture.assets, 'audio.separate', sourceAudio);

    const outcome = await mod.cleanupRejectedStudioRecoveryEntry(fixture.assets, 'audio.separate', id);
    assert.deepEqual(outcome, { removed: false, reason: 'remove-unconfirmed' });
    assert.equal(fixture.entries.has(sourceAudio.relativePath), true, `mode=${mode} must keep owned input when remove is unconfirmed`);
    // Rejected tombstone is hidden from active recovery listing.
    assert.equal((await mod.readStudioJobRecovery(fixture.assets, 'audio.separate')).length, 0);
  }
});

test('World Tour two-phase CAS conflict preserves concurrently acknowledged jobId', async () => {
  const config = {
    target: {
      capabilityId: 'world.generate', capabilityContract: 'world.generate', section: 'world',
      source: 'cloud', status: 'configured', detail: 'ok', intentLabel: 'Cloud',
      params: { inputMode: 'text' }, paramsSummary: [], profileOrigin: null,
    },
    promptControls: { context: '', contextAttached: false, attachmentCount: 0 },
  };
  const pending = {
    version: 2,
    id: 'world-cas-1',
    state: 'pending',
    clientSubmissionId: 'world-cas-1',
    request: {
      prompt: 'garden', generationPrompt: 'garden', createdAt: '2026-11-24T00:00:00.000Z',
      runConfig: config, inputMode: 'text',
    },
  };
  const recordPath = `${mod.WORLD_TOUR_RECOVERY_PREFIX}/world-cas-1.json`;
  const paused = Promise.withResolvers();
  const release = Promise.withResolvers();
  let blocked = false;
  const fixture = createCasAssetFixture({
    async onBeforeWrite(input) {
      if (blocked) return;
      const parsed = JSON.parse(new TextDecoder().decode(input.body));
      if (parsed.state === 'rejected') {
        blocked = true;
        paused.resolve();
        await release.promise;
      }
    },
  });
  fixture.put(recordPath, JSON.stringify(pending));
  const clearing = mod.clearRejectedWorldPending(fixture.assets, pending, { reasonCode: 'AI_LOCAL_ASSET_SLOT_MISSING' });
  await paused.promise;

  // Concurrent observer acknowledges the world job before A writes rejected.
  const current = fixture.entries.get(recordPath);
  const acked = { ...pending, state: 'acknowledged', jobId: 'world-job-77' };
  await fixture.assets.write({
    relativePath: recordPath,
    mediaType: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(acked)),
    overwrite: false,
    expectedSha256: current.asset.sha256,
  });
  release.resolve();

  const outcome = await clearing;
  assert.deepEqual(outcome, { removed: false });
  assert.equal(fixture.entries.has(recordPath), true);
  assert.equal(JSON.parse(new TextDecoder().decode(fixture.entries.get(recordPath).bytes)).jobId, 'world-job-77');
});

test('readStudioJobRecovery paginates beyond 100 entries across nextCursor and tolerates concurrent NOT_FOUND deletion', async () => {
  const vanishingPath = 'studio/recovery/image.generate/sub-042.json';
  const fixture = createCasAssetFixture({
    pageSize: 30,
    async onBeforeRead(relativePath) {
      if (relativePath === vanishingPath) {
        fixture.entries.delete(vanishingPath);
      }
    },
  });
  for (let i = 0; i < 105; i += 1) {
    const id = `sub-${String(i).padStart(3, '0')}`;
    const entry = {
      id,
      state: 'pending',
      clientSubmissionId: id,
      createdAt: new Date(Date.UTC(2026, 10, 24, 0, 0, i)).toISOString(),
    };
    fixture.put(`studio/recovery/image.generate/${id}.json`, JSON.stringify(entry));
  }
  const all = await mod.readStudioJobRecovery(fixture.assets, 'image.generate');
  assert.equal(all.length, 104);
  assert.equal(all[0].clientSubmissionId, 'sub-000');
  assert.equal(all[all.length - 1].clientSubmissionId, 'sub-104');
});

test('all 3 submission paths clean up only definite pre-admission rejections and preserve uncertain/post-ack records', async () => {
  // 1) createStudioScenarioJobClient (image.generate) + post-ack write failure preservation
  {
    const fixture = createCasAssetFixture();
    const mkContext = (submitImpl) => ({
      capability: { id: 'image.generate', label: 'Image', missingSurface: 'ai.scenarioJobs.submit' },
      input: { capabilityId: 'image.generate', prompt: 'canny test' },
      prompt: 'canny test',
      scenarioId: 'sc-1',
      host: {
        appId: 'nimi.lab',
        surfaceId: 'lab',
        abortReason: 'cancel',
        translate: (key) => key,
        client: {
          storage: { assets: fixture.assets },
          ai: { scenarioJobs: { submit: submitImpl } },
        },
        createScenarioJobClient: (ai) => ({
          async submitScenarioJob(req) {
            return ai.scenarioJobs.submit(req, {});
          },
        }),
        runners: {},
        nonSuccess: (cap, reason, message) => ({ ok: false, capabilityId: cap.id, reason, message, actionHint: '', missingSurface: cap.missingSurface }),
      },
    });

    // Keep an earlier acknowledged record untouched while a new Canny call hits AI_LOCAL_ASSET_SLOT_MISSING
    const earlierId = await mod.beginStudioJobRecovery(fixture.assets, 'image.generate');
    await mod.captureStudioJobRecoveryJobId(fixture.assets, earlierId, 'job-earlier', 'image.generate');

    const slotMissingClient = mod.createStudioScenarioJobClient(mkContext(async () => {
      throw Object.assign(new Error('companion.controlnet missing'), { reasonCode: 'AI_LOCAL_ASSET_SLOT_MISSING' });
    }));
    await assert.rejects(() => slotMissingClient.submitScenarioJob({ scenarioType: mod.ScenarioType.IMAGE_GENERATE }), /controlnet/u);
    const afterSlotMissing = await mod.readStudioJobRecovery(fixture.assets, 'image.generate');
    assert.deepEqual(afterSlotMissing.map((item) => item.clientSubmissionId), [earlierId]);

    // PROTOCOL_ENVELOPE_INVALID must NOT remove the recovery record
    const envelopeClient = mod.createStudioScenarioJobClient(mkContext(async () => {
      throw Object.assign(new Error('envelope invalid'), { reasonCode: 'PROTOCOL_ENVELOPE_INVALID' });
    }));
    await assert.rejects(() => envelopeClient.submitScenarioJob({ scenarioType: mod.ScenarioType.IMAGE_GENERATE }), /envelope/u);
    assert.equal((await mod.readStudioJobRecovery(fixture.assets, 'image.generate')).length, 2);

    // Post-acknowledgement local write failure must NOT delete the recovery record
    let failSecondWrite = false;
    const origWrite = fixture.assets.write.bind(fixture.assets);
    fixture.assets.write = async (input) => {
      const parsed = JSON.parse(new TextDecoder().decode(input.body));
      if (failSecondWrite && parsed.state === 'acknowledged') {
        throw new Error('local storage unavailable after submit ack');
      }
      return origWrite(input);
    };
    failSecondWrite = true;
    const postAckClient = mod.createStudioScenarioJobClient(mkContext(async () => ({ job: { jobId: 'job-acked-99' } })));
    await assert.rejects(() => postAckClient.submitScenarioJob({ scenarioType: mod.ScenarioType.IMAGE_GENERATE }), /local storage unavailable/u);
    assert.equal((await mod.readStudioJobRecovery(fixture.assets, 'image.generate')).length, 3);
  }

  // 2) submitStudioLocalJob (image.face_swap)
  {
    const fixture = createCasAssetFixture();
    const mkContext = (reasonCode) => ({
      capability: { id: 'image.face_swap', label: 'Face Swap', missingSurface: 'ai.scenarioJobs.submit' },
      input: { capabilityId: 'image.face_swap', prompt: '' },
      prompt: '',
      scenarioId: 'sc-fs',
      host: {
        appId: 'nimi.lab',
        surfaceId: 'lab',
        abortReason: 'cancel',
        translate: (key) => key,
        client: {
          storage: { assets: fixture.assets },
          ai: {
            scenarioJobs: {
              async submit() {
                throw Object.assign(new Error(reasonCode), { reasonCode });
              },
            },
          },
        },
        createScenarioJobClient: (ai) => ai,
        runners: {},
        nonSuccess: (cap, reason, message) => ({ ok: false, capabilityId: cap.id, reason, message, actionHint: '', missingSurface: cap.missingSurface }),
      },
    });
    await assert.rejects(() => mod.submitStudioLocalJob(mkContext('AI_LOCAL_ASSET_SLOT_MISSING'), { type: 'image-face-swap' }, { scenarioType: mod.ScenarioType.IMAGE_FACE_SWAP }));
    assert.equal((await mod.readStudioJobRecovery(fixture.assets, 'image.face_swap')).length, 0);

    await assert.rejects(() => mod.submitStudioLocalJob(mkContext('PROTOCOL_ENVELOPE_INVALID'), { type: 'image-face-swap' }, { scenarioType: mod.ScenarioType.IMAGE_FACE_SWAP }));
    assert.equal((await mod.readStudioJobRecovery(fixture.assets, 'image.face_swap')).length, 1);
  }

  // 3) audio.separate uninvoked runner rejection cleans up record + owned source; post-submit runner failure retains both
  {
    for (const invokeSubmit of [false, true]) {
      const fixture = createCasAssetFixture();
      const inputWav = fixture.put('input/song.wav', Uint8Array.of(1, 2, 3, 4), 'audio/wav');
      const client = {
        aiConfig: {
          async get() {
            return { effectiveSelections: [{ capabilityContract: 'audio.separate', state: 'ready', resource: { oneofKind: 'local', local: {} } }] };
          },
        },
        storage: {
          assets: {
            ...fixture.assets,
            async adoptArtifact({ relativePath }) {
              return fixture.put(relativePath, Uint8Array.of(5, 6, 7, 8), 'audio/wav');
            },
          },
        },
        ai: {
          artifacts: {
            async upload() {
              return {
                artifactId: 'art-pcm', mimeType: 'audio/wav', sizeBytes: 4,
                audioInfo: { sampleRateHz: 44100, channels: 2, frameCount: 44100, durationMs: 1000 },
              };
            },
          },
          scenarioJobs: {
            async submit() {
              return { job: { jobId: 'sep-job-1' } };
            },
          },
        },
      };
      let capturedAi;
      const result = await mod.runStudioCapability({
        capabilityId: 'audio.separate',
        prompt: '',
        parameters: { sourceRelativePath: inputWav.relativePath, sourceMimeType: 'audio/wav' },
      }, {
        appId: 'nimi.lab',
        surfaceId: 'lab',
        abortReason: 'cancel',
        translate: (key) => key,
        handlers: mod.studioMediaRuntimeHandlers,
        resolveCapability: () => ({ id: 'audio.separate', label: 'Separate', missingSurface: 'audio.separate' }),
        inspectRuntime: async () => ({ status: 'connected', mode: 'electron-local-app', detail: 'ok' }),
        getClient: () => client,
        createScenarioId: () => 'sc-sep',
        createScenarioJobClient: (ai) => { capturedAi = ai; return ai; },
        runners: {
          async audioSeparate() {
            if (invokeSubmit) await capturedAi.scenarioJobs.submit({ type: 'audio-separate' }, {});
            return {
              ok: false,
              reason: 'input-invalid',
              message: 'invalid input',
              error: Object.assign(new Error('invalid input'), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' }),
            };
          },
        },
        nonSuccess: (cap, reason, message, diagnostics) => ({ ok: false, capabilityId: cap.id, reason, message, actionHint: '', missingSurface: cap.missingSurface, diagnostics }),
      });
      assert.equal(result.ok, false);
      const remaining = await mod.readStudioJobRecovery(fixture.assets, 'audio.separate');
      const adoptedSources = [...fixture.entries.keys()].filter((p) => p.startsWith('studio/music/audio-separate-inputs/'));
      if (!invokeSubmit) {
        assert.equal(remaining.length, 0, 'uninvoked runner rejection must clean up recovery record');
        assert.equal(adoptedSources.length, 0, 'uninvoked runner rejection must reclaim owned source audio');
      } else {
        assert.equal(remaining.length, 1, 'post-submit failure must keep recovery record');
        assert.equal(adoptedSources.length, 1, 'post-submit failure must keep owned source audio');
      }
    }
  }

  // 4) non-success presentation maps AI_LOCAL_ASSET_SLOT_MISSING to target reselection
  const diag = { reasonCode: 'AI_LOCAL_ASSET_SLOT_MISSING' };
  assert.equal(mod.studioNonSuccessNeedsTargetReselection(diag), true);
  assert.equal(mod.studioNonSuccessReasonUserMessage('runtime-call-failed', (k) => k, 'image.generate', diag), 'NonSuccess.message.localAssetSlotMissing');
  assert.equal(mod.studioNonSuccessReasonUserAction('runtime-call-failed', (k) => k, 'image.generate', diag), 'NonSuccess.action.localAssetSlotMissing');
  assert.equal(mod.isDefiniteStudioPreAdmissionRejection('vision.locate', { reasonCode: 'AI_MEDIA_OPTION_UNSUPPORTED' }), true);
  assert.equal(mod.isDefiniteStudioPreAdmissionRejection('image.generate', { reasonCode: 'AI_MEDIA_OPTION_UNSUPPORTED' }), false);
});

test('IntegrationAssetsPanel hides internal studio/recovery/ records from user asset management', async () => {
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const bindings = {
    sdk: {
      localAppClient: {
        storage: {
          assets: {
            async list() {
              return {
                assets: [
                  { relativePath: 'studio/recovery/image.generate/sub-1.json', mediaType: 'application/json', sizeBytes: 120, sha256: 'sha256:' + 'a'.repeat(64) },
                  { relativePath: 'media/image-generate/abc/result.png', mediaType: 'image/png', sizeBytes: 4096, sha256: 'sha256:' + 'b'.repeat(64) },
                ],
                nextCursor: '',
              };
            },
            async remove() { return { removed: true }; },
          },
        },
      },
    },
  };
  try {
    await act(async () => {
      renderer.render(createElement(mod.LabRendererProvider, { bindings }, createElement(mod.IntegrationAssetsPanel, { busy: false, setAssetBusy: () => {} })));
    });
    const loadBtn = container.querySelector('button');
    assert.ok(loadBtn);
    await act(async () => { loadBtn.click(); await new Promise((r) => setTimeout(r, 0)); });
    assert.match(container.textContent, /media\/image-generate\/abc\/result\.png/u);
    assert.doesNotMatch(container.textContent, /studio\/recovery/u);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('vision.locate cleans up freshly adopted sourceImage on pre-submit abort and on AI_MEDIA_OPTION_UNSUPPORTED', async () => {
  for (const scenario of ['pre-begin-failure', 'write-receipt-lost', 'option-unsupported']) {
    const fixture = createCasAssetFixture();
    const client = {
      storage: {
        assets: {
          ...fixture.assets,
          async adoptArtifact({ relativePath }) {
            return fixture.put(relativePath, Uint8Array.of(1, 2, 3), 'image/png');
          },
          async list(input) {
            if (scenario === 'pre-begin-failure' && input.prefix.startsWith('studio/recovery/')) throw new Error('recovery inventory unavailable');
            return fixture.assets.list(input);
          },
          async write(input) {
            const result = await fixture.assets.write(input);
            if (scenario === 'write-receipt-lost') throw new Error('write receipt timed out');
            return result;
          },
        },
      },
      ai: {
        artifacts: {
          async upload() { return { artifactId: 'art-vis-1', mimeType: 'image/png', sizeBytes: 3 }; },
        },
        scenarioJobs: {
          async submit() {
            throw Object.assign(new Error('geometry unsupported'), { reasonCode: 'AI_MEDIA_OPTION_UNSUPPORTED' });
          },
        },
      },
    };
    const result = await mod.runStudioCapability({
      capabilityId: 'vision.locate',
      prompt: 'find button',
      parameters: { geometry: 'point' },
      attachments: [{ id: 'img-1', kind: 'image', name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID' }],
    }, {
      appId: 'nimi.lab',
      surfaceId: 'lab',
      abortReason: 'cancel',
      translate: (key) => key,
      handlers: mod.studioMediaRuntimeHandlers,
      resolveCapability: () => ({ id: 'vision.locate', label: 'Locate', missingSurface: 'vision.locate' }),
      inspectRuntime: async () => ({ status: 'connected', mode: 'electron-local-app', detail: 'ok' }),
      getClient: () => client,
      createScenarioId: () => 'sc-vis',
      createScenarioJobClient: (ai) => ({
        async submitScenarioJob(req) { return ai.scenarioJobs.submit(req, {}); },
      }),
      nonSuccess: (cap, reason, message, diagnostics) => ({ ok: false, capabilityId: cap.id, reason, message, actionHint: '', missingSurface: cap.missingSurface, diagnostics }),
    });
    assert.equal(result.ok, false);
    const adoptedSources = [...fixture.entries.keys()].filter((p) => p.startsWith('media/vision-locate-source/'));
    const records = await mod.readStudioJobRecovery(fixture.assets, 'vision.locate');
    if (scenario === 'write-receipt-lost') {
      assert.equal(records.length, 1);
      assert.equal(records[0].state, 'pending');
      assert.deepEqual(adoptedSources, [records[0].details.sourceImage.relativePath]);
    } else {
      assert.equal(adoptedSources.length, 0, `${scenario} must reclaim freshly adopted sourceImage`);
      assert.equal(records.length, 0);
    }
  }
});

test('STUDIO_TEXT_MEDIA_MIMES and readStudioTextReplayMedia accept PNG/WebP/GIF with matching extensions and reject BMP', async () => {
  assert.deepEqual([...mod.STUDIO_TEXT_MEDIA_MIMES], [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/wav', 'audio/mpeg', 'video/mp4',
  ]);
  assert.equal(mod.studioTextMediaExtension('image/png'), 'png');
  assert.equal(mod.studioTextMediaExtension('image/webp'), 'webp');
  assert.equal(mod.studioTextMediaExtension('image/gif'), 'gif');
  assert.equal(mod.studioTextMediaExtension('image/jpeg'), 'jpg');
  assert.equal(mod.isSupportedStudioTextMediaMime('image/bmp'), false);

  const fixture = createCasAssetFixture();
  for (const [mimeType, ext] of [['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']]) {
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const saved = fixture.put(`studio/text-generate-inputs/sample.${ext}`, bytes, mimeType);
    const attachment = await mod.readStudioTextReplayMedia(
      fixture.assets,
      { ...saved, displayName: `sample.${ext}`, previewSource: 'managed-asset' },
      new AbortController().signal,
    );
    assert.equal(attachment.mimeType, mimeType);
    assert.match(attachment.dataUrl, new RegExp(`^data:${mimeType};base64,`, 'u'));
  }

  const bmp = fixture.put('studio/text-generate-inputs/bad.bmp', Uint8Array.of(0x42, 0x4d), 'image/bmp');
  await assert.rejects(
    () => mod.readStudioTextReplayMedia(fixture.assets, { ...bmp, displayName: 'bad.bmp', previewSource: 'managed-asset' }, new AbortController().signal),
    /invalid/u,
  );
});

test('LabReasoningControls strictly validates budget drafts, blocks invalid submissions, and avoids fabricating budget when unsupported', async () => {
  assert.equal(mod.parseLabReasoningBudgetDraft('1'), 1);
  assert.equal(mod.parseLabReasoningBudgetDraft('1024'), 1024);
  assert.equal(mod.parseLabReasoningBudgetDraft('4294967295'), 4294967295);
  for (const bad of ['', '   ', '0', '-5', '1.5', '4294967296', 'abc', '1e3']) {
    assert.equal(mod.parseLabReasoningBudgetDraft(bad), null, `expected "${bad}" to be rejected`);
  }

  assert.equal(mod.labTextExchangeParameters.requiredInputIssue({ scenario: 'tool-call', delivery: 'sync', reasoningDraftInvalid: true }), 'CapabilityTests.reasoning.budgetInvalid');
  assert.deepEqual(mod.labTextExchangeParameters.summarize({ scenario: 'tool-call', delivery: 'sync', reasoningDraftInvalid: true }), { scenario: 'tool-call', delivery: 'sync' });

  const container = document.getElementById('root');
  const renderer = createRoot(container);
  let currentValue = { activation: 'required', presentation: 'hidden', exactBudgetTokens: 1024 };
  const changes = [];
  const validities = [];
  const budgetSupport = {
    followsModelDefault: true,
    supportsDisabled: true,
    supportsRequired: true,
    supportsAdaptive: false,
    efforts: [],
    supportsBudget: true,
    presentations: ['hidden', 'summary'],
  };
  const mkBindings = (reasoningInput) => ({
    sdk: {
      localAppClient: {
        aiConfig: {
          async get() {
            return {
              config: null,
              revision: '1',
              effectiveSelections: [{ capabilityContract: 'text.generate', state: 'ready', reasoningInput, resource: null, reasons: [] }],
            };
          },
        },
      },
    },
  });
  const renderControls = (bindings) => renderer.render(
    createElement(mod.LabRendererProvider, { bindings },
      createElement(mod.LabReasoningControls, {
        value: currentValue,
        onChange: (next) => { currentValue = next; changes.push(next); },
        onValidityChange: (valid) => validities.push(valid),
      }),
    ),
  );
  try {
    const bindings = mkBindings(budgetSupport);
    await act(async () => { renderControls(bindings); await new Promise((r) => setTimeout(r, 0)); });
    const input = container.querySelector('input');
    assert.ok(input);
    assert.equal(input.value, '1024');
    // Simulate clearing the budget input (empty string -> invalid)
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.equal(changes.length, 0, 'invalid draft must never emit NaN/0/undefined');
    assert.equal(validities[validities.length - 1], false);
    assert.ok(container.querySelector('[role="alert"]'));
    // Click explicit reset-to-default button
    const resetBtn = [...container.querySelectorAll('button')].find((btn) => btn.textContent.trim().length > 0 && !btn.hasAttribute('role'));
    assert.ok(resetBtn);
    await act(async () => { resetBtn.click(); renderControls(bindings); });
    assert.equal(currentValue, undefined);
    assert.equal(validities[validities.length - 1], true);

    // Model with supportsRequired: true but efforts: [] and supportsBudget: false must not fabricate exactBudgetTokens
    const noIntensityBindings = mkBindings({ ...budgetSupport, supportsBudget: false });
    await act(async () => { renderControls(noIntensityBindings); await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(container.querySelector('input'), null);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('ImageFields posture differentiates slot-missing vs unsupported vs ready, and StudioResult renders 0% of 21 steps accurately', async () => {
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const composition = mod.composeAIStudioModules([mod.studioMediaModule]);
  const imageRegistration = composition.getCapability('image.generate');
  const host = {
    appTitle: 'Lab',
    translate: (key, values) => values ? `${key}:${JSON.stringify(values)}` : key,
    locale: 'en',
    clock: { now: () => Date.UTC(2026, 10, 24) },
    app: {
      projection: { assetExportAction: () => 'reveal', promptDraft: async () => ({ prompt: '' }), projectRunTarget: mod.createStudioRunTargetSummary, runStatusLabel: (s) => s },
      events: { subscribeAIConfigRefresh: () => () => {} },
      commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => ({ ok: true }), exportAsset: async () => {}, openAssetMediaUrl: async () => ({ url: '', revoke: async () => {} }) },
    },
    sdk: {
      runCapability: async () => ({ ok: false }),
      deleteLocalAppVoiceAsset: async () => ({ deleted: true }),
      listLocalAppVoiceAssets: async () => [],
      uploadLocalAppArtifact: async () => ({ artifactId: 'a', sizeBytes: 1, mimeType: 'image/png' }),
      assets: { list: async () => ({ assets: [], nextCursor: '' }), read: async () => {}, stat: async () => {}, write: async () => {}, remove: async () => ({ removed: true }), adoptArtifact: async () => {} },
      storage: { readJson: async () => ({ value: [] }), writeJson: async () => {} },
      aiConfig: { getSnapshot: async () => ({ config: null, revision: '1', effectiveSelections: [] }), get: async () => null },
    },
  };

  try {
    // 1) ImageFields slot-missing posture (SDXL Base without ControlNet)
    await act(async () => {
      renderer.render(createElement(TooltipProvider, null, createElement(mod.AIStudioHostProvider, { value: host },
        createElement(mod.StudioMediaParameterPanel, {
          capabilityId: 'image.generate',
          contract: imageRegistration.parameters,
          source: 'local',
          effectiveSelection: {
            capabilityContract: 'image.generate',
            state: 'ready',
            reasons: [],
            resource: {
              oneofKind: 'local',
              local: {
                loadoutRef: 'sdxl-base',
                label: 'SDXL Base',
                capabilityContract: 'image.generate',
                implementation: { implementationId: 'local.image.generate.stable-diffusion-cpp', driverId: 'nimi.runtime.driver.stable-diffusion-cpp', driverDialect: 'stable-diffusion.cpp/image-generate/v5' },
                implementationSupportedFeatures: ['input.image'],
                configuredFeatures: [],
                textBehaviors: [],
                state: 'ready',
                reasons: [],
              },
            },
          },
          parameters: {},
          disabled: false,
          onChange: () => {},
        }))));
    });
    assert.match(container.querySelector('[data-testid="studio-image-input-posture"]').textContent, /imageInputSlotMissingHint/u);

    // 2) ImageFields unsupported posture
    await act(async () => {
      renderer.render(createElement(TooltipProvider, null, createElement(mod.AIStudioHostProvider, { value: host },
        createElement(mod.StudioMediaParameterPanel, {
          capabilityId: 'image.generate',
          contract: imageRegistration.parameters,
          source: 'local',
          effectiveSelection: {
            capabilityContract: 'image.generate',
            state: 'ready',
            reasons: [],
            resource: {
              oneofKind: 'local',
              local: {
                loadoutRef: 't2i-only',
                label: 'Text2Img',
                capabilityContract: 'image.generate',
                implementation: { implementationId: 'local.image.generate.stable-diffusion-cpp', driverId: 'nimi.runtime.driver.stable-diffusion-cpp', driverDialect: 'stable-diffusion.cpp/image-generate/v5' },
                implementationSupportedFeatures: [],
                configuredFeatures: [],
                textBehaviors: [],
                state: 'ready',
                reasons: [],
              },
            },
          },
          parameters: {},
          disabled: false,
          onChange: () => {},
        }))));
    });
    assert.match(container.querySelector('[data-testid="studio-image-input-posture"]').textContent, /imageInputUnsupportedHint/u);

    // 3) StudioResult 0% of 21 steps renders visible ProgressIndicator with aria-valuenow="0"
    const baseResultProps = {
      result: null,
      running: true,
      canRegenerate: false,
      cancelRequested: false,
      registration: imageRegistration,
      admission: { label: 'configured', tone: 'success', detail: 'ok' },
      createdAt: '2026-11-24T00:00:00.000Z',
      verboseConsole: false,
      onCopy: () => {},
      onDownload: () => {},
      onRegenerate: () => {},
    };
    await act(async () => {
      renderer.render(createElement(TooltipProvider, null, createElement(mod.AIStudioHostProvider, { value: host },
        createElement(mod.StudioResult, { ...baseResultProps, jobProgress: { percent: 0, currentStep: 0, totalSteps: 21 } }))));
    });
    const bar0 = container.querySelector('[role="progressbar"]');
    assert.ok(bar0, '0% with totalSteps=21 must render a visible progress bar');
    assert.equal(bar0.getAttribute('aria-valuenow'), '0');
    assert.match(container.textContent, /"current":0,"total":21/u);

    // 4) Unknown total and 0% renders status only (no progressbar)
    await act(async () => {
      renderer.render(createElement(TooltipProvider, null, createElement(mod.AIStudioHostProvider, { value: host },
        createElement(mod.StudioResult, { ...baseResultProps, jobProgress: { percent: 0, currentStep: 0, totalSteps: 0 } }))));
    });
    assert.equal(container.querySelector('[role="progressbar"]'), null);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('SectionAITesting sessionScopeKey preserves snapshot on focus refresh and waits before submitting if target changed', async () => {
  const container = document.getElementById('root');
  const renderer = createRoot(container);
  const composition = mod.composeAIStudioModules([mod.studioMediaModule]);
  const registration = composition.getCapability('image.generate');
  const readySnapshotA = {
    config: {
      owner: { owner: { oneofKind: 'app', app: { appId: 'nimi.lab' } } },
      capabilities: [{ capabilityContract: 'image.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } }],
    },
    revision: '1',
    effectiveSelections: [{
      capabilityContract: 'image.generate',
      state: 'ready',
      reasons: [],
      resource: {
        oneofKind: 'local',
        local: {
          loadoutRef: 'loadout-a',
          label: 'Model A',
          capabilityContract: 'image.generate',
          implementation: { implementationId: 'local.image.generate.stable-diffusion-cpp', driverId: 'nimi.runtime.driver.stable-diffusion-cpp', driverDialect: 'stable-diffusion.cpp/image-generate/v5' },
          implementationSupportedFeatures: [],
          configuredFeatures: [],
          textBehaviors: [],
          state: 'ready',
          reasons: [],
        },
      },
    }],
  };
  const switchedSnapshotB = {
    ...readySnapshotA,
    revision: '2',
    effectiveSelections: [{
      ...readySnapshotA.effectiveSelections[0],
      resource: {
        oneofKind: 'local',
        local: {
          ...readySnapshotA.effectiveSelections[0].resource.local,
          loadoutRef: 'loadout-b',
          label: 'Model B',
        },
      },
    }],
  };
  let refreshDeferred = null;
  let snapshotCalls = 0;
  let runCalls = 0;
  const makeHost = (locale, sessionScopeKey) => ({
    appTitle: 'Lab',
    translate: (key) => key,
    locale,
    sessionScopeKey,
    clock: { now: () => Date.UTC(2026, 10, 24) },
    app: {
      projection: { assetExportAction: () => 'reveal', promptDraft: async () => ({ prompt: 'a sunset' }), projectRunTarget: mod.createStudioRunTargetSummary, runStatusLabel: (s) => s },
      events: { subscribeAIConfigRefresh: (listener) => mod.subscribeStudioAIConfigRefresh(listener, window, document) },
      commands: { savePromptDraft: async () => {}, copyText: async () => ({ ok: true }), exportText: async () => ({ ok: true }), exportAsset: async () => {}, openAssetMediaUrl: async () => ({ url: '', revoke: async () => {} }) },
    },
    sdk: {
      runCapability: async () => { runCalls += 1; return { ok: true, capabilityId: 'image.generate', capabilityLabel: 'Image', message: 'ok', output: { kind: 'artifacts', jobId: 'j', jobState: 'completed', artifactCount: 0, artifacts: [] } }; },
      deleteLocalAppVoiceAsset: async () => ({ deleted: true }),
      listLocalAppVoiceAssets: async () => [],
      uploadLocalAppArtifact: async () => ({ artifactId: 'a', sizeBytes: 1, mimeType: 'image/png' }),
      assets: { list: async () => ({ assets: [], nextCursor: '' }), read: async () => {}, stat: async () => {}, write: async () => {}, remove: async () => ({ removed: true }), adoptArtifact: async () => {} },
      storage: { readJson: async () => ({ value: [] }), writeJson: async () => {} },
      aiConfig: {
        getSnapshot: async () => {
          snapshotCalls += 1;
          if (refreshDeferred) return refreshDeferred.promise;
          return readySnapshotA;
        },
        get: async () => readySnapshotA.config,
      },
    },
  });
  const renderSection = (host) => renderer.render(
    createElement(TooltipProvider, null, createElement(mod.AIStudioHostProvider, { value: host },
      createElement(mod.StudioCapabilityParameterContext.Provider, { value: { state: {}, setParameters: () => {} } },
        createElement(mod.SectionAITesting, {
          registration,
          registrations: composition.capabilities,
          runtime: { status: 'connected', mode: 'electron-local-app', detail: 'ok' },
          lastResult: null,
          history: null,
          historySelectionRequest: null,
          onSelectHistoryRun: () => {},
          onResult: async () => null,
          verboseConsole: false,
          draftPersistence: false,
        })))),
  );
  const submitButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Studio.profiles.imageGenerate.primaryLabel');

  try {
    await act(async () => { renderSection(makeHost('en', 'scope-1')); await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(snapshotCalls, 1);
    assert.equal(submitButton().disabled, false);

    // Changing language within the same sessionScopeKey must NOT re-fetch or flicker!
    await act(async () => { renderSection(makeHost('zh', 'scope-1')); await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(snapshotCalls, 1, 'language switch within same sessionScopeKey must not clear or re-fetch snapshot');
    assert.equal(submitButton().disabled, false);

    // Trigger background focus refresh that stays in-flight: button stays enabled (no flicker),
    // and clicking Submit waits for the refresh; when refresh resolves to a DIFFERENT loadoutRef,
    // dispatch aborts cleanly without calling runCapability!
    refreshDeferred = Promise.withResolvers();
    await act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    assert.equal(snapshotCalls, 2);
    assert.equal(submitButton().disabled, false, 'background focus refresh keeps previous ready snapshot without flicker');

    await act(async () => { submitButton().click(); });
    assert.equal(runCalls, 0, 'submit must wait for in-flight target refresh');

    const olderRefresh = refreshDeferred;
    refreshDeferred = Promise.withResolvers();
    await act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    await act(async () => { refreshDeferred.resolve(switchedSnapshotB); await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { olderRefresh.resolve(readySnapshotA); await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(runCalls, 0, 'target loadoutRef changed during focus refresh so dispatch must abort cleanly');

    // Switching sessionScopeKey clears previous snapshot immediately while loading the new scope
    refreshDeferred = Promise.withResolvers();
    await act(async () => { renderSection(makeHost('zh', 'scope-2')); });
    assert.equal(submitButton().disabled, true, 'changing sessionScopeKey must immediately clear stale snapshot');
    await act(async () => { refreshDeferred.resolve(switchedSnapshotB); await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(submitButton().disabled, false);
  } finally {
    await act(async () => renderer.unmount());
  }
});
