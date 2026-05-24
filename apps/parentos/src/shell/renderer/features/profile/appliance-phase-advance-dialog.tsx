import { Button, DialogTitle, OverlayShell } from '@nimiplatform/kit/ui';
/**
 * Parent-initiated treatment-phase advance dialog (PO-ORTHO-013). The
 * per-appliance mirror of `OrthodonticStageConfirmDialog`: the phase pill on
 * every appliance card opens this, and confirming advances the appliance to
 * the immediate next `phaseId` in its type's sequence (the first phase when
 * none is set yet). Adjacency is re-enforced by the Rust command.
 */
import {
  advanceOrthodonticAppliancePhase,
  type OrthodonticApplianceRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  applianceTypeLabel,
  computeAppliancePhaseOptions,
} from './orthodontic-derive.js';

export function AppliancePhaseAdvanceDialog({
  appliance,
  onCancel,
  onConfirmed,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  onCancel: () => void;
  onConfirmed: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const options = computeAppliancePhaseOptions(appliance);
  const target = options.find((o) => o.advanceable) ?? null;
  const isInitial = appliance.currentPhase === null;

  const handleConfirm = async () => {
    if (!target) return;
    onError(null);
    try {
      await advanceOrthodonticAppliancePhase({
        applianceId: appliance.applianceId,
        nextPhase: target.phaseId,
        now: isoNow(),
      });
      await onConfirmed();
    } catch (error) {
      catchLog('ortho', 'action:advance-appliance-phase-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onCancel}
      closeOnBackdrop={false}
      panelClassName="w-auto min-w-[320px] max-w-[400px] rounded-2xl"
      contentClassName="!p-6 flex flex-col gap-3"
    >
        <DialogTitle className="sr-only">确认推进治疗阶段</DialogTitle>
        {target ? (
          <>
            <h3 className="m-0 text-[16px] font-semibold text-[var(--nimi-text-primary)]">
              {isInitial
                ? `设置「${applianceTypeLabel(appliance.applianceType)}」初始阶段为「${target.label}」?`
                : `推进到「${target.label}」?`}
            </h3>
            <p className="m-0 text-[14px] text-[var(--nimi-text-muted)]">
              {isInitial
                ? '设置后会开始按该阶段计算阶段月数。如果是误操作，可以再次手动调整。'
                : '阶段只能逐级推进。推进后会从今天开始重新计算阶段月数。'}
            </p>
          </>
        ) : (
          <>
            <h3 className="m-0 text-[16px] font-semibold text-[var(--nimi-text-primary)]">已是最后阶段</h3>
            <p className="m-0 text-[14px] text-[var(--nimi-text-muted)]">
              该矫治器已处于其治疗阶段序列的最后一个阶段，没有可推进的下一阶段。
            </p>
          </>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <Button
            tone="ghost"
            size="sm"
            onClick={onCancel}
          >
            {target ? '取消' : '关闭'}
          </Button>
          {target && (
            <Button
              tone="primary"
              size="sm"
              onClick={() => void handleConfirm()}
            >
              {isInitial ? '确认设置' : '确认推进'}
            </Button>
          )}
        </div>
    </OverlayShell>
  );
}
