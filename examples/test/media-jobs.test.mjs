import assert from 'node:assert/strict';
import test from 'node:test';
import { submitUpscale, submitCannyImage, retainMediaResult } from '../sdk/09-media-jobs.ts';
import { ImageControlType } from '@nimiplatform/sdk/runtime/wire-types';

test('media submission examples preserve an explicit zero and omit absent optional values', async () => {
  const requests = [];
  const client = { ai: {
    artifacts: { upload: async () => ({ artifactId: 'owned-source' }) },
    scenarioJobs: { submit: async (spec, options) => { requests.push({ spec, options }); } },
  } };
  await submitUpscale(client, 'saved-submission-1', {
    type: 'image-upscale', mimeType: 'image/png', bytes: new Uint8Array([1]), scale: 2, seed: 0,
  });
  await submitUpscale(client, 'saved-submission-2', {
    type: 'video-upscale', mimeType: 'video/mp4', bytes: new Uint8Array([2]), scale: 4,
  });
  await submitCannyImage(client, 'saved-submission-3', new Uint8Array([3]), 'A yellow mug', 0);
  await submitCannyImage(client, 'saved-submission-4', new Uint8Array([4]), 'A yellow mug');
  assert.equal(requests[0].spec.seed, 0);
  assert.equal(requests[0].spec.sourceArtifactId, 'owned-source');
  assert.equal(Object.hasOwn(requests[1].spec, 'seed'), false);
  assert.equal(requests[2].spec.controlImage.strength, 0);
  assert.equal(requests[2].spec.controlImage.type, ImageControlType.CANNY);
  assert.equal(Object.hasOwn(requests[3].spec.controlImage, 'strength'), false);
  assert.equal(requests[3].options.clientSubmissionId, 'saved-submission-4');
});

test('an observation problem never adopts a cached completed output', async () => {
  let adopted = false;
  const issue = { reasonCode: 'observation-unavailable' };
  const client = {
    ai: { scenarioJobs: { get: async () => ({
      observationIssue: issue,
      job: { status: 'completed', artifacts: [{ artifactId: 'cached-output' }] },
    }) } },
    storage: { assets: { adoptArtifact: async () => { adopted = true; } } },
  };
  await assert.rejects(retainMediaResult(client, 'original-job', 'project/result.png'), error =>
    error.jobId === 'original-job' && error.observationIssue === issue);
  assert.equal(adopted, false);
});

test('failed, canceled and timed-out Jobs never save partial artifacts', async () => {
  for (const status of ['failed', 'canceled', 'timeout']) {
    let adopted = false;
    const client = {
      ai: { scenarioJobs: { get: async () => ({ job: {
        status, artifacts: [{ artifactId: 'partial' }], reasonCode: 'terminal-reason', reasonDetail: status,
      } }) } },
      storage: { assets: { adoptArtifact: async () => { adopted = true; } } },
    };
    await assert.rejects(retainMediaResult(client, 'original-job', 'project/result.png'), error =>
      error.jobId === 'original-job' && error.reasonCode === 'terminal-reason');
    assert.equal(adopted, false);
  }
});

test('stopping observation while Get is pending cannot adopt or cancel the Job', async () => {
  const controller = new AbortController();
  let finishGet;
  const pendingGet = new Promise(resolve => { finishGet = resolve; });
  let canceled = false;
  let adopted = false;
  const client = {
    ai: { scenarioJobs: {
      get: () => pendingGet,
      cancel: async () => { canceled = true; },
    } },
    storage: { assets: { adoptArtifact: async () => { adopted = true; } } },
  };
  const result = retainMediaResult(client, 'original-job', 'project/result.png', controller.signal);
  const stopped = new Error('view closed');
  controller.abort(stopped);
  finishGet({ job: { status: 'completed', artifacts: [{ artifactId: 'output' }] } });
  await assert.rejects(result, error => error === stopped);
  assert.equal(adopted, false);
  assert.equal(canceled, false);
});
