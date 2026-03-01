type MediaJobStatus = 'SUBMITTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

type MediaJobProgressProps = {
  status: MediaJobStatus;
  progress?: number;
  errorMessage?: string;
};

function statusLabel(status: MediaJobStatus): string {
  switch (status) {
    case 'SUBMITTED': return 'Submitted';
    case 'QUEUED': return 'Queued';
    case 'RUNNING': return 'Processing';
    case 'COMPLETED': return 'Completed';
    case 'FAILED': return 'Failed';
    case 'CANCELLED': return 'Cancelled';
    case 'EXPIRED': return 'Expired';
    default: return 'Unknown';
  }
}

function statusColor(status: MediaJobStatus): string {
  switch (status) {
    case 'SUBMITTED':
    case 'QUEUED':
      return 'text-gray-500';
    case 'RUNNING':
      return 'text-blue-600';
    case 'COMPLETED':
      return 'text-green-600';
    case 'FAILED':
    case 'EXPIRED':
      return 'text-red-600';
    case 'CANCELLED':
      return 'text-amber-600';
    default:
      return 'text-gray-500';
  }
}

function isTerminal(status: MediaJobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED';
}

export function MediaJobProgress({ status, progress, errorMessage }: MediaJobProgressProps) {
  const terminal = isTerminal(status);
  const showProgress = status === 'RUNNING' && typeof progress === 'number' && progress >= 0;

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
      {(status === 'FAILED' || status === 'EXPIRED') && (
        <svg className="h-3.5 w-3.5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )}
      {status === 'CANCELLED' && (
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
