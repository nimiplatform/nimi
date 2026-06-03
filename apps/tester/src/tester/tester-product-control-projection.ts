import {
  firstRunScreenForProductControlState,
  isDegradedProductControlState,
  projectProductControlAdmission,
  projectProductControlStorageDirs,
  reconcileRuntimeProductControlFirstRunSetupState,
  type ProductControlState,
  type RuntimeProductControlClientFor,
} from '@nimiplatform/sdk';

export type TesterProductControlProjection = {
  readonly state: ProductControlState;
  readonly degraded: boolean;
  readonly screen: string;
  readonly dataRootSelectedScreen: string;
  readonly aiEnvironmentScreen: string;
  readonly admission: string;
  readonly storageDirs: ReturnType<typeof projectProductControlStorageDirs>;
  readonly runtimeMethod: 'reconcileProductControlFirstRunSetupState';
};

const TESTER_PRODUCT_CONTROL_STATE: ProductControlState = 'local_ai_assets_downloaded_environment_not_ready';

function screenLabel(state: ProductControlState): string {
  const screen = firstRunScreenForProductControlState(state);
  return screen.kind === 'phase' ? screen.phase : screen.screen;
}

function testerProductControlEnvelope(state: ProductControlState) {
  return {
    json: JSON.stringify({
      path: '/tester/.nimi/nimi.json',
      exists: true,
      state,
      record: {
        schemaVersion: 1,
        installId: 'tester-install',
        productVersion: 'tester',
        state,
        dataRoot: {
          path: '/tester/nimi-data',
          status: 'selected',
          selectedAt: '2026-06-01T00:00:00.000Z',
          verifiedAt: '2026-06-01T00:00:00.000Z',
          selectedAtUnixMs: 1,
          verifiedAtUnixMs: 1,
        },
        firstRun: {
          installLevel: 'recommended',
          aiProfileAlias: 'recommended',
          completed: false,
          builtInAiConfigRefs: [],
        },
        pointers: {
          runtimeConfigPath: '/tester/.nimi/runtime/config.json',
        },
        repair: {
          required: false,
        },
      },
      error: null,
    }),
  };
}

function testerRuntimeProductControlClient(): RuntimeProductControlClientFor<'reconcileProductControlFirstRunSetupState'> {
  return {
    local: {
      reconcileProductControlFirstRunSetupState: async (request) => {
        if (Object.keys(request).length !== 0) {
          throw new Error('Tester product-control reconciliation request must be empty');
        }
        return testerProductControlEnvelope(TESTER_PRODUCT_CONTROL_STATE);
      },
    },
  };
}

export async function loadTesterProductControlProjection(): Promise<TesterProductControlProjection> {
  const projection = await reconcileRuntimeProductControlFirstRunSetupState(
    testerRuntimeProductControlClient(),
  );
  const admission = projectProductControlAdmission(projection.state);
  const storageDirs = projectProductControlStorageDirs({
    path: projection.path,
    exists: projection.exists,
    state: projection.state,
    dataRoot: projection.record?.dataRoot ?? null,
    error: projection.error,
  });
  return {
    state: projection.state,
    degraded: isDegradedProductControlState(projection.state),
    screen: screenLabel(projection.state),
    dataRootSelectedScreen: screenLabel('data_root_selected'),
    aiEnvironmentScreen: screenLabel('ai_environment_unconfigured'),
    admission: admission.kind,
    storageDirs,
    runtimeMethod: 'reconcileProductControlFirstRunSetupState',
  };
}
