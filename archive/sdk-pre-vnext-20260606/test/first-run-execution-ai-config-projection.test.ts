import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectFirstRunExecutionEvidenceToAIConfigBindings,
  type FirstRunExecutionEvidenceForAIConfig,
} from '../src/runtime/index.js';
import { RoutePolicy, ScenarioType } from '../src/runtime/index.js';

function proof(input: {
  capability: string;
  scenarioType: ScenarioType;
  consumerId: string;
  assetId: string;
  routeTarget: string;
}) {
  return {
    capability: input.capability,
    scenarioType: input.scenarioType,
    boundConsumerId: input.consumerId,
    boundAssetId: input.assetId,
    localRouteTarget: input.routeTarget,
    routePolicy: RoutePolicy.LOCAL,
    modelResolved: input.assetId,
    terminalResult: 'local_executed',
    traceId: `trace:${input.consumerId}`,
  };
}

function readyEvidence(): FirstRunExecutionEvidenceForAIConfig {
  return {
    executionEvidenceRef: 'execution_evidence_test',
    runtimeBaselineRef: 'runtime-baseline:test',
    terminalResult: 'local_ai_ready',
    selectedBaselineCapabilityProof: [
      proof({
        capability: 'local_text_chat_execution',
        scenarioType: ScenarioType.TEXT_GENERATE,
        consumerId: 'llama.cpp.cpu',
        assetId: 'asset:text',
        routeTarget: 'local',
      }),
      proof({
        capability: 'local_basic_stt_execution',
        scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
        consumerId: 'speech.qwen3-asr.python',
        assetId: 'asset:stt',
        routeTarget: 'speech',
      }),
      proof({
        capability: 'local_basic_tts_execution',
        scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
        consumerId: 'speech.qwen3-tts.python',
        assetId: 'asset:tts',
        routeTarget: 'speech',
      }),
    ],
  };
}

test('SDK projects Runtime execution proof into first-run AIConfig bindings', () => {
  const bindings = projectFirstRunExecutionEvidenceToAIConfigBindings(readyEvidence());
  assert.deepEqual(bindings.map((item) => item.capability), [
    'audio.synthesize',
    'audio.transcribe',
    'text.generate',
  ]);
  const text = bindings.find((item) => item.capability === 'text.generate');
  assert.equal(text?.binding.model, 'asset:text');
  assert.equal(text?.binding.engine, 'llama.cpp.cpu');
  assert.equal(text?.binding.runtimeExecutionEvidenceRef, 'execution_evidence_test');
});

test('SDK rejects incomplete or non-local first-run execution proof', () => {
  assert.throws(
    () => projectFirstRunExecutionEvidenceToAIConfigBindings({
      ...readyEvidence(),
      selectedBaselineCapabilityProof: readyEvidence().selectedBaselineCapabilityProof.slice(0, 2),
    }),
    /incomplete/,
  );

  const cloud = readyEvidence();
  cloud.selectedBaselineCapabilityProof = [
    { ...cloud.selectedBaselineCapabilityProof[0], routePolicy: RoutePolicy.CLOUD },
    ...cloud.selectedBaselineCapabilityProof.slice(1),
  ];
  assert.throws(
    () => projectFirstRunExecutionEvidenceToAIConfigBindings(cloud),
    /local route/,
  );
});
