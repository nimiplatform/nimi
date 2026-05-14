import { useState } from 'react';
import {
  updateOrthodonticApplianceReview,
  updateOrthodonticAppliancePlan,
  type OrthodonticApplianceRow,
} from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { isoNow } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { applianceTypeLabel } from './orthodontic-derive.js';
import { applianceRequiresPrescribedHours } from './orthodontic-modal-domain.js';
import {
  FieldInput,
  FieldTextarea,
  Modal,
  ModalErrorBanner,
  ModalFooter,
} from './orthodontic-modal-primitives.js';

/**
 * In-flight edit modal for an existing appliance. Surfaces what
 * `updateOrthodonticAppliancePlan` (`prescribedHoursPerDay` / `totalAligners`
 * / `daysPerAligner`) and `updateOrthodonticApplianceReview` (`nextReviewDate`)
 * actually admit; `applianceType` and `startedAt` are structural and shown
 * read-only. Same fail-close rules as the insert path (PO-ORTHO-003): a
 * clear-aligner must keep positive `totalAligners` + `daysPerAligner`;
 * non-clear-aligner cannot expose those fields at all.
 */
export function EditApplianceFormModal({
  appliance,
  onClose,
  onSaved,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const isClearAligner = appliance.applianceType === 'clear-aligner';
  const isExpander = appliance.applianceType === 'expander';
  const needsPrescribedHours = applianceRequiresPrescribedHours(appliance.applianceType);

  const [prescribedHours, setPrescribedHours] = useState<string>(
    appliance.prescribedHoursPerDay !== null ? String(appliance.prescribedHoursPerDay) : '',
  );
  const [totalAligners, setTotalAligners] = useState<string>(
    appliance.totalAligners !== null ? String(appliance.totalAligners) : '',
  );
  const [daysPerAligner, setDaysPerAligner] = useState<string>(
    appliance.daysPerAligner !== null ? String(appliance.daysPerAligner) : '',
  );
  const [activationInterval, setActivationInterval] = useState<string>(
    appliance.activationIntervalDays !== null ? String(appliance.activationIntervalDays) : '',
  );
  const [nextReviewDate, setNextReviewDate] = useState<string>(appliance.nextReviewDate ?? '');
  const [nextReviewAgenda, setNextReviewAgenda] = useState<string>(
    appliance.nextReviewAgenda ?? '',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const prescribedHoursNum = Number(prescribedHours);
  const totalAlignersNum = Number(totalAligners);
  const daysPerAlignerNum = Number(daysPerAligner);
  const activationIntervalNum = Number(activationInterval);

  const prescribedHoursValid = needsPrescribedHours
    ? Number.isInteger(prescribedHoursNum) && prescribedHoursNum > 0 && prescribedHoursNum <= 24
    : true;
  const totalAlignersValid = isClearAligner
    ? Number.isInteger(totalAlignersNum) && totalAlignersNum > 0
    : true;
  const daysPerAlignerValid = isClearAligner
    ? Number.isInteger(daysPerAlignerNum) && daysPerAlignerNum > 0
    : true;
  // activationIntervalDays is expander-only and optional; when filled it must
  // be a positive integer (PO-ORTHO-014).
  const activationIntervalValid =
    !isExpander || activationInterval === ''
      ? true
      : Number.isInteger(activationIntervalNum) && activationIntervalNum > 0;
  const nextReviewValid = nextReviewDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(nextReviewDate);

  const formValid =
    prescribedHoursValid &&
    totalAlignersValid &&
    daysPerAlignerValid &&
    activationIntervalValid &&
    nextReviewValid;

  const handleSubmit = async () => {
    if (needsPrescribedHours && !prescribedHoursValid) {
      const msg = '医嘱每日佩戴小时数必须在 1..24 之间';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (isClearAligner && (!totalAlignersValid || !daysPerAlignerValid)) {
      const msg = '隐形牙套需要正整数的总副数和每副佩戴天数';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (!activationIntervalValid) {
      const msg = '扩弓转动周期必须是大于 0 的整数（天）';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (!nextReviewValid) {
      const msg = '下次复诊日期格式应为 YYYY-MM-DD';
      setLocalError(msg);
      onError(msg);
      return;
    }
    try {
      onError(null);
      setLocalError(null);
      const now = isoNow();
      await updateOrthodonticAppliancePlan({
        applianceId: appliance.applianceId,
        prescribedHoursPerDay: needsPrescribedHours ? prescribedHoursNum : null,
        totalAligners: isClearAligner ? totalAlignersNum : null,
        daysPerAligner: isClearAligner ? daysPerAlignerNum : null,
        activationIntervalDays:
          isExpander && activationInterval !== '' ? activationIntervalNum : null,
        nextReviewAgenda: nextReviewAgenda.trim() === '' ? null : nextReviewAgenda.trim(),
        now,
      });
      // Persist the review date only when the parent actually touched it.
      // Empty string clears the row; matching the existing value is a no-op
      // but we still skip the write to keep `lastReviewAt` untouched.
      if (nextReviewDate !== (appliance.nextReviewDate ?? '')) {
        await updateOrthodonticApplianceReview({
          applianceId: appliance.applianceId,
          lastReviewAt: appliance.lastReviewAt,
          nextReviewDate: nextReviewDate === '' ? null : nextReviewDate,
          now,
        });
      }
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:update-appliance-plan-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title="编辑矫治器设置" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}

      <div className="text-[13px] px-3 py-2 rounded-md"
        style={{ background: 'rgba(15,23,42,0.04)', color: S.sub, border: '1px solid rgba(226,232,240,0.7)' }}>
        矫治器类型 <strong style={{ color: S.text, marginLeft: 6 }}>{applianceTypeLabel(appliance.applianceType)}</strong>
        <span style={{ marginLeft: 12 }}>启用日期</span>
        <strong style={{ color: S.text, marginLeft: 6 }}>{appliance.startedAt}</strong>
      </div>

      {needsPrescribedHours && (
        <>
          <FieldInput label="医嘱每日佩戴小时" type="number" value={prescribedHours} onChange={setPrescribedHours}
            placeholder="例如 22" />
          {!prescribedHoursValid && (
            <div className="text-[13px]" style={{ color: '#b91c1c' }}>
              医嘱每日佩戴小时数必须在 1..24 之间。
            </div>
          )}
        </>
      )}

      {isClearAligner && (
        <>
          <FieldInput label="牙套总副数" type="number" value={totalAligners} onChange={setTotalAligners}
            placeholder="例如 30" />
          {!totalAlignersValid && (
            <div className="text-[13px]" style={{ color: '#b91c1c' }}>
              总副数必须是大于 0 的整数。
            </div>
          )}
          <FieldInput label="每副佩戴天数" type="number" value={daysPerAligner} onChange={setDaysPerAligner}
            placeholder="例如 7" />
          {!daysPerAlignerValid && (
            <div className="text-[13px]" style={{ color: '#b91c1c' }}>
              每副佩戴天数必须是大于 0 的整数。
            </div>
          )}
        </>
      )}

      {isExpander && (
        <>
          <FieldInput label="扩弓转动周期（天，可选）" type="number" value={activationInterval}
            onChange={setActivationInterval} placeholder="例如 3" />
          {!activationIntervalValid && (
            <div className="text-[13px]" style={{ color: '#b91c1c' }}>
              转动周期必须是大于 0 的整数。
            </div>
          )}
        </>
      )}

      <FieldInput label="下次复诊日期" type="date" value={nextReviewDate} onChange={setNextReviewDate}
        placeholder="留空清除" />
      {!nextReviewValid && (
        <div className="text-[13px]" style={{ color: '#b91c1c' }}>
          下次复诊日期格式应为 YYYY-MM-DD。
        </div>
      )}

      <FieldTextarea label="下次复诊议程（可选）" value={nextReviewAgenda}
        onChange={setNextReviewAgenda} placeholder="例如 评估扩弓量 / 换主弓丝" />

      <ModalFooter
        onCancel={onClose}
        onSubmit={() => void handleSubmit()}
        submitLabel="保存"
        disabled={!formValid}
      />
    </Modal>
  );
}
