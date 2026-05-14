/**
 * Records an expander activation turn (PO-ORTHO-005 `expander-activation`
 * checkin / PO-ORTHO-014). Opened from the expander card's "记录转动" action.
 * The bilateral / per-screw turn detail ("左 1 圈 + 右 1 圈") is free-text in
 * `notes` — the schema deliberately does not structure it (PO-ORTHO-014).
 */
import { useState } from 'react';
import {
  insertOrthodonticCheckin,
  type OrthodonticApplianceRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { toLocalDatetimeInputValue } from './orthodontic-treatment-card-parts.js';
import {
  FieldInput,
  FieldTextarea,
  Modal,
  ModalErrorBanner,
  ModalFooter,
} from './orthodontic-modal-primitives.js';

export function OrthodonticExpanderActivationModal({
  appliance,
  onClose,
  onSaved,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const nextIndex = appliance.completedActivations + 1;
  const cap = appliance.prescribedActivations;
  const overCap = cap !== null && nextIndex > cap;

  const [activationIndex, setActivationIndex] = useState(String(nextIndex));
  const [at, setAt] = useState(() => toLocalDatetimeInputValue(new Date()));
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const indexNum = Number(activationIndex);
  const indexValid = Number.isInteger(indexNum) && indexNum >= 1;
  const atValid = at !== '' && !Number.isNaN(new Date(at).getTime());
  const formValid = indexValid && atValid && !overCap;

  const handleSubmit = async () => {
    if (!indexValid) {
      const msg = '加力序号必须为大于等于 1 的整数';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (!atValid) {
      const msg = '加力时间无效';
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
        checkinType: 'expander-activation',
        checkinDate: checkinAtIso.slice(0, 10),
        checkinAt: checkinAtIso,
        activationIndex: indexNum,
        alignerIndex: null,
        notes: notes.trim() === '' ? null : notes.trim(),
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:expander-activation-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title="记录扩弓器加力" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}

      <div
        className="text-[13px] px-3 py-2 rounded-md"
        style={{
          background: 'rgba(15,23,42,0.04)',
          color: S.sub,
          border: '1px solid rgba(226,232,240,0.7)',
        }}
      >
        已加力 <strong style={{ color: S.text }}>{appliance.completedActivations}</strong>
        {cap !== null ? ` / ${cap}` : ''} 圈
      </div>

      <FieldInput
        label="本次加力序号"
        type="number"
        value={activationIndex}
        onChange={setActivationIndex}
        placeholder={`默认 ${nextIndex}`}
      />
      {overCap && (
        <div className="text-[13px]" style={{ color: '#b91c1c' }}>
          已达到处方总加力次数 {cap}，无法继续记录加力。
        </div>
      )}

      <FieldInput
        label="加力时间"
        type="datetime-local"
        value={at}
        onChange={setAt}
      />

      <FieldTextarea
        label="备注（可选，如「左 1 圈 + 右 1 圈」）"
        value={notes}
        onChange={setNotes}
        placeholder="记录本次加力的细节"
      />

      <ModalFooter
        onCancel={onClose}
        onSubmit={() => void handleSubmit()}
        submitLabel="保存"
        disabled={!formValid}
      />
    </Modal>
  );
}
