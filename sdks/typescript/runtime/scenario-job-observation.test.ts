import { createNimiLocalAppAIConsumptionClient, createNimiLocalAppRuntimeScenarioJobClient } from '../core/app/local-app-runtime-platform-ai.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { observeNimiRuntimeScenarioJob, runNimiRuntimeScenarioJob, type NimiRuntimeScenarioJobClient } from './scenario-jobs.js';
import { ExecutionMode, ScenarioJobStatus, ScenarioType, ReasonCode as RuntimeReasonCode, type ScenarioJob, type SubmitScenarioJobRequest } from './generated.js';

test('speaker Job uses the common observer and preserves complete typed Get and formal output', async () => {
  let gets = 0;
  const unexpected = async (): Promise<never> => { throw new Error('unexpected operation'); };
  const speakerEmbedding = { vector: [.25, .75], spaceId: 'speaker-fixture-space' };
  const client = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: unexpected }, scenario: { execute: unexpected },
    scenarioJobs: {
      submit: unexpected, subscribe: unexpected, cancel: unexpected,
      get: async () => {
        gets++;
        return { job: { jobId: 'speaker-original', scenarioType: 'audio-speaker-embed', status: 'completed',
          submissionOutcome: 'accepted', artifacts: [], progressPercent: 100, progressCurrentStep: 0, progressTotalSteps: 0,
          reasonCode: 'action-executed', reasonDetail: '', traceId: 'trace', createdAt: null, updatedAt: null,
          transcriptionText: '', speakerEmbedding }, asset: null, voiceReference: null };
      },
    },
    artifacts: { read: unexpected, upload: unexpected },
    voiceAssets: { list: unexpected, delete: unexpected },
  });
  let observed: unknown;
  const result = await observeNimiRuntimeScenarioJob({ ai: createNimiLocalAppRuntimeScenarioJobClient(client),
    jobId: 'speaker-original', scenarioType: ScenarioType.AUDIO_SPEAKER_EMBED,
    onObservation: (response) => { observed = response.job?.speakerEmbedding; },
  });
  const expected = { vector: { values: speakerEmbedding.vector }, spaceId: speakerEmbedding.spaceId };
  assert.ok(gets > 0, 'a full Get is retained even for an already completed speaker Job');
  assert.deepEqual(observed, expected);
  assert.deepEqual(result.response.job?.speakerEmbedding, expected);
  assert.equal(result.output?.output.oneofKind, 'audioSpeakerEmbed');
  if (result.output?.output.oneofKind !== 'audioSpeakerEmbed') throw new Error('speaker output missing');
  assert.deepEqual(result.output.output.audioSpeakerEmbed, expected);
});

test('explicit observation retrieves a completed Job without submission or replay', async () => {
  let submissions = 0;
  let subscriptions = 0;
  const request = { scenarioType: ScenarioType.MUSIC_GENERATE, executionMode: ExecutionMode.ASYNC_JOB, extensions: [], labels: {}, requestId: 'original', idempotencyKey: 'original' } as SubmitScenarioJobRequest;
  const job = { jobId: 'retained-music', scenarioType: ScenarioType.MUSIC_GENERATE, status: ScenarioJobStatus.COMPLETED, artifacts: [], traceId: 'trace' } as unknown as ScenarioJob;
  const ai = {
    submitScenarioJob: async () => { submissions += 1; throw new Error('must not resubmit'); },
    getScenarioJob: async () => ({ job }),
    subscribeScenarioJobEvents: () => { subscriptions += 1; throw new Error('completed Job needs no subscription'); },
    getScenarioArtifacts: async () => ({ jobId: job.jobId, artifacts: [], traceId: job.traceId }),
  } as unknown as NimiRuntimeScenarioJobClient;
  const result = await observeNimiRuntimeScenarioJob({ ai, scenarioType: request.scenarioType, jobId: job.jobId });
  assert.equal(result.job.jobId, job.jobId);
  assert.equal(submissions, 0);
  assert.equal(subscriptions, 0);
  await assert.rejects(() => observeNimiRuntimeScenarioJob({ ai, scenarioType: request.scenarioType, jobId: 'different' }));
  await assert.rejects(() => observeNimiRuntimeScenarioJob({ ai, scenarioType: ScenarioType.VOICE_CREATE, jobId: job.jobId }));
});

