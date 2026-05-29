import { CircleDot, RefreshCw, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { Button, IconButton, StatusBadge } from '@nimiplatform/kit/ui';
import type { TesterRuntimeInspection } from '../tester-runtime.js';
import type { TesterEvidenceCaptureMode } from '../tester-preferences.js';

type CommandBarProps = {
  appId: string;
  scaffoldProfile: string;
  runtime: TesterRuntimeInspection | null;
  busy: boolean;
  onRunCheck: () => void;
  onCaptureEvidence: () => void;
  evidenceCaptureMode: TesterEvidenceCaptureMode;
};

function runtimeTone(runtime: TesterRuntimeInspection | null): 'success' | 'warning' | 'neutral' {
  if (!runtime) return 'neutral';
  return runtime.status === 'ready' ? 'success' : 'warning';
}

function runtimeLabel(runtime: TesterRuntimeInspection | null): string {
  if (!runtime) return 'Runtime checking';
  return runtime.status === 'ready' ? 'Runtime ready' : 'Runtime unavailable';
}

export function WorkbenchCommandBar({
  appId,
  scaffoldProfile,
  runtime,
  busy,
  onRunCheck,
  onCaptureEvidence,
  evidenceCaptureMode,
}: CommandBarProps) {
  const captureLabel = evidenceCaptureMode === 'after-run' ? 'Capture: after run' : 'Capture: manual';
  return (
    <header className="workbench-command-bar" data-testid="nimi-tester-command-bar">
      <div className="workbench-command-bar__identity">
        <div className="workbench-command-bar__chip">
          <CircleDot size={14} aria-hidden="true" />
          <span>{appId}</span>
        </div>
        <div className="workbench-command-bar__chip workbench-command-bar__chip--profile">
          <span>{runtime ? runtime.mode : scaffoldProfile}</span>
        </div>
      </div>
      <div className="workbench-command-bar__status">
        <StatusBadge tone={runtimeTone(runtime)} shape="dot">
          {runtimeLabel(runtime)}
        </StatusBadge>
        <StatusBadge tone="neutral" shape="outline">
          <ShieldCheck size={13} aria-hidden="true" />
          Strict boundary
        </StatusBadge>
        <StatusBadge tone={evidenceCaptureMode === 'after-run' ? 'info' : 'neutral'} shape="outline">
          {captureLabel}
        </StatusBadge>
      </div>
      <div className="workbench-command-bar__actions">
        <Button
          type="button"
          tone="secondary"
          size="sm"
          leadingIcon={<RefreshCw size={14} />}
          onClick={onRunCheck}
          loading={busy}
        >
          Run check
        </Button>
        <Button
          type="button"
          tone="primary"
          size="sm"
          leadingIcon={<Save size={14} />}
          onClick={onCaptureEvidence}
          title={evidenceCaptureMode === 'after-run' ? 'Capture now; automatic capture also runs after capability completion.' : 'Manual acceptance capture.'}
        >
          Capture evidence
        </Button>
        <IconButton
          aria-label="Readiness inspector"
          tone="ghost"
          size="sm"
          icon={<SlidersHorizontal size={15} />}
        />
      </div>
    </header>
  );
}
