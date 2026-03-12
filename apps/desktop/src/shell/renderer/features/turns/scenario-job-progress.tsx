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

function statusColor(status: ScenarioJobStatus): string {
  switch (status) {
    case 'SUBMITTED':
    case 'QUEUED':
      return 'text-gray-500';
    case 'RUNNING':
      return 'text-blue-600';
    case 'COMPLETED':
      return 'text-green-600';
    case 'FAILED':
    case 'TIMEOUT':
      return 'text-red-600';
    case 'CANCELED':
      return 'text-amber-600';
    default:
      return 'text-gray-500';
  }
}

function isTerminal(status: ScenarioJobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'TIMEOUT';
}

function controllerOverlayLabel(phase: ScenarioJobControllerOverlay): string {
  switch (phase) {
    case 'recovering': return '重新连接中…';
    case 'cancelling': return '取消中…';
    case 'fetching_artifacts': return '结果处理中…';
    case 'recovery_timeout': return '任务状态未知，请稍后刷新';
  }
}

function controllerOverlayColor(phase: ScenarioJobControllerOverlay): string {
  switch (phase) {
    case 'recovering': return 'text-gray-500';
    case 'cancelling': return 'text-amber-600';
    case 'fetching_artifacts': return 'text-blue-600';
    case 'recovery_timeout': return 'text-gray-500';
  }
}

export function ScenarioJobProgress({ status, progress, errorMessage, controllerPhase }: ScenarioJobProgressProps) {
  const terminal = isTerminal(status);
  const showProgress = status === 'RUNNING' && typeof progress === 'number' && progress >= 0 && !controllerPhase;

  // D-STRM-010: Controller phase overlay takes visual precedence
  if (controllerPhase) {
    const isTimeout = controllerPhase === 'recovery_timeout';
    return (
      <div className="inline-flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
        {!isTimeout && (
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
        )}
        {isTimeout && (
          <svg className="h-3.5 w-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
        <span className={`font-medium ${controllerOverlayColor(controllerPhase)}`}>
          {controllerOverlayLabel(controllerPhase)}
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
      {!terminal && (
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
      )}
      {status === 'COMPLETED' && (
        <svg className="h-3.5 w-3.5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {(status === 'FAILED' || status === 'TIMEOUT') && (
        <svg className="h-3.5 w-3.5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )}
      {status === 'CANCELED' && (
        <svg className="h-3.5 w-3.5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      )}
      <span className={`font-medium ${statusColor(status)}`}>{statusLabel(status)}</span>
      {showProgress && (
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {errorMessage && (
        <span className="text-xs text-red-500">{errorMessage}</span>
      )}
    </div>
  );
}
