import assert from 'node:assert/strict';
import test from 'node:test';
import { runNimiRuntimeScenarioJob, type NimiRuntimeScenarioJobClient } from './scenario-jobs.js';
import { ScenarioJob, SubmitScenarioJobRequest, VisionLocateResult, ScenarioType, ScenarioJobStatus, ScenarioJobEventType, ExecutionMode, VisionLocateGeometry, ExecutionInterruptionCause, ExecutionResubmitDisposition } from '../core-generated/runtime-protobuf/runtime/v1/ai.js';
import { ReasonCode } from '../core-generated/runtime-protobuf/runtime/v1/common.js';
import { projectLocalExecutionInterruption } from '../core/app/local-app-runtime-platform-vision.js';

function locateClient(result?: ReturnType<typeof VisionLocateResult.create>) {
  let artifactReads = 0;
  const terminal = ScenarioJob.create({ jobId:'locate-job', scenarioType:ScenarioType.VISION_LOCATE, executionMode:ExecutionMode.ASYNC_JOB, status:ScenarioJobStatus.COMPLETED, reasonCode:ReasonCode.ACTION_EXECUTED, traceId:'locate-trace' });
  const client: NimiRuntimeScenarioJobClient = {
    async submitScenarioJob() { return {job:ScenarioJob.create({...terminal,status:ScenarioJobStatus.SUBMITTED})}; },
    async getScenarioJob() { return {job:terminal,...(result ? {visionLocate:result} : {})}; },
    async *subscribeScenarioJobEvents() { yield {job:terminal,eventType:ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,sequence:'1',traceId:'locate-trace'}; },
    async cancelScenarioJob() { return {job:terminal}; },
    async getScenarioArtifacts() { artifactReads++; return {artifacts:[],traceId:'locate-trace'}; },
  };
  const request = SubmitScenarioJobRequest.create({scenarioType:ScenarioType.VISION_LOCATE,executionMode:ExecutionMode.ASYNC_JOB,spec:{spec:{oneofKind:'visionLocate',visionLocate:{imageArtifactId:'image-1',query:'the button',geometry:VisionLocateGeometry.BOX}}}});
  return {client,terminal,request,artifactReads:()=>artifactReads};
}

test('Local App interruption uses the public reason token and retains the typed disposition', () => {
  const interruption = { cause:'runtime-restart', resubmitDisposition:'caller-may-resubmit' };
  assert.deepEqual(projectLocalExecutionInterruption(interruption, 'ai-execution-interrupted', 'failed'), interruption);
  assert.throws(() => projectLocalExecutionInterruption(undefined, 'ai-execution-interrupted', 'failed'));
  assert.throws(() => projectLocalExecutionInterruption(interruption, 'action-executed', 'completed'));
});

test('Locate runner reads its typed terminal Get and skips artifact retrieval, including no match', async () => {
  const result = VisionLocateResult.create({imageArtifactId:'image-1',width:1200,height:800,locations:[]});
  const fixture = locateClient(result);
  const outcome = await runNimiRuntimeScenarioJob({ai:fixture.client,request:fixture.request});
  assert.deepEqual(outcome.visionLocate, result);
  assert.equal(fixture.artifactReads(),0);
});

test('Locate runner rejects absent result, changed image, wrong geometry and invalid boxes', async () => {
  for (const result of [
    undefined,
    VisionLocateResult.create({imageArtifactId:'other-image',width:1200,height:800}),
    VisionLocateResult.create({imageArtifactId:'image-1',width:1200,height:800,locations:[{geometry:{oneofKind:'point',point:{x:0.5,y:0.5}}}]}),
    VisionLocateResult.create({imageArtifactId:'image-1',width:1200,height:800,locations:[{geometry:{oneofKind:'box',box:{x1:0.8,y1:0.2,x2:0.3,y2:0.9}}}]}),
  ]) {
    const fixture = locateClient(result);
    await assert.rejects(runNimiRuntimeScenarioJob({ai:fixture.client,request:fixture.request}));
    assert.equal(fixture.artifactReads(),0);
  }
});

test('Job runner errors preserve Runtime restart cause and caller resubmit disposition', async () => {
  const fixture = locateClient();
  fixture.terminal.status = ScenarioJobStatus.FAILED;
  fixture.terminal.reasonCode = ReasonCode.AI_EXECUTION_INTERRUPTED;
  fixture.terminal.interruption = {cause:ExecutionInterruptionCause.RUNTIME_RESTART,resubmitDisposition:ExecutionResubmitDisposition.CALLER_MAY_RESUBMIT};
  fixture.client.subscribeScenarioJobEvents = async function* () { yield {job:fixture.terminal,eventType:ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED,sequence:'1',traceId:'locate-trace'}; };
  await assert.rejects(runNimiRuntimeScenarioJob({ai:fixture.client,request:fixture.request}), error => {
    assert.deepEqual((error as {details:Record<string,unknown>}).details.interruption,{cause:'runtime-restart',resubmitDisposition:'caller-may-resubmit'});
    return true;
  });
});
