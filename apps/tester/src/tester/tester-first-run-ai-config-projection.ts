import { projectNimiFirstRunExecutionEvidenceToAIConfigTargets, type NimiFirstRunExecutionEvidenceForAIConfig } from '@nimiplatform/sdk/runtime';
import { RoutePolicy, ScenarioType } from '@nimiplatform/sdk/runtime/generated';

function testerExecutionEvidence(): NimiFirstRunExecutionEvidenceForAIConfig {
  return {
    executionEvidenceRef: 'tester-execution-evidence',
    runtimeBaselineRef: 'tester-runtime-baseline',
    terminalResult: 'local_ai_ready',
    selectedBaselineCapabilityProof: [
      {
        capability: 'local_text_chat_execution',
        scenarioType: ScenarioType.TEXT_GENERATE,
        boundConsumerId: 'tester.runtime.text',
        boundAssetId: 'tester-text-model',
        localRouteTarget: 'tester-local-route',
        routePolicy: RoutePolicy.LOCAL,
        modelResolved: 'tester-text-model',
        terminalResult: 'local_executed',
        traceId: 'tester-trace-text',
      },
      {
        capability: 'local_basic_stt_execution',
        scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
        boundConsumerId: 'tester.runtime.stt',
        boundAssetId: 'tester-stt-model',
        localRouteTarget: 'tester-local-route',
        routePolicy: RoutePolicy.LOCAL,
        modelResolved: 'tester-stt-model',
        terminalResult: 'local_executed',
        traceId: 'tester-trace-stt',
      },
      {
        capability: 'local_basic_tts_execution',
        scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
        boundConsumerId: 'tester.runtime.tts',
        boundAssetId: 'tester-tts-model',
        localRouteTarget: 'tester-local-route',
        routePolicy: RoutePolicy.LOCAL,
        modelResolved: 'tester-tts-model',
        terminalResult: 'local_executed',
        traceId: 'tester-trace-tts',
      },
    ],
  };
}

export function createTesterFirstRunAIConfigProjection(): Record<string, string> {
  const projected = projectNimiFirstRunExecutionEvidenceToAIConfigTargets(testerExecutionEvidence());
  return Object.fromEntries(projected.map((item) => [
    item.capability,
    item.targetRef.readinessRef,
  ]));
}
