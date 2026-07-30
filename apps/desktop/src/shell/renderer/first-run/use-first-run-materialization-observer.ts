import { useEffect, useRef } from 'react';
import type {
  NimiAppAIProfileFactoryRow,
  NimiFirstRunInstallLevel,
} from '@nimiplatform/sdk/app';
import type { NimiProductControlState } from '../bridge';
import {
  repairableConfirmedNimiFirstRunMaterializationDependencies,
  retryableInterruptedNimiFirstRunMaterializationJobsForProductState,
  shouldResumeConfirmedNimiFirstRunMaterialization,
  type NimiFirstRunMaterializationProjection,
} from './runtime-materialization.js';
import type { DesktopRendererClockView } from '../renderer/contract.js';
import type { DesktopRendererFirstRunPort } from '../renderer/first-run-port.js';

type UseFirstRunMaterializationObserverInput = {
  readonly clock: DesktopRendererClockView;
  readonly firstRun: DesktopRendererFirstRunPort;
  readonly selectedPlan: NimiAppAIProfileFactoryRow | null;
  readonly selectedDataRoot: string | null;
  readonly selectedInstallLevel: NimiFirstRunInstallLevel | null;
  readonly state: NimiProductControlState;
  readonly projectMaterialization: (
    next: NimiFirstRunMaterializationProjection,
    observedProductState?: NimiProductControlState,
  ) => Promise<void>;
  readonly setMaterialization: (next: NimiFirstRunMaterializationProjection | null) => void;
  readonly setPendingAction: (action: string | null) => void;
  readonly setError: (message: string | null) => void;
  readonly observeFailedFallback: string;
};

export function useFirstRunMaterializationObserver(
  input: UseFirstRunMaterializationObserverInput,
): void {
  const resumingMaterializationRef = useRef(false);
  const autoRepairAttemptedKeysRef = useRef<Set<string>>(new Set());
  const autoRetryAttemptedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    autoRepairAttemptedKeysRef.current.clear();
    autoRetryAttemptedKeysRef.current.clear();
  }, [input.selectedPlan?.alias, input.selectedDataRoot, input.selectedInstallLevel]);

  // Runtime materialization observer. Active while setup/finalization can still
  // need current Runtime progress. Even at `local_ai_ready`, a platform-dynamic
  // dependency projection may discover a missing Runtime prerequisite and move
  // the product record back to Setup before finalization retries.
  useEffect(() => {
    if (
      !input.selectedPlan
      || !input.selectedDataRoot
      || input.state === 'ai_environment_unconfigured'
      || input.state === 'data_root_selected'
    ) {
      input.setMaterialization(null);
      return;
    }
    const observedPlan = input.selectedPlan;
    const observedDataRoot = input.selectedDataRoot;
    const observedInstallLevel = input.selectedInstallLevel;
    const observedProductState = input.state;
    let disposed = false;
    async function observe(): Promise<void> {
      try {
        const next = await input.firstRun.resolveMaterialization({
          profile: observedPlan,
          runtimeDataRoot: observedDataRoot,
          installLevel: observedInstallLevel,
        });
        if (disposed) return;
        if (shouldResumeConfirmedNimiFirstRunMaterialization(observedProductState, next)) {
          if (resumingMaterializationRef.current) {
            await input.projectMaterialization(next, observedProductState);
            return;
          }
          resumingMaterializationRef.current = true;
          input.setPendingAction('resume-materialization');
          try {
            const resumed = await input.firstRun.startMaterialization({
              profile: observedPlan,
              runtimeDataRoot: observedDataRoot,
              installLevel: observedInstallLevel,
              confirmed: true,
            });
            if (!disposed) {
              await input.projectMaterialization(resumed, observedProductState);
            }
          } finally {
            resumingMaterializationRef.current = false;
            if (!disposed) input.setPendingAction(null);
          }
          return;
        }
        const retryableInterruptedJobs = retryableInterruptedNimiFirstRunMaterializationJobsForProductState(
          observedProductState,
          next,
        ).filter((job) => {
          const key = [
            job.environmentKey,
            job.dependencyFamily,
            job.dependencyId,
            job.consumerScope,
            job.reasonCode || job.state,
            job.recoveryDisposition || '',
          ].join('|');
          if (autoRetryAttemptedKeysRef.current.has(key)) return false;
          autoRetryAttemptedKeysRef.current.add(key);
          return true;
        });
        if (retryableInterruptedJobs.length > 0) {
          if (resumingMaterializationRef.current) {
            await input.projectMaterialization(next, observedProductState);
            return;
          }
          resumingMaterializationRef.current = true;
          input.setPendingAction('resume-materialization');
          try {
            await Promise.all(retryableInterruptedJobs.map((job) =>
              input.firstRun.retryMaterializationJob({
                profile: observedPlan,
                runtimeDataRoot: observedDataRoot,
                installLevel: observedInstallLevel,
                jobId: job.jobId,
                confirmed: true,
              }),
            ));
            const resumed = await input.firstRun.resolveMaterialization({
              profile: observedPlan,
              runtimeDataRoot: observedDataRoot,
              installLevel: observedInstallLevel,
            });
            if (!disposed) {
              await input.projectMaterialization(resumed, observedProductState);
            }
          } finally {
            resumingMaterializationRef.current = false;
            if (!disposed) input.setPendingAction(null);
          }
          return;
        }
        const repairableDependencies = repairableConfirmedNimiFirstRunMaterializationDependencies(
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
            await input.projectMaterialization(next, observedProductState);
            return;
          }
          resumingMaterializationRef.current = true;
          input.setPendingAction('resume-materialization');
          try {
            await Promise.all(repairableDependencies.map(({ dependency }) =>
              input.firstRun.repairMaterializationDependency({
                profile: observedPlan,
                runtimeDataRoot: observedDataRoot,
                installLevel: observedInstallLevel,
                dependency,
                confirmed: true,
                reasonCode: dependency.reasonCode ?? next.reason,
              }),
            ));
            const repaired = await input.firstRun.resolveMaterialization({
              profile: observedPlan,
              runtimeDataRoot: observedDataRoot,
              installLevel: observedInstallLevel,
            });
            if (!disposed) {
              await input.projectMaterialization(repaired, observedProductState);
            }
          } finally {
            resumingMaterializationRef.current = false;
            if (!disposed) input.setPendingAction(null);
          }
          return;
        }
        await input.projectMaterialization(next, observedProductState);
      } catch (nextError) {
        if (!disposed) {
          input.setError(
            nextError instanceof Error
              ? nextError.message
              : input.observeFailedFallback,
          );
        }
      }
    }
    void observe();
    let cancel: () => void = () => undefined;
    const schedule = () => {
      cancel = input.clock.schedule(3_000, (result) => {
        if (disposed || !result.ok) return;
        void observe().finally(() => {
          if (!disposed) schedule();
        });
      });
    };
    schedule();
    return () => {
      disposed = true;
      cancel();
    };
  }, [
    input.selectedPlan,
    input.selectedDataRoot,
    input.selectedInstallLevel,
    input.state,
    input.projectMaterialization,
    input.setMaterialization,
    input.setPendingAction,
    input.setError,
    input.observeFailedFallback,
    input.clock,
    input.firstRun,
  ]);
}
