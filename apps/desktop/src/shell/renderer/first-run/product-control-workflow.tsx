import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadNimiAppAIProfileFactoryRows,
  selectNimiAppFactoryAIProfileForFirstRun,
  type NimiFirstRunInstallLevel,
} from '@nimiplatform/sdk/app';
import {
  isNimiProductControlPhaseTransient,
  projectNimiProductControlFirstRunScreen,
} from '@nimiplatform/sdk/runtime';
import { desktopBridge, type NimiProductControlRecordProjection, type NimiProductControlState } from '@renderer/bridge';
import {
  cancelDesktopNimiFirstRunMaterializationJob,
  repairDesktopNimiFirstRunMaterializationDependency,
  retryDesktopNimiFirstRunMaterializationJob,
  startDesktopNimiFirstRunMaterialization,
  type NimiFirstRunMaterializationDependencyProjection,
  type NimiFirstRunMaterializationProjection,
} from './runtime-materialization.js';
import { FirstRunReconcilingScreen } from './first-run-reconciling-screen.js';
import { useFirstRunMaterializationObserver } from './use-first-run-materialization-observer.js';
import { projectInstallLevelCard } from './first-run-install-level-cards.js';
import { projectSetupChecklist, type FirstRunSetupStepId } from './first-run-setup-checklist.js';
import { useFirstRunDeviceScan } from './use-first-run-device-scan.js';
import { FirstRunWizardChrome } from './first-run-wizard-chrome.js';
import { ProductControlWorkflowScreen } from './product-control-workflow-screen.js';
import type { FirstRunSetupStatusDetails } from './phase-setup.js';

/**
 * Desktop first-run onboarding wizard.
 *
 * This is a pure presentation/projection over the product-control state
 * machine (cold-start-authority-contract P-COLD-009/014,
 * tables/first-run-state-machine.yaml). It renders the 12 spec-admitted
 * `NimiProductControlState` values as a guided 4-phase wizard plus 3 terminal
 * screens — see the SDK product-control projection for the mapping. It does NOT
 * own, add, collapse, or rename any state-machine state, and it never writes
 * `ready_for_use`: backend admission (P-COLD-016) is the sole authority.
 *
 * The component name and the `data-testid="product-first-run-workflow"` /
 * `data-product-state` contract are preserved for the first-run gate and the
 * acceptance-evidence tests.
 */

type ProductControlWorkflowProps = {
  readonly projection: NimiProductControlRecordProjection | null;
  readonly onProjectionChange: (projection: NimiProductControlRecordProjection) => void;
};

const SETUP_TICK_MS = 1_000;
const SETUP_INFO_NOTICE_MS = 45_000;
const SETUP_STALL_NOTICE_MS = 60_000;

export function resolveProductControlWorkflowError(
  actionError: string | null,
  observerError: string | null,
  projectionError: string | null | undefined,
): string | null {
  return actionError ?? observerError ?? projectionError ?? null;
}

const SETUP_STEP_LABEL_DEFAULTS: Record<FirstRunSetupStepId, string> = {
  download: 'Downloading local models',
  verify: 'Verifying files',
  environment: 'Preparing local environment',
  finalize: 'Finalizing your AI profile',
};

function formatSetupDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

export type FirstRunDataRootPickAuthority = 'record' | 'runtime' | 'user' | 'fallback';

export function resolveProjectedDataRootPick(input: {
  readonly currentPath: string | null;
  readonly currentAuthority: FirstRunDataRootPickAuthority;
  readonly recordedPath: string | null;
  readonly runtimeProposalPath: string | null;
}): { readonly path: string | null; readonly authority: FirstRunDataRootPickAuthority } {
  if (input.recordedPath) return { path: input.recordedPath, authority: 'record' };
  if (input.runtimeProposalPath && input.currentAuthority !== 'user') {
    return { path: input.runtimeProposalPath, authority: 'runtime' };
  }
  return { path: input.currentPath, authority: input.currentAuthority };
}

