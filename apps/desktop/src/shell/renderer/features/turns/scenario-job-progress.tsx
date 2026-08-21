import { type GenerationRunItem, type GenerationRunStatus } from '@nimiplatform/kit/features/generation/headless';
import { GenerationStatusToast } from '@nimiplatform/kit/features/generation/ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

type ScenarioJobStatus = 'SUBMITTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TIMEOUT';

type ScenarioJobControllerOverlay = 'recovering' | 'cancelling' | 'fetching_artifacts' | 'recovery_timeout';

type ScenarioJobProgressProps = {
  status: ScenarioJobStatus;
  progress?: number;
  errorMessage?: string;
  controllerPhase?: ScenarioJobControllerOverlay;
};

function statusLabel(status: ScenarioJobStatus, t: TFunction): string {
  switch (status) {
    case 'SUBMITTED': return t('TurnInput.scenarioJobStatusSubmitted', { defaultValue: 'Submitted' });
    case 'QUEUED': return t('TurnInput.scenarioJobStatusQueued', { defaultValue: 'Queued' });
    case 'RUNNING': return t('TurnInput.scenarioJobStatusRunning', { defaultValue: 'Processing' });
    case 'COMPLETED': return t('TurnInput.scenarioJobStatusCompleted', { defaultValue: 'Completed' });
    case 'FAILED': return t('TurnInput.scenarioJobStatusFailed', { defaultValue: 'Failed' });
    case 'CANCELED': return t('TurnInput.scenarioJobStatusCanceled', { defaultValue: 'Cancelled' });
    case 'TIMEOUT': return t('TurnInput.scenarioJobStatusTimeout', { defaultValue: 'Timed out' });
    default: return t('TurnInput.scenarioJobStatusUnknown', { defaultValue: 'Unknown' });
  }
}

function mapOverlay(controllerPhase: ScenarioJobControllerOverlay, t: TFunction): GenerationRunItem {
  switch (controllerPhase) {
    case 'recovering':
      return { runId: 'overlay', status: 'pending', label: t('TurnInput.scenarioJobOverlayRecovering', { defaultValue: 'Reconnecting…' }) };
    case 'cancelling':
      return { runId: 'overlay', status: 'running', label: t('TurnInput.scenarioJobOverlayCancelling', { defaultValue: 'Cancelling…' }) };
    case 'fetching_artifacts':
      return { runId: 'overlay', status: 'running', label: t('TurnInput.scenarioJobOverlayFetchingArtifacts', { defaultValue: 'Processing results…' }) };
    case 'recovery_timeout':
      return { runId: 'overlay', status: 'timeout', label: t('TurnInput.scenarioJobOverlayRecoveryTimeout', { defaultValue: 'Job status unknown; refresh later' }) };
  }
}

function generationRunStatusLabel(status: GenerationRunStatus, t: TFunction): string {
  switch (status) {
    case 'submitted': return t('TurnInput.scenarioJobStatusSubmitted', { defaultValue: 'Submitted' });
    case 'queued':
    case 'pending': return t('TurnInput.scenarioJobStatusQueued', { defaultValue: 'Queued' });
    case 'running': return t('TurnInput.scenarioJobStatusRunning', { defaultValue: 'Processing' });
    case 'completed': return t('TurnInput.scenarioJobStatusCompleted', { defaultValue: 'Completed' });
    case 'failed': return t('TurnInput.scenarioJobStatusFailed', { defaultValue: 'Failed' });
    case 'canceled': return t('TurnInput.scenarioJobStatusCanceled', { defaultValue: 'Cancelled' });
    case 'timeout': return t('TurnInput.scenarioJobStatusTimeout', { defaultValue: 'Timed out' });
    default: return t('TurnInput.scenarioJobStatusUnknown', { defaultValue: 'Unknown' });
  }
}

function mapStatus(status: ScenarioJobStatus, progress: number | undefined, errorMessage: string | undefined, t: TFunction): GenerationRunItem {
  return {
    runId: 'scenario-job',
    status: status.toLowerCase(),
    label: statusLabel(status, t),
    error: errorMessage,
    progressValue: status === 'RUNNING' && typeof progress === 'number' && progress >= 0 ? progress : undefined,
    progressLabel: status === 'RUNNING' && typeof progress === 'number' && progress >= 0 ? `${Math.round(progress)}%` : undefined,
  };
}

export function ScenarioJobProgress({ status, progress, errorMessage, controllerPhase }: ScenarioJobProgressProps) {
  const { t } = useTranslation();
  const item = controllerPhase
    ? mapOverlay(controllerPhase, t)
    : mapStatus(status, progress, errorMessage, t);

  return (
    <GenerationStatusToast
      items={[item]}
      getStatusLabel={(runStatus) => generationRunStatusLabel(runStatus, t)}
      className="min-w-[240px] shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
    />
  );
}