test('terminal non-success retains the issued Job ID for later owner-scoped queries', async () => {
  for (const status of [ScenarioJobStatus.FAILED, ScenarioJobStatus.CANCELED, ScenarioJobStatus.TIMEOUT]) {
    const job = { jobId: 'issued-audio-job', scenarioType: ScenarioType.SPEECH_SYNTHESIZE, status,
      reasonCode: RuntimeReasonCode.AI_LOCAL_EXECUTION_INFERENCE_FAILED, reasonDetail: 'terminal failure', artifacts: [], traceId: 'trace' } as unknown as ScenarioJob;
    const ai = { getScenarioJob: async () => ({ job }), getScenarioArtifacts: async () => { throw new Error('non-success must not read artifacts'); } } as unknown as NimiRuntimeScenarioJobClient;
    await assert.rejects(() => observeNimiRuntimeScenarioJob({ ai, scenarioType: job.scenarioType, jobId: job.jobId }), (error: unknown) => {
      assert.equal((error as { details?: { jobId?: string } }).details?.jobId, job.jobId);
      return true;
    });
  }
});

function observerFixture() {
 const running = { jobId:'original',scenarioType:ScenarioType.IMAGE_GENERATE,status:ScenarioJobStatus.RUNNING,artifacts:[],traceId:'trace' } as unknown as ScenarioJob;
 let gets=0, cancels=0, closes=0, inFlight=0, peak=0;
 const ai={
  submitScenarioJob: async()=>({job:running}),
  getScenarioJob: async()=>{gets++;inFlight++;peak=Math.max(peak,inFlight);await new Promise(resolve=>setTimeout(resolve,2));inFlight--;return {job:{...running,status:gets>=3?ScenarioJobStatus.COMPLETED:ScenarioJobStatus.RUNNING}}},
  cancelScenarioJob:async()=>{cancels++;return {job:{...running,status:ScenarioJobStatus.CANCELED}}},
  subscribeScenarioJobEvents:()=>({[Symbol.asyncIterator](){return {next:()=>new Promise<IteratorResult<never>>(()=>{}),return:async()=>{closes++;return {done:true as const,value:undefined}}}}}),
  getScenarioArtifacts:async()=>({jobId:'original',artifacts:[],traceId:'trace'}),
 } satisfies NimiRuntimeScenarioJobClient;
 return {ai,running,counts:()=>({gets,cancels,closes,peak})};
}

test('healthy silent subscription still performs serialized Get at caller cadence and closes',async()=>{
 const fixture=observerFixture();const observations:unknown[]=[];
 const result=await observeNimiRuntimeScenarioJob({ai:fixture.ai,jobId:'original',scenarioType:ScenarioType.IMAGE_GENERATE,getIntervalMs:5,onObservation:response=>observations.push(response)});
 assert.equal(result.job.status,ScenarioJobStatus.COMPLETED);
 assert.equal(result.response,observations.at(-1));
 assert.deepEqual(fixture.counts(),{gets:3,cancels:0,closes:1,peak:1});
});

test('observer detach releases resources without canceling and ignores late Get',async()=>{
 const fixture=observerFixture();const controller=new AbortController();let resolveGet!: (value:{job:ScenarioJob})=>void;let updates=0;
 fixture.ai.getScenarioJob=()=>new Promise(resolve=>{resolveGet=resolve});
 const work=observeNimiRuntimeScenarioJob({ai:fixture.ai,jobId:'original',scenarioType:ScenarioType.IMAGE_GENERATE,signal:controller.signal,onJobUpdate:()=>updates++});
 controller.abort();
 await assert.rejects(work,(error:unknown)=>{assert.equal((error as {details?:{jobId?:string}}).details?.jobId,'original');return true});
 resolveGet({job:{...fixture.running,status:ScenarioJobStatus.COMPLETED}});
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(updates,0);assert.equal(fixture.counts().cancels,0);
});