export function ProductControlWorkflow(props: ProductControlWorkflowProps): ReactElement {
  const { t } = useTranslation();
  const projection = props.projection;
  const state: NimiProductControlState = projection?.state ?? 'config_missing';
  const notifyProjectionChange = props.onProjectionChange;

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [observerError, setObserverError] = useState<string | null>(null);
  const error = resolveProductControlWorkflowError(actionError, observerError, projection?.error);
  const setError = setActionError;
  const runtimeDataRootProposal = projection?.dataRootProposal?.path ?? null;
  const pickedPathAuthorityRef = useRef<FirstRunDataRootPickAuthority>(
    projection?.record?.dataRoot?.path
      ? 'record'
      : runtimeDataRootProposal
        ? 'runtime'
        : 'fallback',
  );
  const [pickedPath, setPickedPath] = useState<string | null>(
    projection?.record?.dataRoot?.path ?? runtimeDataRootProposal,
  );
  const [materialization, setMaterialization] = useState<NimiFirstRunMaterializationProjection | null>(null);

  const busy = pendingAction !== null;

  // Factory AIProfile rows resolve the admitted Minimal / Recommended plans.
  const rows = useMemo(() => loadNimiAppAIProfileFactoryRows(), []);
  const installPlans = useMemo(
    () => ({
      minimal: selectNimiAppFactoryAIProfileForFirstRun(rows, 'minimal'),
      recommended: selectNimiAppFactoryAIProfileForFirstRun(rows, 'recommended'),
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

  const screen = projectNimiProductControlFirstRunScreen(state);
  const setupVisible = screen.kind === 'phase' && screen.phase === 'setup';
  const returnRunReadyRecordReconciling =
    projection?.record?.state === 'ready_for_use'
    && state !== 'ready_for_use'
    && setupVisible
    && !error;
  const [setupEnteredAtMs, setSetupEnteredAtMs] = useState(() => Date.now());
  const [setupNowMs, setSetupNowMs] = useState(() => Date.now());
  const [lastSetupCheckedAtMs, setLastSetupCheckedAtMs] = useState(() => Date.now());
  const [lastSetupProgressChangedAtMs, setLastSetupProgressChangedAtMs] = useState(() => Date.now());
  const setupVisibleRef = useRef(false);
  const markSetupChecked = useCallback((): void => {
    const now = Date.now();
    setSetupNowMs(now);
    setLastSetupCheckedAtMs(now);
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (setupVisible && !setupVisibleRef.current) {
      setSetupEnteredAtMs(now);
      setSetupNowMs(now);
      setLastSetupCheckedAtMs(now);
      setLastSetupProgressChangedAtMs(now);
    }
    setupVisibleRef.current = setupVisible;
  }, [setupVisible]);

  useEffect(() => {
    if (!setupVisible) return;
    const intervalId = window.setInterval(() => {
      setSetupNowMs(Date.now());
    }, SETUP_TICK_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [setupVisible]);

  // A recorded Product Control root always wins. Before recording, the
  // Runtime-owned proposal supersedes only the renderer fallback; an explicit
  // user folder pick remains stable until it is confirmed.
  useEffect(() => {
    const recorded = projection?.record?.dataRoot?.path;
    setPickedPath((currentPath) => {
      const next = resolveProjectedDataRootPick({
        currentPath,
        currentAuthority: pickedPathAuthorityRef.current,
        recordedPath: recorded ?? null,
        runtimeProposalPath: runtimeDataRootProposal,
      });
      pickedPathAuthorityRef.current = next.authority;
      return next.path;
    });
  }, [projection, runtimeDataRootProposal]);

  // `config_missing` is an internal first-run state: the backend creates the
  // empty product-control record, then the user-visible Storage phase starts
  // from `data_root_missing`.
  useEffect(() => {
    if (state !== 'config_missing' || !desktopBridge.hasShellHostInvoke()) {
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

  // Production keeps the OS-conventional path as a renderer fallback only
  // when Runtime supplies no checkpoint proposal. It never records a path and
  // cannot override a Runtime projection or an explicit user pick.
  useEffect(() => {
    if (runtimeDataRootProposal) return;
    let disposed = false;
    void (async () => {
      try {
        const proposed = await desktopBridge.defaultProductDataRootDirectory();
        if (!disposed && proposed) {
          setPickedPath((current) => {
            if (current) return current;
            pickedPathAuthorityRef.current = 'fallback';
            return proposed;
          });
        }
      } catch {
        // Fail-closed: leave the field empty; the folder picker stays available.
      }
    })();
    return () => {
      disposed = true;
    };
  }, [runtimeDataRootProposal]);

  const { deviceSummary, deviceScanSettled, retryDeviceScan } = useFirstRunDeviceScan(selectedDataRoot);

  const projectMaterialization = useCallback(
    async (next: NimiFirstRunMaterializationProjection, observedProductState?: NimiProductControlState): Promise<void> => {
      // A successful Runtime materialization projection supersedes stale
      // product-control ready-read verification errors from a recoverable
      // Setup downgrade. A clean observer sample may clear only a previous
      // observer failure. It must never erase an action failure that still
      // needs the user's retry or a successful replacement action.
      markSetupChecked();
      setObserverError(null);
      setMaterialization(next);
      if (
        next.productState !== observedProductState
        && next.productState !== 'local_ai_ready'
      ) {
        notifyProjectionChange(
          await desktopBridge.reconcileProductFirstRunSetupState(),
        );
      }
    },
    [markSetupChecked, notifyProjectionChange],
  );

  useFirstRunMaterializationObserver({
    selectedPlan,
    selectedDataRoot,
    selectedInstallLevel,
    state,
    projectMaterialization,
    setMaterialization,
    setPendingAction,
    setError: setObserverError,
    observeFailedFallback: t('FirstRun.errors.materializationObserveFailed', {
      defaultValue: 'Failed to observe Runtime materialization.',
    }),
  });

  // --- Phase 1: Storage ---------------------------------------------------

  // After `selectProductDataRoot` records the user-selected nimi_data root, the
  // runtime config must be updated to carry that data root before any Runtime
  // materialization starts. Desktop bootstrap runs before this Storage step, so
  // its config sync found no data root and failed closed; this is the seam that
  // makes the desktop→runtime data-root config sync effective. It reuses the
  // typed Product Control projection (the same one Runtime materialization uses),
  // resolves the freshly-recorded storage dirs, writes `dataRootRef` /
  // `managedRoots` into the runtime config, and restarts the managed runtime so
  // the config takes effect. A failure here fails closed — the user cannot
  // advance to materialization with a runtime config that has no data root.
  const chooseDataRootFolder = useCallback(async (): Promise<void> => {
    setPendingAction('pick-folder');
    setError(null);
    try {
      const picked = await desktopBridge.pickProductDataRootDirectory();
      if (picked) {
        pickedPathAuthorityRef.current = 'user';
        setPickedPath(picked);
      }
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
  }, [pickedPath, notifyProjectionChange, t]);

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
  }, [notifyProjectionChange, t]);

  const continueFromDeviceScan = useCallback(async (): Promise<void> => {
    if (deviceScanSettled && !deviceSummary) {
      setError(
        t('FirstRun.errors.deviceScanUnavailable', {
          defaultValue: 'Device scan evidence is required before local AI setup.',
        }),
      );
      return;
    }
    if (!deviceScanSettled) return;
    setPendingAction('device-scan');
    setError(null);
    try {
      const next = await desktopBridge.completeProductFirstRunDeviceEnvironmentScan();
      notifyProjectionChange(next);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.deviceScanRecordFailed', {
              defaultValue: 'Failed to record device scan completion.',
            }),
      );
    } finally {
      setPendingAction(null);
    }
  }, [deviceScanSettled, deviceSummary, notifyProjectionChange, t]);

  // --- Phase 2: Local AI --------------------------------------------------

  const [draftInstallLevel, setDraftInstallLevel] = useState<NimiFirstRunInstallLevel | null>(
    selectedInstallLevel,
  );
  useEffect(() => {
    if (selectedInstallLevel) setDraftInstallLevel(selectedInstallLevel);
  }, [selectedInstallLevel]);

  const persistInstallLevel = useCallback(
    async (installLevel: NimiFirstRunInstallLevel): Promise<NimiProductControlRecordProjection | null> => {
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
      const next = await startDesktopNimiFirstRunMaterialization({
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
    async (item: NimiFirstRunMaterializationDependencyProjection): Promise<void> => {
      if (!selectedPlan || !selectedDataRoot || !item.job) return;
      setPendingAction(`retry-${item.job.jobId}`);
      setError(null);
      try {
        await projectMaterialization(
          await retryDesktopNimiFirstRunMaterializationJob({
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
    async (item: NimiFirstRunMaterializationDependencyProjection): Promise<void> => {
      if (!selectedPlan || !selectedDataRoot) return;
      setPendingAction(`repair-${item.dependency.environmentKey}`);
      setError(null);
      try {
        await projectMaterialization(
          await repairDesktopNimiFirstRunMaterializationDependency({
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
    async (item: NimiFirstRunMaterializationDependencyProjection): Promise<void> => {
      if (!selectedPlan || !selectedDataRoot || !item.job) return;
      setPendingAction(`cancel-${item.job.jobId}`);
      setError(null);
      try {
        await projectMaterialization(
          await cancelDesktopNimiFirstRunMaterializationJob({
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
    markSetupChecked();
    setPendingAction('reevaluate');
    setError(null);
    try {
      const next = await desktopBridge.getProductControlRecord();
      const nextScreen = projectNimiProductControlFirstRunScreen(next.state);
      if (
        setupVisible
        && next.state !== 'ready_for_use'
        && nextScreen.kind === 'phase'
        && nextScreen.phase === 'setup'
      ) {
        notifyProjectionChange(await desktopBridge.reconcileProductFirstRunSetupState());
      } else {
        notifyProjectionChange(next);
      }
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
  }, [markSetupChecked, notifyProjectionChange, setupVisible, t]);

  // --- Render -------------------------------------------------------------

  const setupChecklist = useMemo(
    () => projectSetupChecklist(state, materialization),
    [state, materialization],
  );
  const setupProgressSignature = useMemo(
    () => [
      state,
      materialization?.status ?? 'no-materialization',
      materialization?.productState ?? 'no-product-state',
      materialization?.reason ?? 'no-reason',
      setupChecklist.progressPercent,
      setupChecklist.steps.map((step) => [
        step.id,
        step.status,
        step.downloadProgress?.bytesReceived ?? 'no-bytes',
        step.downloadProgress?.percent ?? 'no-percent',
      ].join('/')).join('|'),
    ].join('::'),
    [materialization, setupChecklist, state],
  );
  const setupProgressSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!setupVisible) {
      setupProgressSignatureRef.current = setupProgressSignature;
      return;
    }
    if (setupProgressSignatureRef.current === null) {
      setupProgressSignatureRef.current = setupProgressSignature;
      return;
    }
    if (setupProgressSignatureRef.current !== setupProgressSignature) {
      setupProgressSignatureRef.current = setupProgressSignature;
      const now = Date.now();
      setSetupNowMs(now);
      setLastSetupCheckedAtMs(now);
      setLastSetupProgressChangedAtMs(now);
    }
  }, [setupProgressSignature, setupVisible]);

  const setupStatusDetails = useMemo<FirstRunSetupStatusDetails>(() => {
    const activeStep = (
      setupChecklist.steps.find((step) => step.status === 'failed')
      ?? setupChecklist.steps.find((step) => step.status === 'active')
      ?? setupChecklist.steps[0]
      ?? null
    );
    const activeStepLabel = activeStep
      ? t(`FirstRun.setup.steps.${activeStep.id}`, {
          defaultValue: SETUP_STEP_LABEL_DEFAULTS[activeStep.id],
        })
      : t('FirstRun.setup.steps.unknown', { defaultValue: 'Waiting for Runtime setup' });
    const checkedAgeMs = Math.max(0, setupNowMs - lastSetupCheckedAtMs);
    const progressAgeMs = Math.max(0, setupNowMs - lastSetupProgressChangedAtMs);
    const relativeAge = (ageMs: number): string => {
      if (ageMs < 5_000) {
        return t('FirstRun.setup.justNow', { defaultValue: 'just now' });
      }
      return t('FirstRun.setup.ago', {
        defaultValue: '{{duration}} ago',
        duration: formatSetupDuration(ageMs),
      });
    };
    const notice = (() => {
      if (error) return null;
      if (setupChecklist.hasFailure) {
        return {
          tone: 'warning' as const,
          message: t('FirstRun.setup.notices.actionRequired', {
            defaultValue: 'A setup step needs attention. Use Retry or Repair on the failed row.',
          }),
        };
      }
      if (progressAgeMs >= SETUP_STALL_NOTICE_MS) {
        return {
          tone: 'warning' as const,
          message: t('FirstRun.setup.notices.maybeStalled', {
            defaultValue: 'This may be stalled. Re-check setup to refresh the local record.',
          }),
        };
      }
      if (progressAgeMs >= SETUP_INFO_NOTICE_MS) {
        return {
          tone: 'info' as const,
          message: t('FirstRun.setup.notices.stillChecking', {
            defaultValue: 'Still checking Runtime setup. Last progress changed {{duration}} ago.',
            duration: formatSetupDuration(progressAgeMs),
          }),
        };
      }
      return null;
    })();

    return {
      elapsedLabel: formatSetupDuration(Math.max(0, setupNowMs - setupEnteredAtMs)),
      lastCheckedLabel: relativeAge(checkedAgeMs),
      lastStateChangeLabel: relativeAge(progressAgeMs),
      productState: state,
      productStateLabel: t(`FirstRun.states.${state}.title`, { defaultValue: activeStepLabel }),
      installLevel: selectedInstallLevel,
      dataRootPath: selectedDataRoot,
      activeStepLabel,
      materializationStatus: materialization?.status ?? null,
      reason: materialization?.reason ?? projection?.error ?? null,
      notice,
    };
  }, [
    error,
    lastSetupCheckedAtMs,
    lastSetupProgressChangedAtMs,
    materialization,
    projection?.error,
    selectedDataRoot,
    selectedInstallLevel,
    setupChecklist,
    setupEnteredAtMs,
    setupNowMs,
    state,
    t,
  ]);
  const materializationReadyForFinalization = materialization?.productState === 'local_ai_ready';

  if (returnRunReadyRecordReconciling) {
    return (
      <section
        data-testid="product-first-run-workflow"
        data-product-state={state}
        className="flex min-h-full flex-1 items-center justify-center px-6 py-8"
      >
        <FirstRunReconcilingScreen productState={state} mode="ready-record" />
      </section>
    );
  }

  return (
    <section
      data-testid="product-first-run-workflow"
      data-product-state={state}
      data-pending-action={pendingAction ?? ''}
      aria-busy={busy || undefined}
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
        <ProductControlWorkflowScreen
          busy={busy}
          deviceScanSettled={deviceScanSettled}
          deviceSummary={deviceSummary}
          draftInstallLevel={draftInstallLevel}
          error={error}
          installLevelCards={installLevelCards}
          materializationReadyForFinalization={materializationReadyForFinalization}
          onCancelSetupStep={(item) => void cancelSetupStep(item)}
          onChangeDataRootFolder={() => void changeDataRootFolder()}
          onChooseDataRootFolder={() => void chooseDataRootFolder()}
          onConfirmDataRoot={() => void confirmDataRoot()}
          onContinueFromDeviceScan={() => void continueFromDeviceScan()}
          onContinueFromLocalAi={() => void continueFromLocalAi()}
          onProjectionChange={notifyProjectionChange}
          onReevaluateProductControl={() => void reevaluateProductControl()}
          onRepairSetupStep={(item) => void repairSetupStep(item)}
          onRetryDeviceScan={retryDeviceScan}
          onRetrySetupStep={(item) => void retrySetupStep(item)}
          onSelectInstallLevel={setDraftInstallLevel}
          pickedPath={pickedPath}
          projection={projection}
          screen={screen}
          selectedDataRoot={selectedDataRoot}
          setupChecklist={setupChecklist}
          setupStatusDetails={setupStatusDetails}
          state={state}
          storageTransient={isNimiProductControlPhaseTransient(state)}
        />
      </FirstRunWizardChrome>
    </section>
  );
}
