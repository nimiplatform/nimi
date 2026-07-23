import type {
  NimiAIConfig,
  NimiAIConfigProbeResult,
  NimiAIProfile,
  NimiAIProfileApplyOptions,
  NimiAIProfileApplyResult,
  NimiAIProfilePreviewOptions,
  NimiAIProfilePreviewResult,
  NimiAIProfileValidationResult,
  NimiAISchedulingEvaluationTarget,
  NimiAISchedulingJudgement,
  NimiAIScopeRef,
  NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';

export interface DesktopRendererAIConfigPort {
  readonly aiProfile: {
    list(): Promise<NimiAIProfile[]>;
    get(profileId: string): Promise<NimiAIProfile | null>;
    validate(profile: NimiAIProfile): NimiAIProfileValidationResult;
    previewApply(
      scopeRef: NimiAIScopeRef,
      profileId: string,
      options: NimiAIProfilePreviewOptions,
    ): Promise<NimiAIProfilePreviewResult>;
    apply(
      scopeRef: NimiAIScopeRef,
      profileId: string,
      options: NimiAIProfileApplyOptions,
    ): Promise<NimiAIProfileApplyResult>;
  };
  readonly aiConfig: {
    get(scopeRef: NimiAIScopeRef): NimiAIConfig;
    update(scopeRef: NimiAIScopeRef, config: NimiAIConfig): void;
    listScopes(): readonly NimiAIScopeRef[];
    probe(scopeRef: NimiAIScopeRef): Promise<NimiAIConfigProbeResult>;
    probeFeasibility(
      scopeRef: NimiAIScopeRef,
      runtime?: NimiDesktopMachineProductRuntimeClient,
    ): Promise<NimiAIConfigProbeResult>;
    probeSchedulingTarget(
      scopeRef: NimiAIScopeRef,
      target: NimiAISchedulingEvaluationTarget,
      runtime?: NimiDesktopMachineProductRuntimeClient,
    ): Promise<NimiAISchedulingJudgement | null>;
    subscribe(scopeRef: NimiAIScopeRef, callback: (config: NimiAIConfig) => void): () => void;
  };
  readonly aiSnapshot: {
    record(snapshot: NimiAISnapshot): void;
    get(executionId: string): NimiAISnapshot | null;
    getLatest(scopeRef: NimiAIScopeRef): NimiAISnapshot | null;
  };
}
