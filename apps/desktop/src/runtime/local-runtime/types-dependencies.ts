import type { LocalRuntimeAssetRecord, LocalRuntimeServiceDescriptor } from './types';
import type {
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeExecutionStageResult,
  LocalRuntimePreflightDecision,
} from '@nimiplatform/sdk/runtime';

export type {
  LocalRuntimeDeviceProfile,
  LocalRuntimeExecutionAlternativeDescriptor,
  LocalRuntimeExecutionDeclarationDescriptor,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeExecutionEntryKind,
  LocalRuntimeExecutionOptionDescriptor,
  LocalRuntimeExecutionPlan,
  LocalRuntimeExecutionSelectionRationale,
  LocalRuntimeExecutionStageResult,
  LocalRuntimeGpuProfile,
  LocalRuntimeNpuProfile,
  LocalRuntimePortAvailability,
  LocalRuntimePreflightDecision,
  LocalRuntimePythonProfile,
} from '@nimiplatform/sdk/runtime';

export type LocalRuntimeExecutionApplyResult = {
  planId: string;
  targetId: string;
  entries: LocalRuntimeExecutionEntryDescriptor[];
  installedAssets: LocalRuntimeAssetRecord[];
  services: LocalRuntimeServiceDescriptor[];
  capabilities: string[];
  stageResults: LocalRuntimeExecutionStageResult[];
  preflightDecisions: LocalRuntimePreflightDecision[];
  rollbackApplied: boolean;
  warnings: string[];
  reasonCode?: string;
};