test('run fetches full Get even when Submit returns a non-success terminal',async()=>{
 const fixture=observerFixture();let gets=0;
 const terminal={...fixture.running,status:ScenarioJobStatus.FAILED,reasonCode:RuntimeReasonCode.AI_PROVIDER_UNAVAILABLE};
 fixture.ai.submitScenarioJob=async()=>({job:terminal});
 fixture.ai.getScenarioJob=async()=>{gets++;return {job:terminal}};
 await assert.rejects(runNimiRuntimeScenarioJob({ai:fixture.ai,request:{scenarioType:ScenarioType.IMAGE_GENERATE} as SubmitScenarioJobRequest}));
 assert.equal(gets,1);
});

test('run observation detach never sends Cancel; explicit cancellation rejection remains an error',async()=>{
 for(const explicit of [false,true]){
  const fixture=observerFixture();const controller=new AbortController();let submitted!:()=>void;
  const ready=new Promise<void>(resolve=>{submitted=resolve});
  fixture.ai.submitScenarioJob=async()=>{submitted();return {job:fixture.running}};
  const rejected=new Error('Cancel gate not saved');let calls=0;
  fixture.ai.cancelScenarioJob=async()=>{calls++;throw rejected};
  const work=runNimiRuntimeScenarioJob({ai:fixture.ai,request:{scenarioType:ScenarioType.IMAGE_GENERATE} as SubmitScenarioJobRequest,getIntervalMs:5,...(explicit?{signal:controller.signal}:{observationSignal:controller.signal})});
  await ready;controller.abort();
  await assert.rejects(work,(error:unknown)=>{if(explicit)assert.equal((error as Error).message,rejected.message);assert.equal((error as {details?:{scenarioJobStatus?:string}}).details?.scenarioJobStatus,undefined);return true});
  assert.equal(calls,explicit?1:0);
 }
});


test('one observer preserves response-local observation issues independently of route and submission certainty', async () => {
  for (const [routeDecision, submissionOutcome] of [[1, 3], [2, 3], [2, 2]] as const) {
    const fixture = observerFixture(); let gets = 0;
    const issue = { reasonCode: RuntimeReasonCode.AI_PROVIDER_UNAVAILABLE, observedAt: { seconds: '1', nanos: 0 } };
    fixture.ai.getScenarioJob = async () => ({ job: { ...fixture.running, routeDecision, submissionOutcome, status: ++gets === 1 ? ScenarioJobStatus.RUNNING : ScenarioJobStatus.COMPLETED }, ...(gets === 1 ? { observationIssue: issue } : {}) });
    const observations: Array<{ status?: ScenarioJobStatus; issue: unknown }> = [];
    const result = await observeNimiRuntimeScenarioJob({ ai: fixture.ai, jobId: 'original', scenarioType: ScenarioType.IMAGE_GENERATE,
      getIntervalMs: 1, onObservation: response => observations.push({ status: response.job?.status, issue: response.observationIssue }) });
    assert.deepEqual(observations, [{ status: ScenarioJobStatus.RUNNING, issue }, { status: ScenarioJobStatus.COMPLETED, issue: undefined }]);
    assert.equal(result.response.job, result.job); assert.equal(fixture.counts().cancels, 0);
  }
});


test('explicit Cancel while the first observation Get is pending is sent immediately', async () => {
  const fixture = observerFixture(); const cancel = new AbortController(); const detach = new AbortController();
  let calls = 0;
  fixture.ai.getScenarioJob = () => new Promise(() => {});
  fixture.ai.cancelScenarioJob = async () => { calls++; return { job: { ...fixture.running, status: ScenarioJobStatus.CANCELED } }; };
  const work = observeNimiRuntimeScenarioJob({ ai: fixture.ai, jobId: 'original', scenarioType: ScenarioType.IMAGE_GENERATE,
    signal: detach.signal, cancelSignal: cancel.signal });
  cancel.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  detach.abort(); await assert.rejects(work);
});


