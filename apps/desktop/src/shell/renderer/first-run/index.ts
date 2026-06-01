export { projectFirstRunReadiness } from './readiness-projection.js';
export { projectLibrary } from './library-projection.js';
export type { LibraryEntry, LibraryProjection } from './library-projection.js';
export { FirstRunReadinessView } from './readiness-view.js';
export type { FirstRunReadinessViewProps } from './readiness-view.js';
export { ProductControlWorkflow } from './product-control-workflow.js';
export { FirstRunFinalization } from './first-run-finalization.js';
export {
  FIRST_RUN_PHASES,
  firstRunScreenForState,
  isPhaseTransient,
  isTransientSystemState,
} from './first-run-phase-projection.js';
export type {
  FirstRunPhase,
  FirstRunScreen,
  FirstRunTerminalScreen,
} from './first-run-phase-projection.js';
export { projectInstallLevelCard } from './first-run-install-level-cards.js';
export type {
  FirstRunCapabilityHighlightId,
  FirstRunInstallLevelCard,
} from './first-run-install-level-cards.js';
export {
  FIRST_RUN_SETUP_STEP_IDS,
  projectSetupChecklist,
} from './first-run-setup-checklist.js';
export type {
  FirstRunSetupChecklist,
  FirstRunSetupStep,
  FirstRunSetupStepId,
  FirstRunSetupStepStatus,
} from './first-run-setup-checklist.js';
export { projectDeviceSummary } from './first-run-device-summary.js';
export type { FirstRunInstallLevel } from '@nimiplatform/sdk/platform-catalog';
export {
  isAdmittedFirstRunLocalBaseline,
  selectFactoryAIProfileForFirstRun,
} from '@nimiplatform/sdk/platform-catalog';
export {
  cancelFirstRunMaterializationJob,
  productStateForMaterializationStatus,
  repairFirstRunMaterializationDependency,
  resolveFirstRunMaterializationProjection,
  retryFirstRunMaterializationJob,
  startFirstRunMaterialization,
} from './runtime-materialization.js';
export type {
  FirstRunMaterializationDependencyProjection,
  FirstRunMaterializationInput,
  FirstRunMaterializationProductState,
  FirstRunMaterializationProjection,
  FirstRunMaterializationStatus,
} from './runtime-materialization.js';
export { LibraryView } from './library-view.js';
export type { LibraryViewProps } from './library-view.js';
export { projectDiscovery } from './discovery-projection.js';
export type { DiscoveryProjection } from './discovery-projection.js';
export { DiscoveryView } from './discovery-view.js';
export type { DiscoveryViewProps } from './discovery-view.js';
export type {
  ColdStartProjection,
  ColdStartState,
  FirstRunReadinessProjection,
  FirstRunStep,
  FirstRunStepProjection,
  UpstreamInputs,
} from './types.js';
export { FIRST_RUN_STEPS } from './types.js';
