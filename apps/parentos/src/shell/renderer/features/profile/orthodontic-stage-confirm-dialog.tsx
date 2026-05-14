import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  type OrthodonticStage,
  updateOrthodonticCase,
  type OrthodonticCaseRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { stageLabel } from './orthodontic-derive.js';

interface ConfirmProps {
  stage: OrthodonticStage;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Modal that the parent must explicitly confirm before a case advances to the
 * next admitted stage (PO-ORTHO-002 parent-initiated requirement). Carries
 * the next-stage label verbatim so the click is never ambiguous; mounted by
 * the wearing-hero `⋯` menu after the read-only inline phase strip flagged
 * advancement as admissible.
 */
export function OrthodonticStageConfirmDialog({ stage, onCancel, onConfirm }: ConfirmProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="确认推进阶段"
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--nimi-scrim-modal)]"
    >
      <Surface
        material="glass-regular"
        tone="overlay"
        elevation="floating"
        padding="none"
        className="flex min-w-[320px] max-w-[400px] flex-col gap-3 rounded-2xl p-6"
      >
        <h3 className="m-0 text-[16px] font-semibold text-[var(--nimi-text-primary)]">
          推进到「{stageLabel(stage)}」?
        </h3>
        <p className="m-0 text-[14px] text-[var(--nimi-text-muted)]">
          阶段一旦推进，提醒规则与日程会按新阶段调整。如果是误操作，可以再次手动回滚。
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <Button
            type="button"
            onClick={onCancel}
            tone="ghost"
            size="sm"
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            tone="primary"
            size="sm"
          >
            确认推进
          </Button>
        </div>
      </Surface>
    </div>
  );
}

/**
 * Performs the actual stage transition via the typed bridge. Pulled out of
 * the legacy stage-progress component (removed in Wave D) so the wearing
 * hero `⋯` menu can mount the confirm dialog without re-implementing the
 * advance side-effect. Mirrors the existing case-update shape; the Rust
 * command enforces `actualEndAt` being set when `stage = completed` and
 * fail-closes when a non-completed case already exists for this child.
 */
export async function advanceOrthodonticStage(params: {
  caseRow: OrthodonticCaseRow;
  nextStage: OrthodonticStage;
  onError: (msg: string | null) => void;
  onAdvanced: () => Promise<void>;
}) {
  const { caseRow, nextStage, onError, onAdvanced } = params;
  onError(null);
  try {
    await updateOrthodonticCase({
      caseId: caseRow.caseId,
      caseType:
        caseRow.caseType === 'unknown-legacy' ? 'clear-aligners' : caseRow.caseType,
      stage: nextStage,
      startedAt: caseRow.startedAt,
      plannedEndAt: caseRow.plannedEndAt,
      actualEndAt: caseRow.actualEndAt,
      primaryIssues: caseRow.primaryIssues,
      providerName: caseRow.providerName,
      providerInstitution: caseRow.providerInstitution,
      notes: caseRow.notes,
      now: isoNow(),
    });
    await onAdvanced();
  } catch (error) {
    catchLog('ortho', 'action:advance-stage-failed')(error);
    onError(error instanceof Error ? error.message : String(error));
  }
}
