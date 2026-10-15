import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';

import { observeRuntimeEnvironment, useRuntimeEnvironmentObservation } from '../src/shell/renderer/features/runtime-config/runtime-environment-observation.js';
import {
  canApplyRuntimeEnvironmentPlan,
  cancelRuntimeEnvironmentDependencyJob,
  projectRuntimeEnvironmentState,
  runtimeEnvironmentConfirmation,
  applyRuntimeEnvironmentPlan,
  latestEnvironmentDependencyJob,
} from '../src/shell/renderer/features/runtime-config/runtime-environment-state.js';

test('joined CUDA consumers observe and cancel one shared job, while unconfirmed consumers still require Apply', async () => {
  const cuda = environmentDependency({ dependencyFamily: 'accelerator.cuda.runtime', consumerScope: 'llama.cpp.cuda', state: 'downloading' });
  const shared = dependencyJob({ dependency: { ...cuda, consumerScope: 'stable-diffusion.cpp.cuda' }, state: 'downloading' });
  assert.equal(latestEnvironmentDependencyJob([shared], cuda), shared);
  assert.equal(canApplyRuntimeEnvironmentPlan(environmentPlan([cuda]), [shared]), false);
  const calls: unknown[] = [];
  await cancelRuntimeEnvironmentDependencyJob({ cancelEnvironmentDependencyJob: async (input: { jobId: string }) => { calls.push(input); return shared; } } as never,
    environmentPlan([cuda]), [shared], shared.jobId);
  assert.deepEqual(calls, [{ jobId: shared.jobId }]);
  const unconfirmed = { ...cuda, state: 'repair_required' };
  assert.equal(latestEnvironmentDependencyJob([shared], unconfirmed), undefined);
  assert.equal(canApplyRuntimeEnvironmentPlan(environmentPlan([unconfirmed]), [shared]), true);
  // Plan and Job reads are independent: keep polling when the plan is still
  // active but the later Job read has already observed the terminal state.
  assert.equal(projectRuntimeEnvironmentState(environmentPlan([cuda]), [{ ...shared, state: 'ready_managed' }]).state, 'active');
  assert.equal(projectRuntimeEnvironmentState(environmentPlan([{ ...cuda, state: 'ready_managed' }]), [{ ...shared, state: 'ready_managed' }]).state, 'ready');
});

