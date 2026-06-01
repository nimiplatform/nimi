// Desktop-local compatibility export over the SDK product-control projection.
// The mapping owns no product-control truth; SDK centralizes the typed
// projection so Tester can consume the same state-to-screen semantics.

export {
  FIRST_RUN_PHASES,
  firstRunScreenForProductControlState as firstRunScreenForState,
  isProductControlPhaseTransient as isPhaseTransient,
  isProductControlTransientState as isTransientSystemState,
} from '@nimiplatform/sdk';

export type {
  FirstRunPhase,
  FirstRunScreen,
  FirstRunTerminalScreen,
} from '@nimiplatform/sdk';
