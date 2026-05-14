/**
 * Records a clear-aligner switch to the next tray (PO-ORTHO-005
 * `aligner-change` checkin). Opened from a clear-aligner card's "换下一副"
 * action. Extracted from the legacy single-appliance treatment card so the
 * multi-appliance grid can target the switch at a specific appliance.
 */
import { useState } from 'react';
import {
  insertOrthodonticCheckin,
  type OrthodonticApplianceRow,
  type OrthodonticCheckinRow,
  type OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { computeCycleProgress } from './orthodontic-derive.js';
import { toLocalDatetimeInputValue } from './orthodontic-treatment-card-parts.js';
import {
  FieldInput,
  Modal,
  ModalErrorBanner,
  ModalFooter,
} from './orthodontic-modal-primitives.js';

export function OrthodonticAlignerSwitchModal({
  appliance,
  intervals,
  checkins,
  nowIso,
  onClose,
  onSaved,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  checkins: OrthodonticCheckinRow[];
  nowIso: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const cycle = computeCycleProgress({
    appliance,
    intervals,
    alignerChangeCheckins: checkins,
    nowIso,
  });
  const total = appliance.totalAligners;
  const nextIndex = cycle.currentAlignerIndex + 1;
  const overCap = total !== null && nextIndex > total;

  const [value, setValue] = useState(String(nextIndex));
  const [at, setAt] = useState(() => toLocalDatetimeInputValue(new Date()));
  const [localError, setLocalError] = useState<string | null>(null);

  const indexNum = Number(value);
  const indexValid =
    Number.isInteger(indexNum) && indexNum >= 1 && (total === null || indexNum <= total);
  const atValid = at !== '' && !Number.isNaN(new Date(at).getTime());
  const formValid = indexValid && atValid && !overCap;

  const handleSubmit = async () => {
    if (!indexValid) {
      const msg =
        total !== null
          ? `牙套序号必须是 1..${total} 的整数`
          : '牙套序号必须为大于等于 1 的整数';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (!atValid) {
      const msg = '换套时间无效';
      setLocalError(msg);
      onError(msg);
      return;
    }
    const checkinAtIso = new Date(at).toISOString();
    try {
      onError(null);
      setLocalError(null);
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId: appliance.childId,
        caseId: appliance.caseId,
        applianceId: appliance.applianceId,
        checkinType: 'aligner-change',
        checkinDate: checkinAtIso.slice(0, 10),
        checkinAt: checkinAtIso,
        activationIndex: null,
        alignerIndex: indexNum,
        notes: null,
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:aligner-change-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title="更换下一副牙套" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}

      <div
        className="text-[13px] px-3 py-2 rounded-md"
        style={{
          background: 'rgba(15,23,42,0.04)',
          color: S.sub,
          border: '1px solid rgba(226,232,240,0.7)',
        }}
      >
        当前第 <strong style={{ color: S.text }}>{cycle.currentAlignerIndex}</strong>
        {total !== null ? ` / ${total}` : ''} 副
      </div>

      <FieldInput
        label="本次更换后的牙套序号"
        type="number"
        value={value}
        onChange={setValue}
        placeholder={`默认 ${nextIndex}`}
      />
      {overCap && (
        <div className="text-[13px]" style={{ color: '#b91c1c' }}>
          已达到处方总副数 {total}，无法继续更换。
        </div>
      )}

      <FieldInput label="换牙套的时间" type="datetime-local" value={at} onChange={setAt} />

      <ModalFooter
        onCancel={onClose}
        onSubmit={() => void handleSubmit()}
        submitLabel="确认更换"
        disabled={!formValid}
      />
    </Modal>
  );
}
