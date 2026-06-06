import type { AISchedulingJudgement } from './runtime-scheduling-types.js';
import type { RuntimeRouteBinding } from './runtime-route-core.js';
import { RoutePolicy, ScenarioType } from './generated/runtime/v1/ai.js';

// Runtime-owned execution evidence slice embedded by AIConfig/AISnapshot.
// SDK owns the typed projection and normalization only; Runtime remains the
// authority for scheduling judgement materialization.
export type AIRuntimeEvidence = {
  schedulingJudgement: AISchedulingJudgement | null;
};

export function createAIRuntimeEvidence(input: {
  schedulingJudgement?: AISchedulingJudgement | null;
}): AIRuntimeEvidence | null {
  return input.schedulingJudgement
    ? { schedulingJudgement: input.schedulingJudgement }
    : null;
}

export function projectAIRuntimeEvidenceMetadata(
  evidence: AIRuntimeEvidence | null | undefined,
): Record<string, string> {
  const judgement = evidence?.schedulingJudgement ?? null;
  if (!judgement) {
    return {};
  }
  return {
    runtimeSchedulingState: judgement.state,
    runtimeSchedulingDetail: String(judgement.detail || ''),
  };
}

export type FirstRunExecutionCapabilityProofForAIConfig = {
  capability: string;
  scenarioType: ScenarioType;
  boundConsumerId: string;
  boundAssetId: string;
  localRouteTarget: string;
  routePolicy: RoutePolicy;
  modelResolved: string;
  terminalResult: string;
  traceId: string;
};

export type FirstRunExecutionEvidenceForAIConfig = {
  executionEvidenceRef: string;
  runtimeBaselineRef: string;
  terminalResult: string;
  selectedBaselineCapabilityProof: readonly FirstRunExecutionCapabilityProofForAIConfig[];
};

type RuntimeCanonicalFirstRunAIConfigCapability =
  | 'text.generate'
  | 'audio.transcribe'
  | 'audio.synthesize';

export type FirstRunExecutionAIConfigCapabilityBinding = {
  capability: RuntimeCanonicalFirstRunAIConfigCapability;
  binding: RuntimeRouteBinding & Record<string, string>;
};

const FIRST_RUN_EXECUTION_TERMINAL_READY = 'local_ai_ready';
const FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED = 'local_executed';
const FIRST_RUN_BUILT_IN_AI_CONFIG_CAPABILITY_FLOOR: RuntimeCanonicalFirstRunAIConfigCapability[] = [
  'audio.synthesize',
  'audio.transcribe',
  'text.generate',
];

function firstRunExecutionAIConfigProjectionError(message: string): Error {
  return new Error(message);
}

function aiConfigCapabilityForExecutionScenario(
  scenarioType: ScenarioType,
): RuntimeCanonicalFirstRunAIConfigCapability {
  switch (scenarioType) {
    case ScenarioType.TEXT_GENERATE:
      return 'text.generate';
    case ScenarioType.SPEECH_TRANSCRIBE:
      return 'audio.transcribe';
    case ScenarioType.SPEECH_SYNTHESIZE:
      return 'audio.synthesize';
    default:
      throw firstRunExecutionAIConfigProjectionError(
        `Runtime execution proof scenario ${ScenarioType[scenarioType] || scenarioType} is not admitted for first-run built-in AIConfig`,
      );
  }
}

function nonEmptyRuntimeProofString(value: string, field: string, capability?: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw firstRunExecutionAIConfigProjectionError(
      capability
        ? `Runtime execution proof for ${capability} is missing ${field}`
        : `Runtime execution evidence is missing ${field}`,
    );
  }
  return trimmed;
}

export function projectFirstRunExecutionEvidenceToAIConfigBindings(
  evidence: FirstRunExecutionEvidenceForAIConfig,
): FirstRunExecutionAIConfigCapabilityBinding[] {
  const executionEvidenceRef = nonEmptyRuntimeProofString(
    evidence.executionEvidenceRef,
    'executionEvidenceRef',
  );
  const runtimeBaselineRef = nonEmptyRuntimeProofString(
    evidence.runtimeBaselineRef,
    'runtimeBaselineRef',
  );
  if (String(evidence.terminalResult || '').trim() !== FIRST_RUN_EXECUTION_TERMINAL_READY) {
    throw firstRunExecutionAIConfigProjectionError(
      'Runtime execution evidence terminalResult is not local_ai_ready',
    );
  }

  const seen = new Set<RuntimeCanonicalFirstRunAIConfigCapability>();
  const missing = new Set(FIRST_RUN_BUILT_IN_AI_CONFIG_CAPABILITY_FLOOR);
  const bindings: FirstRunExecutionAIConfigCapabilityBinding[] = [];
  for (const proof of evidence.selectedBaselineCapabilityProof || []) {
    if (proof.routePolicy !== RoutePolicy.LOCAL) {
      throw firstRunExecutionAIConfigProjectionError(
        `Runtime execution proof for ${String(proof.capability || '').trim()} is not a local route`,
      );
    }
    if (String(proof.terminalResult || '').trim() !== FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED) {
      throw firstRunExecutionAIConfigProjectionError(
        `Runtime execution proof for ${String(proof.capability || '').trim()} was not locally executed`,
      );
    }
    const capability = aiConfigCapabilityForExecutionScenario(proof.scenarioType);
    if (seen.has(capability)) {
      throw firstRunExecutionAIConfigProjectionError(
        `Runtime execution proof contains duplicate AIConfig capability ${capability}`,
      );
    }
    seen.add(capability);
    missing.delete(capability);

    const boundAssetId = nonEmptyRuntimeProofString(proof.boundAssetId, 'boundAssetId', capability);
    const boundConsumerId = nonEmptyRuntimeProofString(
      proof.boundConsumerId,
      'boundConsumerId',
      capability,
    );
    const localRouteTarget = nonEmptyRuntimeProofString(
      proof.localRouteTarget,
      'localRouteTarget',
      capability,
    );
    const modelResolved = String(proof.modelResolved || '').trim();
    bindings.push({
      capability,
      binding: {
        source: 'local',
        connectorId: '',
        model: boundAssetId,
        modelId: boundAssetId,
        localModelId: boundAssetId,
        provider: localRouteTarget,
        engine: boundConsumerId,
        goRuntimeLocalModelId: modelResolved || boundAssetId,
        runtimeBaselineRef,
        runtimeConsumerId: boundConsumerId,
        runtimeExecutionEvidenceRef: executionEvidenceRef,
        runtimeLocalRouteTarget: localRouteTarget,
        runtimeExecutionTraceId: String(proof.traceId || '').trim(),
      },
    });
  }

  if (missing.size > 0) {
    throw firstRunExecutionAIConfigProjectionError(
      `Runtime execution proof is incomplete for first-run built-in AIConfig: missing ${[...missing].join(',')}`,
    );
  }
  return bindings.sort((a, b) => a.capability.localeCompare(b.capability));
}
