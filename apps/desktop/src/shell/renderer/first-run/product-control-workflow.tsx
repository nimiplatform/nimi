import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  loadPlatformAIProfileFactoryRows,
  selectFactoryAIProfileForFirstRun,
  type FirstRunInstallLevel,
} from '@nimiplatform/sdk/platform-catalog';
import { localRuntime, type LocalRuntimeDeviceProfile } from '@nimiplatform/sdk/runtime';
import { desktopBridge, type ProductControlRecordProjection, type ProductControlState } from '@renderer/bridge';
import { FirstRunFinalization } from './first-run-finalization.js';
import {
  cancelFirstRunMaterializationJob,
  repairFirstRunMaterializationDependency,
  repairableConfirmedFirstRunMaterializationDependencies,
  resolveFirstRunMaterializationProjection,
  retryFirstRunMaterializationJob,
  retryableInterruptedFirstRunMaterializationJobs,
  shouldResumeConfirmedFirstRunMaterialization,
  startFirstRunMaterialization,
  type FirstRunMaterializationDependencyProjection,
  type FirstRunMaterializationProjection,
} from './runtime-materialization.js';
import {
  firstRunScreenForState,
  isPhaseTransient,
} from './first-run-phase-projection.js';
import { syncRuntimeStorageConfig } from '../infra/bootstrap/runtime-bootstrap-local-models-sync.js';
import { projectInstallLevelCard } from './first-run-install-level-cards.js';
import { projectSetupChecklist } from './first-run-setup-checklist.js';
import { projectDeviceSummary } from './first-run-device-summary.js';
import { FirstRunWizardChrome } from './first-run-wizard-chrome.js';
import { PhaseStorage } from './phase-storage.js';
import { PhaseLocalAi } from './phase-local-ai.js';
import { PhaseSetup } from './phase-setup.js';
import { ScreenBlocked, ScreenReady, ScreenRepair } from './screen-terminal.js';

/**
 * Desktop first-run onboarding wizard.
 *
 * This is a pure presentation/projection over the product-control state
 * machine (cold-start-authority-contract P-COLD-009/014,
 * tables/first-run-state-machine.yaml). It renders the 12 spec-admitted
 * `ProductControlState` values as a guided 3-phase wizard plus 3 terminal
 * screens — see first-run-phase-projection.ts for the mapping. It does NOT
 * own, add, collapse, or rename any state-machine state, and it never writes
 * `ready_for_use`: backend admission (P-COLD-016) is the sole authority.
 *
 * The component name and the `data-testid="product-first-run-workflow"` /
 * `data-product-state` contract are preserved for the first-run gate and the
 * acceptance-evidence tests.
 */

type ProductControlWorkflowProps = {
  readonly projection: ProductControlRecordProjection | null;
  readonly onProjectionChange: (projection: ProductControlRecordProjection) => void;
};

/**
 * Which product-control setup states the renderer may persist via
 * `setProductFirstRunSetupState`. Mirrors the bridge's `Exclude<...>` on that
 * call: the renderer can persist Runtime-evidence progress states but never
 * `ready_for_use`, `local_ai_ready`, or the pre-setup states.
 */
function canPersistSetupState(
  state: ProductControlState,
): state is Exclude<
  ProductControlState,
  | 'ready_for_use'
  | 'local_ai_ready'
  | 'config_missing'
  | 'data_root_missing'
  | 'data_root_selected'
  | 'ai_environment_unconfigured'
  | 'not_logged_in'
> {
  return (
    state === 'local_ai_profile_selected_assets_missing'
    || state === 'local_ai_profile_selected_environment_not_ready'
    || state === 'local_ai_assets_downloaded_environment_not_ready'
    || state === 'repair_required'
    || state === 'blocked'
  );
}

/**
 * Defensive surface for the `not_logged_in` terminal screen that AppRoutes'
 * admission gate is expected to intercept upstream. If a regression ever lets
 * `not_logged_in` reach FirstRunGate, this renders an inert "reconciling…"
 * placeholder and logs once per mount — instead of a render-time `<Navigate>`
 * that would loop with LoginPage and trip the history.replaceState throttle.
 */