test('protected adapter closes a silent event subscription on view detach without Cancel', async () => {
  let closes = 0, cancels = 0; let opened!: () => void;
  const ready = new Promise<void>(resolve => { opened = resolve; });
  const localJob = { jobId: 'original', scenarioType: 'image-generate', status: 'running', artifacts: [],
    progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0, reasonCode: '', reasonDetail: '',
    traceId: 'trace', createdAt: null, updatedAt: null, transcriptionText: '' };
  const ai = createNimiLocalAppRuntimeScenarioJobClient({ scenarioJobs: {
    get: async () => ({ job: localJob, asset: null, voiceReference: null }),
    cancel: async () => { cancels++; throw new Error('observer must never Cancel'); },
    subscribe: async () => {
      opened();
      return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }), cancel: async () => { closes++; } };
    },
  } } as unknown as Parameters<typeof createNimiLocalAppRuntimeScenarioJobClient>[0]);
  const view = new AbortController();
  const work = observeNimiRuntimeScenarioJob({ ai, jobId: 'original', scenarioType: ScenarioType.IMAGE_GENERATE, signal: view.signal });
  await ready; view.abort(); await assert.rejects(work);
  assert.equal(closes, 1); assert.equal(cancels, 0);
});


test('Cancel requested during Submit survives later view detach and uses only its own call controls', async () => {
  for (const explicitCancel of [false, true]) {
    const fixture = observerFixture(); const cancel = new AbortController(); const view = new AbortController();
    const control = new AbortController(); const receipt = Promise.withResolvers<{ job: ScenarioJob }>();
    fixture.ai.submitScenarioJob = () => receipt.promise;
    let cancellations = 0, gets = 0;
    const ai: NimiRuntimeScenarioJobClient = { ...fixture.ai,
      getScenarioJob: async () => { gets++; return { job: fixture.running }; },
      cancelScenarioJob: async (request, options) => {
        cancellations++; assert.equal(request.jobId, 'original');
        assert.equal(options?.signal, control.signal); assert.equal(options?.signal?.aborted, false);
        return { job: { ...fixture.running, status: ScenarioJobStatus.CANCELED } };
      },
    };
    const work = runNimiRuntimeScenarioJob({ ai, request: { scenarioType: ScenarioType.IMAGE_GENERATE } as SubmitScenarioJobRequest,
      signal: cancel.signal, observationSignal: view.signal, callOptions: { signal: control.signal } });
    if (explicitCancel) cancel.abort();
    view.abort(); receipt.resolve({ job: fixture.running });
    await assert.rejects(work, (error: unknown) => {
      assert.equal((error as { details?: { jobId?: string; scenarioJobStatus?: string } }).details?.jobId, 'original');
      assert.equal((error as { details?: { scenarioJobStatus?: string } }).details?.scenarioJobStatus, undefined);
      return true;
    });
    assert.equal(cancellations, explicitCancel ? 1 : 0); assert.equal(gets, 0); assert.equal(control.signal.aborted, false);
  }
});

test('detaching during Cancel releases observation but does not abort the control RPC or hide its rejection', async () => {
  const fixture = observerFixture(); const cancel = new AbortController(); const view = new AbortController();
  const control = new AbortController(); const sent = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<{ job: ScenarioJob }>(); let receivedControl: AbortSignal | undefined;
  const ai: NimiRuntimeScenarioJobClient = { ...fixture.ai,
    getScenarioJob: async () => ({ job: fixture.running }),
    cancelScenarioJob: async (_request, options) => { receivedControl = options?.signal; sent.resolve(); return reply.promise; },
  };
  const work = observeNimiRuntimeScenarioJob({ ai, jobId: 'original', scenarioType: ScenarioType.IMAGE_GENERATE,
    signal: view.signal, cancelSignal: cancel.signal, callOptions: { signal: control.signal } });
  await new Promise(resolve => setTimeout(resolve, 0));
  cancel.abort(); await sent.promise; view.abort();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(receivedControl, control.signal); assert.equal(receivedControl?.aborted, false);
  assert.equal(fixture.counts().closes, 1);
  reply.reject(new Error('Cancel transport could not confirm acceptance'));
  await assert.rejects(work, (error: unknown) => {
    assert.match((error as Error).message, /could not confirm acceptance/);
    assert.equal((error as { details?: { jobId?: string; scenarioJobStatus?: string } }).details?.jobId, 'original');
    assert.equal((error as { details?: { scenarioJobStatus?: string } }).details?.scenarioJobStatus, undefined);
    return true;
  });
  assert.equal(control.signal.aborted, false);
});
