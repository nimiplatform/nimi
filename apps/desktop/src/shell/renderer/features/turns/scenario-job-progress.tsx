import { type GenerationRunItem } from '@nimiplatform/nimi-kit/features/generation/headless';
import { GenerationStatusToast } from '@nimiplatform/nimi-kit/features/generation/ui';

type ScenarioJobStatus = 'SUBMITTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TIMEOUT';

type ScenarioJobControllerOverlay = 'recovering' | 'cancelling' | 'fetching_artifacts' | 'recovery_timeout';

type ScenarioJobProgressProps = {
  status: ScenarioJobStatus;
  progress?: number;
  errorMessage?: string;
  controllerPhase?: ScenarioJobControllerOverlay;
};

function statusLabel(status: ScenarioJobStatus): string {
  switch (status) {
    case 'SUBMITTED': return 'Submitted';
    case 'QUEUED': return 'Queued';
    case 'RUNNING': return 'Processing';
    case 'COMPLETED': return 'Completed';
    case 'FAILED': return 'Failed';
    case 'CANCELED': return 'Cancelled';
    case 'TIMEOUT': return 'Timed out';
    default: return 'Unknown';
  }
}

function mapOverlay(controllerPhase: ScenarioJobControllerOverlay): GenerationRunItem {
  switch (controllerPhase) {
    case 'recovering':
      return { runId: 'overlay', status: 'pending', label: '重新连接中…' };
    case 'cancelling':
      return { runId: 'overlay', status: 'timeout', label: '取消中…' };
    case 'fetching_artifacts':
      return { runId: 'overlay', status: 'running', label: '结果处理中…' };
    case 'recovery_timeout':
      return { runId: 'overlay', status: 'timeout', label: '任务状态未知，请稍后刷新' };
  }
}

function mapStatus(status: ScenarioJobStatus, progress?: number, errorMessage?: string): GenerationRunItem {
  return {
    runId: 'scenario-job',
    status: status.toLowerCase(),
    label: statusLabel(status),
    error: errorMessage,
    progressValue: status === 'RUNNING' && typeof progress === 'number' && progress >= 0 ? progress : undefined,
    progressLabel: status === 'RUNNING' && typeof progress === 'number' && progress >= 0 ? `${Math.round(progress)}%` : undefined,
  };
}

export function ScenarioJobProgress({ status, progress, errorMessage, controllerPhase }: ScenarioJobProgressProps) {
  const item = controllerPhase
    ? mapOverlay(controllerPhase)
    : mapStatus(status, progress, errorMessage);

  return (
    <GenerationStatusToast
      items={[item]}
      className="min-w-[240px] shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
    />
  );
}
