import {
  type OrthodonticStage,
  updateOrthodonticCase,
  type OrthodonticCaseRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.32)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 16,
          minWidth: 320,
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          推进到「{stageLabel(stage)}」?
        </h3>
        <p className="text-[14px]" style={{ color: S.sub, margin: 0 }}>
          阶段一旦推进，提醒规则与日程会按新阶段调整。如果是误操作，可以再次手动回滚。
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-[14px]"
            style={{
              background: 'transparent',
              color: '#64748b',
              border: 0,
              cursor: 'pointer',
              padding: '6px 12px',
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-[14px] font-semibold text-white"
            style={{
              background: S.accent,
              padding: '6px 14px',
              borderRadius: 8,
              border: 0,
              cursor: 'pointer',
            }}
          >
            确认推进
          </button>
        </div>
      </div>
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