function FirstRunReconcilingScreen(props: { readonly productState: ProductControlState }): ReactElement {
  const { t } = useTranslation();
  useEffect(() => {
    logRendererEvent({
      level: 'warn',
      area: 'first-run',
      message: 'first-run-gate:not-logged-in-leaked-past-admission',
      details: {
        productState: props.productState,
      },
    });
  }, [props.productState]);
  return (
    <div
      data-testid="first-run-screen-reconciling"
      data-product-state={props.productState}
      className="flex flex-col items-center gap-3 text-center text-sm text-[var(--nimi-text-secondary)]"
    >
      <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
      <span>{t('FirstRun.reconcilingAuth', { defaultValue: 'Reconciling sign-in state…' })}</span>
    </div>
  );
}

export function ProductControlWorkflow(props: ProductControlWorkflowProps): ReactElement {
  const { t } = useTranslation();
  const projection = props.projection;
  const state: ProductControlState = projection?.state ?? 'config_missing';
  const notifyProjectionChange = props.onProjectionChange;

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(projection?.error ?? null);
  const [pickedPath, setPickedPath] = useState<string | null>(
    projection?.record?.dataRoot?.path ?? null,
  );
  const [materialization, setMaterialization] = useState<FirstRunMaterializationProjection | null>(null);
  const [deviceProfile, setDeviceProfile] = useState<LocalRuntimeDeviceProfile | null>(null);
  const [deviceScanSettled, setDeviceScanSettled] = useState(false);
  const resumingMaterializationRef = useRef(false);
  const autoRepairAttemptedKeysRef = useRef<Set<string>>(new Set());
  const autoRetryAttemptedKeysRef = useRef<Set<string>>(new Set());

  const busy = pendingAction !== null;

  // Factory AIProfile rows resolve the admitted Minimal / Recommended plans.
  const rows = useMemo(() => loadPlatformAIProfileFactoryRows(), []);
  const installPlans = useMemo(
    () => ({
      minimal: selectFactoryAIProfileForFirstRun(rows, 'minimal'),
      recommended: selectFactoryAIProfileForFirstRun(rows, 'recommended'),
    }),
    [rows],
  );
  const installLevelCards = useMemo(
    () => ({
      minimal: projectInstallLevelCard('minimal', installPlans.minimal),
      recommended: projectInstallLevelCard('recommended', installPlans.recommended),
    }),
    [installPlans],
  );

  const selectedInstallLevel = projection?.record?.firstRun.installLevel ?? null;
  const selectedPlan = selectedInstallLevel ? installPlans[selectedInstallLevel] : null;
  const selectedDataRoot = projection?.record?.dataRoot?.path ?? null;

  const screen = firstRunScreenForState(state);

  useEffect(() => {
    autoRepairAttemptedKeysRef.current.clear();
    autoRetryAttemptedKeysRef.current.clear();
  }, [selectedPlan?.alias, selectedDataRoot, selectedInstallLevel]);

  // Sync the picked path to the recorded data root whenever the projection
  // changes. A projection without a recorded data root (the Storage phase)
  // must NOT wipe an in-progress pick or the pre-filled default proposal —
  // only an actually-recorded path overrides what the field is showing.
  useEffect(() => {
    const recorded = projection?.record?.dataRoot?.path;
    if (recorded) setPickedPath(recorded);
    setError(projection?.error ?? null);
  }, [projection]);

  // `config_missing` is an internal first-run state: the backend creates the
  // empty product-control record, then the user-visible Storage phase starts
  // from `data_root_missing`.
  useEffect(() => {
    if (state !== 'config_missing' || !desktopBridge.hasTauriInvoke()) {
      return;
    }
    let disposed = false;
    setPendingAction('create-product-control-record');
    setError(null);
    void desktopBridge.ensureProductControlRecordCreated()
      .then((next) => {
        if (!disposed) notifyProjectionChange(next);
      })
      .catch((nextError) => {
        if (!disposed) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : t('FirstRun.errors.productControlCreateFailed', {
                  defaultValue: 'Failed to create the local Nimi product record.',
                }),
          );
        }
      })
      .finally(() => {
        if (!disposed) setPendingAction(null);
      });
    return () => {
      disposed = true;
    };
  }, [state, notifyProjectionChange, t]);

  // Pre-fill the Storage phase with the OS-conventional default `nimi_data`
  // location so a first-time user never faces an empty field. Fetched once on
  // mount and kept independent of projection updates, so the proposal is never
  // raced away by the projection sync above. This is only a proposal: the user
  // reviews it and either confirms it through `selectProductDataRoot`
  // (P-COLD-010 — the recorded path stays user-selected and explicitly
  // confirmed) or overrides it with the folder picker. `current ?? proposed`
  // never clobbers a recorded or user-picked path; an absent/failed proposal
  // leaves the field empty and fails closed — never a fabricated path.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const proposed = await desktopBridge.defaultProductDataRootDirectory();
        if (!disposed && proposed) {
          setPickedPath((current) => current ?? proposed);
        }
      } catch {
        // Fail-closed: leave the field empty; the folder picker stays available.
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  // Device-scan evidence for the Phase 2 "Detected:" line. The scan only feeds
  // that secondary line — it must never block the Local AI phase, which is
  // interactive from the local install-level catalog alone. The scan is bounded
  // by a timeout so a hung or unavailable Runtime (e.g. a daemon that needs a
  // restart) fails the line closed instead of leaving the phase spinning.
  // `deviceScanSettled` flips true once the scan resolves, fails, or times out.
  useEffect(() => {
    if (!selectedDataRoot) {
      setDeviceProfile(null);
      setDeviceScanSettled(true);
      return;
    }
    let disposed = false;
    setDeviceProfile(null);
    setDeviceScanSettled(false);
    void (async () => {
      try {
        const next = await Promise.race([
          localRuntime.collectDeviceProfile(),
          new Promise<LocalRuntimeDeviceProfile | null>((resolve) => {
            window.setTimeout(() => resolve(null), 8_000);
          }),
        ]);
        if (!disposed) setDeviceProfile(next);
      } catch {
        if (!disposed) setDeviceProfile(null);
      } finally {
        if (!disposed) setDeviceScanSettled(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [selectedDataRoot]);

  const projectMaterialization = useCallback(
    async (next: FirstRunMaterializationProjection, observedProductState?: ProductControlState): Promise<void> => {
      setMaterialization(next);
      if (
        next.productState !== observedProductState
        && canPersistSetupState(next.productState)
      ) {
        notifyProjectionChange(
          await desktopBridge.setProductFirstRunSetupState({
            state: next.productState,
            reason: next.reason,
          }),
        );
      }
    },
    [notifyProjectionChange],
  );

  // Runtime materialization observer. Active while setup/finalization can still
  // need Runtime-evidence progress. Even at `local_ai_ready`, a platform-dynamic
  // dependency projection may discover a missing Runtime prerequisite and move
  // the product record back to Setup before finalization retries.
  useEffect(() => {
    if (
      !selectedPlan
      || !selectedDataRoot
      || state === 'ai_environment_unconfigured'
      || state === 'data_root_selected'
    ) {
      setMaterialization(null);
      return;
    }
    const observedPlan = selectedPlan;
    const observedDataRoot = selectedDataRoot;
    const observedInstallLevel = selectedInstallLevel;
    const observedProductState = state;
    let disposed = false;
    async function observe(): Promise<void> {
      try {
        const next = await resolveFirstRunMaterializationProjection({
          profile: observedPlan,
          runtimeDataRoot: observedDataRoot,
          installLevel: observedInstallLevel,
        });
        if (disposed) return;
        if (shouldResumeConfirmedFirstRunMaterialization(observedProductState, next)) {
          if (resumingMaterializationRef.current) {
            await projectMaterialization(next, observedProductState);
            return;
          }
          resumingMaterializationRef.current = true;
          setPendingAction('resume-materialization');
          try {
            const resumed = await startFirstRunMaterialization({
              profile: observedPlan,
              runtimeDataRoot: observedDataRoot,
              installLevel: observedInstallLevel,
              confirmed: true,
            });
            if (!disposed) {
              await projectMaterialization(resumed, observedProductState);
            }
          } finally {
            resumingMaterializationRef.current = false;
            if (!disposed) setPendingAction(null);
          }
          return;
        }
        const retryableInterruptedJobs = retryableInterruptedFirstRunMaterializationJobs(
          observedProductState,
          next,
        ).filter((job) => {
          const key = [
            job.environmentKey,
            job.dependencyFamily,
            job.dependencyId,
            job.failureDetail || job.state,
          ].join('|');
          if (autoRetryAttemptedKeysRef.current.has(key)) return false;
          autoRetryAttemptedKeysRef.current.add(key);
          return true;
        });
        if (retryableInterruptedJobs.length > 0) {
          if (resumingMaterializationRef.current) {
            await projectMaterialization(next, observedProductState);
            return;
          }
          resumingMaterializationRef.current = true;
          setPendingAction('resume-materialization');
          try {
            await Promise.all(retryableInterruptedJobs.map((job) =>
              retryFirstRunMaterializationJob({
                profile: observedPlan,
                runtimeDataRoot: observedDataRoot,
                installLevel: observedInstallLevel,
                jobId: job.jobId,
                confirmed: true,
              }),
            ));
            const resumed = await resolveFirstRunMaterializationProjection({
              profile: observedPlan,
              runtimeDataRoot: observedDataRoot,
              installLevel: observedInstallLevel,
            });
            if (!disposed) {
              await projectMaterialization(resumed, observedProductState);
            }
          } finally {
            resumingMaterializationRef.current = false;
            if (!disposed) setPendingAction(null);
          }
          return;
        }
        const repairableDependencies = repairableConfirmedFirstRunMaterializationDependencies(
          observedProductState,
          next,
        ).filter(({ dependency }) => {
          const key = [
            dependency.environmentKey,
            dependency.dependencyFamily,
            dependency.dependencyId,
            dependency.reasonCode || '',
            dependency.detail || '',
          ].join('|');
          if (autoRepairAttemptedKeysRef.current.has(key)) return false;
          autoRepairAttemptedKeysRef.current.add(key);
          return true;
        });
        if (repairableDependencies.length > 0) {
          if (resumingMaterializationRef.current) {
            await projectMaterialization(next, observedProductState);
            return;
          }
          resumingMaterializationRef.current = true;
          setPendingAction('resume-materialization');
          try {
            await Promise.all(repairableDependencies.map(({ dependency }) =>
              repairFirstRunMaterializationDependency({
                profile: observedPlan,
                runtimeDataRoot: observedDataRoot,
                installLevel: observedInstallLevel,
                dependency,
                confirmed: true,
                reasonCode: dependency.reasonCode ?? next.reason,
              }),
            ));
            const repaired = await resolveFirstRunMaterializationProjection({
              profile: observedPlan,
              runtimeDataRoot: observedDataRoot,
              installLevel: observedInstallLevel,
            });
            if (!disposed) {
              await projectMaterialization(repaired, observedProductState);
            }
          } finally {
            resumingMaterializationRef.current = false;
            if (!disposed) setPendingAction(null);
          }
          return;
        }
        await projectMaterialization(next, observedProductState);
      } catch (nextError) {
        if (!disposed) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : t('FirstRun.errors.materializationObserveFailed', {
                  defaultValue: 'Failed to observe Runtime materialization.',
                }),
          );
        }
      }
    }
    void observe();
    const interval = window.setInterval(() => void observe(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [selectedPlan, selectedDataRoot, selectedInstallLevel, state, projectMaterialization, t]);

  // --- Phase 1: Storage ---------------------------------------------------

  // After `selectProductDataRoot` records the user-selected nimi_data root, the
  // runtime config must be updated to carry that data root before any Runtime
  // materialization starts. Desktop bootstrap runs before this Storage step, so
  // its config sync found no data root and failed closed; this is the seam that
  // makes the desktop→runtime data-root config sync effective. It reuses the
  // single `syncRuntimeStorageConfig` mechanism (the same one bootstrap uses),
  // resolves the freshly-recorded storage dirs, writes `dataRootRef` /
  // `managedRoots` into the runtime config, and restarts the managed runtime so
  // the config takes effect. A failure here fails closed — the user cannot
  // advance to materialization with a runtime config that has no data root.
  const syncRuntimeDataRootConfig = useCallback(async (): Promise<void> => {
    if (!desktopBridge.hasTauriInvoke()) {
      return;
    }
    await syncRuntimeStorageConfig({
      bridge: {
        getRuntimeBridgeStatus: () => desktopBridge.getRuntimeBridgeStatus(),
        getDesktopStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
        getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
        setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
        restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
      },
    });
  }, []);

  const chooseDataRootFolder = useCallback(async (): Promise<void> => {
    setPendingAction('pick-folder');
    setError(null);
    try {
      const picked = await desktopBridge.pickProductDataRootDirectory();
      if (picked) setPickedPath(picked);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.dataRootPickFailed', {
              defaultValue: 'Failed to open the folder picker.',
            }),
      );
    } finally {
      setPendingAction(null);
    }
  }, [t]);

  const confirmDataRoot = useCallback(async (): Promise<void> => {
    const candidate = (pickedPath ?? '').trim();
    if (!candidate) {
      setError(
        t('FirstRun.errors.dataRootMissing', {
          defaultValue: 'Choose a folder for Nimi before continuing.',
        }),
      );
      return;
    }
    setPendingAction('data-root');
    setError(null);
    try {
      // `selectProductDataRoot` is the sole owner of recording + fail-closed
      // validation (absolute path, writability, root layout). A non-absolute
      // or unusable path fails closed here with the backend's typed error.
      const next = await desktopBridge.selectProductDataRoot(candidate);
      // The runtime config must carry the freshly-recorded data root before
      // materialization; sync it now (fails closed if the runtime config write
      // fails) and only then advance the projection out of the Storage phase.
      await syncRuntimeDataRootConfig();
      notifyProjectionChange(next);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.dataRootRecordFailed', {
              defaultValue: 'Failed to record nimi_data.',
            }),
      );
    } finally {
      setPendingAction(null);
    }
  }, [pickedPath, notifyProjectionChange, syncRuntimeDataRootConfig, t]);

  // Changing the data root from the Local AI phase. The state machine admits
  // `change_nimi_data_before_heavy_setup` while no heavy setup has started, so
  // the user can re-pick the folder here. This re-opens the OS picker and lets
  // `selectProductDataRoot` re-record + re-validate — the renderer never
  // mutates the data root itself.
  const changeDataRootFolder = useCallback(async (): Promise<void> => {
    setPendingAction('change-data-root');
    setError(null);
    try {
      const picked = await desktopBridge.pickProductDataRootDirectory();
      if (!picked) return;
      const next = await desktopBridge.selectProductDataRoot(picked);
      // Re-pointing the data root before heavy setup must re-sync the runtime
      // config so the runtime resolves models under the new data root.
      await syncRuntimeDataRootConfig();
      notifyProjectionChange(next);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.dataRootRecordFailed', {
              defaultValue: 'Failed to record nimi_data.',
            }),
      );
    } finally {
      setPendingAction(null);
    }
  }, [notifyProjectionChange, syncRuntimeDataRootConfig, t]);

  // --- Phase 2: Local AI --------------------------------------------------

  const [draftInstallLevel, setDraftInstallLevel] = useState<FirstRunInstallLevel | null>(
    selectedInstallLevel,
  );
  useEffect(() => {
    if (selectedInstallLevel) setDraftInstallLevel(selectedInstallLevel);
  }, [selectedInstallLevel]);

  const persistInstallLevel = useCallback(
    async (installLevel: FirstRunInstallLevel): Promise<ProductControlRecordProjection | null> => {
      const plan = installPlans[installLevel];
      if (!plan) {
        setError(
          t('FirstRun.errors.installLevelNoProfile', {
            installLevel,
            defaultValue: '{{installLevel}} has no admitted local first-run AIProfile.',
          }),
        );
        return null;
      }
      const next = await desktopBridge.setProductFirstRunInstallLevel({
        installLevel,
        aiProfileAlias: plan.alias,
      });
      notifyProjectionChange(next);
      return next;
    },
    [installPlans, notifyProjectionChange, t],
  );

  const continueFromLocalAi = useCallback(async (): Promise<void> => {
    const installLevel = draftInstallLevel;
    if (!installLevel) {
      setError(
        t('FirstRun.errors.installLevelRequired', {
          defaultValue: 'Choose an install level to continue.',
        }),
      );
      return;
    }
    const plan = installPlans[installLevel];
    if (!plan) {
      setError(
        t('FirstRun.errors.installLevelNoProfile', {
          installLevel,
          defaultValue: '{{installLevel}} has no admitted local first-run AIProfile.',
        }),
      );
      return;
    }
    setPendingAction('install-level');
    setError(null);
    try {
      // 1) Record the install level on the product-control record.
      const afterLevel = await persistInstallLevel(installLevel);
      if (!afterLevel) return;
      const dataRoot = afterLevel.record?.dataRoot?.path ?? selectedDataRoot;
      if (!dataRoot) {
        setError(
          t('FirstRun.errors.materializationPrerequisitesMissing', {
            defaultValue:
              'Select a first-run install level and nimi_data path before Runtime setup.',
          }),
        );
        return;
      }
      // 2) Start Runtime materialization (explicit confirmation — this is the
      //    first storage/network-heavy step) and persist the resulting setup
      //    state so the gate advances into the Setup phase.
      const next = await startFirstRunMaterialization({
        profile: plan,
        runtimeDataRoot: dataRoot,
        installLevel,
        confirmed: true,
      });
      await projectMaterialization(next, afterLevel.state);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.materializationStartFailed', {
              defaultValue: 'Failed to start Runtime materialization.',
            }),
      );
    } finally {
      setPendingAction(null);
    }
  }, [draftInstallLevel, installPlans, persistInstallLevel, selectedDataRoot, projectMaterialization, t]);

  // --- Phase 3: Setup checklist actions -----------------------------------

  const retrySetupStep = useCallback(
    async (item: FirstRunMaterializationDependencyProjection): Promise<void> => {
      if (!selectedPlan || !selectedDataRoot || !item.job) return;
      setPendingAction(`retry-${item.job.jobId}`);
      setError(null);
      try {
        await projectMaterialization(
          await retryFirstRunMaterializationJob({
            profile: selectedPlan,
            runtimeDataRoot: selectedDataRoot,
            installLevel: selectedInstallLevel,
            jobId: item.job.jobId,
            confirmed: true,
          }),
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : t('FirstRun.errors.materializationRetryFailed', {
                defaultValue: 'Failed to retry Runtime job.',
              }),
        );
      } finally {
        setPendingAction(null);
      }
    },
    [selectedPlan, selectedDataRoot, selectedInstallLevel, projectMaterialization, t],
  );

  const repairSetupStep = useCallback(
    async (item: FirstRunMaterializationDependencyProjection): Promise<void> => {
      if (!selectedPlan || !selectedDataRoot) return;
      setPendingAction(`repair-${item.dependency.environmentKey}`);
      setError(null);
      try {
        await projectMaterialization(
          await repairFirstRunMaterializationDependency({
            profile: selectedPlan,
            runtimeDataRoot: selectedDataRoot,
            installLevel: selectedInstallLevel,
            dependency: item.dependency,
            confirmed: true,
            reasonCode: item.dependency.reasonCode ?? item.job?.failureDetail ?? materialization?.reason,
          }),
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : t('FirstRun.errors.materializationRepairFailed', {
                defaultValue: 'Failed to repair Runtime dependency.',
              }),
        );
      } finally {
        setPendingAction(null);
      }
    },
    [selectedPlan, selectedDataRoot, selectedInstallLevel, projectMaterialization, materialization, t],
  );

  const cancelSetupStep = useCallback(
    async (item: FirstRunMaterializationDependencyProjection): Promise<void> => {
      if (!selectedPlan || !selectedDataRoot || !item.job) return;
      setPendingAction(`cancel-${item.job.jobId}`);
      setError(null);
      try {
        await projectMaterialization(
          await cancelFirstRunMaterializationJob({
            profile: selectedPlan,
            runtimeDataRoot: selectedDataRoot,
            installLevel: selectedInstallLevel,
            jobId: item.job.jobId,
          }),
        );
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : t('FirstRun.errors.materializationCancelFailed', {
                defaultValue: 'Failed to cancel Runtime job.',
              }),
        );
      } finally {
        setPendingAction(null);
      }
    },
    [selectedPlan, selectedDataRoot, selectedInstallLevel, projectMaterialization, t],
  );

  // --- Terminal screen actions -------------------------------------------

  const reevaluatingRef = useRef(false);
  const reevaluateProductControl = useCallback(async (): Promise<void> => {
    if (reevaluatingRef.current) return;
    reevaluatingRef.current = true;
    setPendingAction('reevaluate');
    setError(null);
    try {
      notifyProjectionChange(await desktopBridge.getProductControlRecord());
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.repairReevaluateFailed', {
              defaultValue: 'Failed to re-check Nimi setup.',
            }),
      );
    } finally {
      reevaluatingRef.current = false;
      setPendingAction(null);
    }
  }, [notifyProjectionChange, t]);

  // --- Render -------------------------------------------------------------

  const setupChecklist = useMemo(
    () => projectSetupChecklist(state, materialization),
    [state, materialization],
  );
  const deviceSummary = useMemo(() => projectDeviceSummary(deviceProfile), [deviceProfile]);
  const materializationReadyForFinalization = materialization?.productState === 'local_ai_ready';

  function renderScreen(): ReactElement {
    if (screen.kind === 'terminal') {
      if (screen.screen === 'login') {
        // Wave 1 route-admission single-point: `not_logged_in` is intercepted
        // by AppRoutes' useDesktopOrdinaryShellAdmission before FirstRunGate
        // ever mounts, so this branch is unreachable in normal operation. We
        // keep a defensive inert surface (no `<Navigate>`) so a regression
        // that leaks `not_logged_in` past the admission gate fails closed to
        // a loading screen — not a render-time history.replaceState loop that
        // crashes the renderer.
        return <FirstRunReconcilingScreen productState={state} />;
      }
      if (screen.screen === 'repair') {
        return (
          <ScreenRepair
            reason={projection?.record?.repair.reason ?? projection?.error ?? null}
            busy={busy}
            onRetry={() => void reevaluateProductControl()}
          />
        );
      }
      if (screen.screen === 'blocked') {
        return <ScreenBlocked reason={projection?.error ?? null} />;
      }
      return <ScreenReady />;
    }

    if (screen.phase === 'storage') {
      return (
        <PhaseStorage
          transient={isPhaseTransient(state)}
          pickedPath={pickedPath}
          busy={busy}
          onChooseFolder={() => void chooseDataRootFolder()}
          onContinue={() => void confirmDataRoot()}
        />
      );
    }

    if (screen.phase === 'local-ai') {
      return (
        <PhaseLocalAi
          cards={installLevelCards}
          selected={draftInstallLevel}
          deviceSummary={deviceSummary}
          deviceScanPending={!deviceScanSettled}
          dataRootPath={selectedDataRoot}
          busy={busy}
          onSelect={setDraftInstallLevel}
          onChangeDataRoot={() => void changeDataRootFolder()}
          onContinue={() => void continueFromLocalAi()}
        />
      );
    }

    // Setup phase. At `local_ai_ready` the finalization surface drives the
    // backend admission request; the calm checklist still shows the folded
    // progression with `finalize` as the active sub-step.
    return (
      <div className="flex flex-col gap-6">
        <PhaseSetup
          checklist={setupChecklist}
          busy={busy}
          error={error}
          actions={{
            onRetry: (item) => void retrySetupStep(item),
            onRepair: (item) => void repairSetupStep(item),
            onCancel: (item) => void cancelSetupStep(item),
          }}
        />
        {(state === 'local_ai_ready' || materializationReadyForFinalization) && projection ? (
          <FirstRunFinalization projection={projection} onProjectionChange={notifyProjectionChange} />
        ) : null}
      </div>
    );
  }

  return (
    <section
      data-testid="product-first-run-workflow"
      data-product-state={state}
      className="flex min-h-full flex-1 flex-col"
    >
      <FirstRunWizardChrome activePhase={screen.kind === 'phase' ? screen.phase : null}>
        {/* The Storage / Local-AI phases surface typed errors inline above the
            card content; the Setup phase renders its own error row. */}
        {screen.kind === 'phase' && screen.phase !== 'setup' && error ? (
          <p
            data-testid="product-first-run-error"
            className="mb-5 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,white)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,white)] px-3 py-2 text-sm text-[var(--nimi-status-danger)]"
          >
            {error}
          </p>
        ) : null}
        {renderScreen()}
      </FirstRunWizardChrome>
    </section>
  );
}
