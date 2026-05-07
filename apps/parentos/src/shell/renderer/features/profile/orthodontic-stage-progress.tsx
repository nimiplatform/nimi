import { useState } from 'react';
import {
  type OrthodonticCaseRow,
  type OrthodonticStage,
  updateOrthodonticCase,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { computeStageOptions, stageLabel } from './orthodontic-derive.js';

interface Props {
  caseRow: OrthodonticCaseRow;
  onAdvanced: () => Promise<void>;
  onError: (msg: string | null) => void;
}

/**
 * Five-segment stage progress bar (assessment → planning → active → retention →
 * completed). Past segments are filled, the current is highlighted, and the
 * immediate next segment is clickable when admissible (PO-ORTHO-002:
 * parent-initiated only). The `completed` step requires `actualEndAt` to be
 * set; if missing we surface a tooltip via `blockedReason`.
 */
export function OrthodonticStageProgress({ caseRow, onAdvanced, onError }: Props) {
  const [pendingStage, setPendingStage] = useState<OrthodonticStage | null>(null);
  const options = computeStageOptions(caseRow);

  const advance = async (nextStage: OrthodonticStage) => {
    onError(null);
    try {
      const actualEndAt =
        nextStage === 'completed' ? caseRow.actualEndAt : caseRow.actualEndAt;
      await updateOrthodonticCase({
        caseId: caseRow.caseId,
        caseType: caseRow.caseType === 'unknown-legacy' ? 'clear-aligners' : caseRow.caseType,
        stage: nextStage,
        startedAt: caseRow.startedAt,
        plannedEndAt: caseRow.plannedEndAt,
        actualEndAt,
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
    } finally {
      setPendingStage(null);
    }
  };

  const handleClick = (stage: OrthodonticStage, advanceable: boolean, blockedReason: string | null) => {
    if (!advanceable) {
      if (blockedReason) onError(blockedReason);
      return;
    }
    setPendingStage(stage);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-2" role="list" aria-label="正畸阶段进度">
        {options.map(({ stage, state, advanceable, blockedReason }) => {
          const cursor = state === 'future' && advanceable ? 'pointer' : 'default';
          const opacity = state === 'future' && !advanceable ? 0.5 : 1;
          const tone =
            state === 'past'
              ? 'rgba(78,204,163,0.85)'
              : state === 'current'
              ? 'rgba(78,204,163,1)'
              : 'rgba(148,163,184,0.32)';
          // Active / past segments breathe with extra flex weight so the
          // current stage and the journey traveled so far visually dominate
          // the bar; future segments stay slimmer to read as placeholders.
          const flexWeight =
            state === 'current' ? 1.6 : state === 'past' ? 1.15 : 0.9;
          return (
            <button
              key={stage}
              role="listitem"
              type="button"
              onClick={() => handleClick(stage, advanceable, blockedReason)}
              disabled={state !== 'future' || !advanceable}
              title={blockedReason ?? undefined}
              className="text-[14px] font-medium text-center rounded-full px-4 py-2.5 transition-all"
              style={{
                flex: flexWeight,
                background: tone,
                color: state === 'future' ? S.sub : '#fff',
                cursor,
                opacity,
                border: 0,
                fontWeight: state === 'current' ? 700 : state === 'past' ? 600 : 500,
                letterSpacing: '0.02em',
                boxShadow: state === 'current' ? '0 6px 18px rgba(78,204,163,0.38)' : 'none',
              }}
            >
              {stageLabel(stage)}
            </button>
          );
        })}
      </div>
      {pendingStage && (
        <ConfirmAdvanceDialog
          stage={pendingStage}
          onCancel={() => setPendingStage(null)}
          onConfirm={() => void advance(pendingStage)}
        />
      )}
    </div>
  );
}

interface ConfirmProps {
  stage: OrthodonticStage;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmAdvanceDialog({ stage, onCancel, onConfirm }: ConfirmProps) {
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
            style={{ background: 'transparent', color: '#64748b', border: 0, cursor: 'pointer', padding: '6px 12px' }}
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