test('the actual observation hook polls through an active-plan and terminal-Job read race', async () => {
  const React = await import('react');
  const { act } = React;
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let tick: (() => void) | undefined;
  dom.window.setInterval = ((callback: () => void) => { tick = callback; return 1; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = () => { tick = undefined; };
  const dependency = environmentDependency({ dependencyFamily: 'accelerator.cuda.runtime', consumerScope: 'llama.cpp.cuda', state: 'downloading' });
  let plan = environmentPlan([dependency]);
  let reads = 0;
  const bindings = { sdk: { localEnvironmentRpc: () => ({
    resolveLocalEnvironmentPlan: async () => { reads++; return { plan }; },
    listLocalEnvironmentDependencyJobs: async () => ({ jobs: [dependencyJob({ dependency: { ...dependency, consumerScope: 'stable-diffusion.cpp.cuda' }, state: 'ready_managed' })] }),
  }) } } as never;
  function Probe() { useRuntimeEnvironmentObservation({ capabilityContract: 'text.embed' }); return null; }
  try {
    await act(async () => { root.render(React.createElement(DesktopRendererBindingProvider, { bindings }, React.createElement(Probe))); });
    assert.ok(tick, 'the active Runtime plan must keep the actual hook polling');
    plan = environmentPlan([{ ...dependency, state: 'ready_managed' }]);
    await act(async () => { tick!(); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(reads, 2);
    assert.equal(tick, undefined, 'polling stops once the next plan confirms completion');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

function environmentDependency(input: Partial<NimiRuntimeLocalEnvironmentPlanDependency> & {
  readonly dependencyFamily: string;
  readonly state: string;
}): NimiRuntimeLocalEnvironmentPlanDependency {
  return {
    dependencyFamily: input.dependencyFamily,
    dependencyId: input.dependencyId || `${input.dependencyFamily}.id`,
    consumerScope: input.consumerScope || 'speech.qwen3-tts.python',
    required: input.required ?? true,
    state: input.state,
    sourceKind: input.sourceKind || 'managed',
    confirmationRequired: input.confirmationRequired ?? input.state === 'needs_confirmation',
    selectedSourceRecordId: input.selectedSourceRecordId,
    environmentKey: input.environmentKey || `${input.dependencyFamily}.environment`,
    canonicalRoot: input.canonicalRoot,
    reasonCode: input.reasonCode,
    detail: input.detail,
  };
}

function environmentPlan(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): NimiRuntimeLocalEnvironmentPlan {
  return {
    planId: 'plan-tts',
    packId: 'local-speech',
    productLabel: 'Local speech',
    hostProfileId: 'host-profile',
    platformTuple: 'windows-x86_64-cuda',
    runtimeDataRoot: 'D:\\DataNimi',
    consumerScope: 'speech.qwen3-tts.python',
    cloudOnlyImpact: '',
    state: 'needs_confirmation',
    dependencies,
    requiredDependencyFamilies: [...new Set(dependencies.filter((dependency) => dependency.required).map((dependency) => dependency.dependencyFamily))],
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: ['dependencies', 'environments'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
  };
}

function dependencyJob(input: {
  readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
  readonly state: string;
  readonly jobId?: string;
  readonly updatedAt?: string;
  readonly retryable?: boolean;
  readonly recoveryDisposition?: string;
}): NimiRuntimeLocalEnvironmentDependencyJob {
	const retryable = input.retryable ?? input.state === 'failed';
  return {
    jobId: input.jobId || `${input.dependency.dependencyFamily}.job`,
    environmentKey: input.dependency.environmentKey,
    dependencyFamily: input.dependency.dependencyFamily,
    dependencyId: input.dependency.dependencyId,
    consumerScope: input.dependency.consumerScope,
    state: input.state,
    sourceKind: input.dependency.sourceKind,
    retryable,
    recoveryDisposition: input.recoveryDisposition || (retryable ? 'manual_retry' : 'not_retryable'),
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-08-10T00:00:00.000Z',
    bytesReceived: 0,
    bytesTotal: 0,
    percent: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  };
}

test('local capability setup leaves mixed repair, retry, and start admission to Runtime', () => {
  const runtime = environmentDependency({ dependencyFamily: 'python-runtime', state: 'repair_required' });
  const profile = environmentDependency({ dependencyFamily: 'python-profile', state: 'failed' });
  const torch = environmentDependency({ dependencyFamily: 'python-torch-wheel', state: 'missing' });
  const failedProfileJob = dependencyJob({ dependency: profile, state: 'failed' });
  const activeTorchJob = dependencyJob({ dependency: torch, state: 'installing' });

  assert.equal(canApplyRuntimeEnvironmentPlan(
    environmentPlan([runtime, profile, torch]),
    [failedProfileJob, activeTorchJob],
  ), true);
});

test('local capability environment presents Runtime-owned ready, active, and attention states', () => {
  const ready = environmentDependency({ dependencyFamily: 'python-runtime', state: 'ready_managed' });
  const missing = environmentDependency({ dependencyFamily: 'python-profile', state: 'missing' });
  const active = dependencyJob({ dependency: missing, state: 'installing' });

  assert.deepEqual(projectRuntimeEnvironmentState(environmentPlan([ready]), []), {
    state: 'ready',
    requiredCount: 1,
    attentionCount: 0,
    activeJobs: [],
  });
  assert.equal(projectRuntimeEnvironmentState(environmentPlan([ready, missing]), []).state, 'attention');
  assert.equal(projectRuntimeEnvironmentState(environmentPlan([ready, missing]), [active]).state, 'active');
});

test('local capability plan apply visibility binds active jobs to the exact consumer', () => {
  const tts = environmentDependency({
    dependencyFamily: 'python-runtime',
    dependencyId: 'python-3.12.13-cp312',
    environmentKey: 'shared-python-runtime',
    state: 'installing',
  });
  const asr = environmentDependency({
    ...tts,
    consumerScope: 'speech.qwen3-asr.python',
  });
  const asrJob = dependencyJob({ dependency: asr, state: 'installing', jobId: 'asr-job', updatedAt: '2026-08-10T00:02:00.000Z' });
  const ttsJob = dependencyJob({ dependency: tts, state: 'installing', jobId: 'tts-job', updatedAt: '2026-08-10T00:01:00.000Z' });

  assert.equal(canApplyRuntimeEnvironmentPlan(environmentPlan([tts]), [asrJob]), true);
  assert.equal(canApplyRuntimeEnvironmentPlan(environmentPlan([tts]), [asrJob, ttsJob]), false);
});

test('local capability plan apply follows current missing state over a historical non-retryable job', () => {
  const dependency = environmentDependency({
    dependencyFamily: 'python-torch-wheel',
    state: 'missing',
  });
  const historicalJob = dependencyJob({
    dependency,
    state: 'failed',
    retryable: false,
    recoveryDisposition: 'not_retryable',
  });

  assert.equal(canApplyRuntimeEnvironmentPlan(
    environmentPlan([dependency]),
    [historicalJob],
  ), true);
});

test('local capability confirmation consumes only Runtime-owned plan facts', () => {
  const ready = environmentDependency({ dependencyFamily: 'python-runtime', state: 'ready_managed', sourceKind: 'managed' });
  const missing = environmentDependency({ dependencyFamily: 'python-profile', state: 'needs_confirmation', sourceKind: 'managed' });
  const optional = environmentDependency({ dependencyFamily: 'optional-diagnostic', state: 'missing', sourceKind: 'unavailable', required: false });

  const plan = {
    ...environmentPlan([ready, missing, optional]),
    requiredDependencyFamilies: ['python.runtime', 'python-profile'],
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: ['environments'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
  };
  assert.deepEqual(runtimeEnvironmentConfirmation(plan), {
    families: 'python.runtime, python-profile',
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: 'environments',
    sourceOwners: 'RuntimeLocalService',
    noSystemMutation: true,
  });
});

test('local capability setup fails closed on an incomplete Runtime-owned confirmation projection', () => {
  const dependency = environmentDependency({ dependencyFamily: 'python-runtime', state: 'needs_confirmation' });
  const plan = environmentPlan([dependency]);
  const incompletePlans: readonly NimiRuntimeLocalEnvironmentPlan[] = [
    { ...plan, requiredDependencyFamilies: [] },
    { ...plan, requiredDependencyFamilies: ['different.required.family'] },
    { ...plan, storageCategories: [] },
    { ...plan, sourceOwners: [] },
    { ...plan, noSystemMutation: false },
  ];

  for (const incomplete of incompletePlans) {
    assert.equal(canApplyRuntimeEnvironmentPlan(incomplete, []), false);
  }
});

test('one confirmed local capability action submits one Runtime-owned complete plan', async () => {
  const plan = environmentPlan([
    environmentDependency({ dependencyFamily: 'python-runtime', state: 'repair_required' }),
    environmentDependency({ dependencyFamily: 'python-profile', state: 'failed' }),
    environmentDependency({ dependencyFamily: 'python-torch-wheel', state: 'missing' }),
  ]);
  const resolution = {
    capabilityContract: 'audio.synthesize',
  } as const;
  const calls: unknown[] = [];

  await applyRuntimeEnvironmentPlan({
    async applyEnvironmentPlan(input, options) {
      calls.push([input, options]);
      return { plan, jobs: [] };
    },
  }, resolution, plan);

  assert.deepEqual(calls, [[{
    resolution,
    expectedPlanId: plan.planId,
    confirmed: true,
  }, { caller: 'core' }]]);
});


test('configuration observation binds the exact loadout and filters jobs by dependency consumer', async () => {
  const dependency = environmentDependency({ dependencyFamily: 'python.runtime', state: 'installing' });
  const own = dependencyJob({ dependency, state: 'installing', jobId: 'own' });
  const unrelated = { ...own, jobId: 'other', consumerScope: 'another-config', updatedAt: '2026-08-11T00:00:00.000Z' };
  const requests: unknown[] = [];
  const resolution = { capabilityContract: 'audio.synthesize', candidateLoadoutId: 'exact-saved-or-candidate' };
  const result = await observeRuntimeEnvironment({
    resolveEnvironmentPlan: async request => { requests.push(request); return environmentPlan([dependency]); },
    listEnvironmentDependencyJobs: async () => [own, unrelated],
  }, resolution);
  assert.deepEqual(requests, [resolution]);
  assert.deepEqual(result.jobs.map(job => job.jobId), ['own']);
});

test('shared component observation requires no capability selection', async () => {
  const requests: unknown[] = [];
  await observeRuntimeEnvironment({
    resolveEnvironmentPlan: async request => { requests.push(request); return environmentPlan([]); },
    listEnvironmentDependencyJobs: async () => [],
  }, { mediaCodec: true });
  assert.deepEqual(requests, [{ mediaCodec: true }]);
});

test('configuration cancellation refuses unrelated, terminal and superseded jobs before writing', async () => {
  const dependency = environmentDependency({ dependencyFamily: 'python.runtime', state: 'installing' });
  const active = dependencyJob({ dependency, state: 'installing', jobId: 'active' });
  const unrelated = { ...active, jobId: 'unrelated', consumerScope: 'other-consumer' };
  const old = { ...active, jobId: 'old', updatedAt: '2026-08-09T00:00:00.000Z' };
  const terminal = { ...active, jobId: 'terminal', state: 'failed' };
  const calls: unknown[] = [];
  const client = { cancelEnvironmentDependencyJob: async (request: unknown, options: unknown) => { calls.push([request, options]); return active; } };
  for (const [jobs, id] of [[[unrelated], 'unrelated'], [[active, old], 'old'], [[terminal], 'terminal']] as const) {
    await assert.rejects(cancelRuntimeEnvironmentDependencyJob(client, environmentPlan([dependency]), jobs, id), /OUTSIDE_CONFIGURATION/);
  }
  assert.equal(calls.length, 0);
  await cancelRuntimeEnvironmentDependencyJob(client, environmentPlan([dependency]), [active], 'active');
  assert.deepEqual(calls, [[{ jobId: 'active' }, { caller: 'core' }]]);
});
