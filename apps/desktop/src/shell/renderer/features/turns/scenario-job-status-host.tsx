import { useEffect, useState } from 'react';
import {
  clearJobTracking,
  subscribeJobEvents,
  type ScenarioJobState,
} from './scenario-job-controller';
import { ScenarioJobProgress } from './scenario-job-progress';

const TERMINAL_VISIBILITY_MS = 10_000;

function toOverlayPhase(state: ScenarioJobState): 'recovering' | 'cancelling' | 'fetching_artifacts' | 'recovery_timeout' | undefined {
  if (
    state.phase === 'recovering'
    || state.phase === 'cancelling'
    || state.phase === 'fetching_artifacts'
    || state.phase === 'recovery_timeout'
  ) {
    return state.phase;
  }
  return undefined;
}

function toDisplayStatus(state: ScenarioJobState): 'SUBMITTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TIMEOUT' | null {
  if (state.jobStatus) {
    return state.jobStatus;
  }
  if (state.phase === 'recovery_timeout') {
    return 'TIMEOUT';
  }
  return null;
}

export function ScenarioJobStatusHost() {
  const [activeState, setActiveState] = useState<ScenarioJobState | null>(null);

  useEffect(() => subscribeJobEvents((state) => {
    setActiveState({ ...state });
  }), []);

  useEffect(() => {
    if (!activeState || (activeState.phase !== 'terminal' && activeState.phase !== 'recovery_timeout')) {
      return;
    }

    const { jobId } = activeState;
    const timer = setTimeout(() => {
      setActiveState((current) => (current?.jobId === jobId ? null : current));
      clearJobTracking(jobId);
    }, TERMINAL_VISIBILITY_MS);

    return () => clearTimeout(timer);
  }, [activeState]);

  if (!activeState) {
    return null;
  }

  const status = toDisplayStatus(activeState);
  if (!status) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 sm:right-6">
      <div className="pointer-events-auto">
        <ScenarioJobProgress
          status={status}
          progress={activeState.progress ?? undefined}
          errorMessage={activeState.errorMessage ?? undefined}
          controllerPhase={toOverlayPhase(activeState)}
        />
      </div>
    </div>
  );
}
