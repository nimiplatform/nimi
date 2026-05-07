import { useMemo, useState } from 'react';
import {
  insertUnwearInterval,
  type OrthodonticApplianceRow,
  type OrthodonticUnwearReason,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';

interface Props {
  appliance: OrthodonticApplianceRow;
  /** When true, endAt is forced to null (open interval, "started un-wearing now"). */
  openOnly?: boolean;
  /** Optional default startAt; defaults to now. */
  defaultStartAt?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}

const REASON_OPTIONS: { value: OrthodonticUnwearReason; label: string }[] = [
  { value: 'meal', label: '用餐' },
  { value: 'sport', label: '运动' },
  { value: 'school', label: '上学' },
  { value: 'sleep', label: '睡眠' },
  { value: 'other', label: '其它' },
];

/**
 * Modal form for recording or backfilling a wear-gap interval (PO-ORTHO-005a).
 *
 * Two flows:
 *  - Quick "open now" (`openOnly`=true, parent just took the appliance out) →
 *    submits with `endAt = null`. UI hides the endAt field.
 *  - Backfill ("我刚才忘戴了") → both startAt and endAt fields shown.
 *
 * Reason and notes are optional. Validation runs both client-side (for fast
 * feedback) and server-side (Rust fail-close).
 */
export function OrthodonticUnwearForm({
  appliance,
  openOnly = false,
  defaultStartAt,
  onClose,
  onSaved,
  onError,
}: Props) {
  const initialStart = useMemo(() => defaultStartAt ?? toLocalInputValue(new Date()), [defaultStartAt]);
  const [startAt, setStartAt] = useState(initialStart);
  const [endAt, setEndAt] = useState<string>('');
  const [reason, setReason] = useState<OrthodonticUnwearReason | ''>('');
  const [notes, setNotes] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const startIso = useMemo(() => fromLocalInputValue(startAt), [startAt]);
  const endIso = useMemo(() => (endAt ? fromLocalInputValue(endAt) : null), [endAt]);
  const endBeforeStart = endIso !== null && startIso >= endIso;

  const handleSubmit = async () => {
    if (!startIso) {
      setLocalError('请填写开始时间');
      return;
    }
    if (endBeforeStart) {
      setLocalError('结束时间必须晚于开始时间');
      return;
    }
    setLocalError(null);
    onError(null);
    try {
      await insertUnwearInterval({
        intervalId: ulid(),
        childId: appliance.childId,
        caseId: appliance.caseId,
        applianceId: appliance.applianceId,
        startAt: startIso,
        endAt: openOnly ? null : endIso,
        reason: reason === '' ? null : reason,
        notes: notes.trim() === '' ? null : notes.trim(),
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:insert-unwear-interval-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="记录未戴时段"
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
          minWidth: 360,
          maxWidth: 460,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div className="flex items-center justify-between">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {openOnly ? '记录脱下时间' : '补记一次未戴时段'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 18, color: '#64748b' }}
          >
            ×
          </button>
        </div>

        {localError && (
          <div
            role="alert"
            className="text-[13px] px-3 py-2 rounded-md"
            style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
          >
            {localError}
          </div>
        )}

        <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
          脱下时间
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="px-2 py-1.5 rounded-md text-[14px]"
            style={{ border: '1px solid rgba(226,232,240,0.9)' }}
          />
        </label>

        {!openOnly && (
          <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
            戴回时间
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              className="px-2 py-1.5 rounded-md text-[14px]"
              style={{ border: '1px solid rgba(226,232,240,0.9)' }}
            />
            {endBeforeStart && (
              <span className="text-[13px]" style={{ color: '#b91c1c' }}>
                结束时间必须晚于开始时间
              </span>
            )}
          </label>
        )}

        <fieldset className="flex flex-col gap-1.5 text-[14px]" style={{ color: '#475569', border: 0, padding: 0 }}>
          <legend>原因（选填）</legend>
          <div className="flex items-center gap-2 flex-wrap">
            {REASON_OPTIONS.map((opt) => {
              const active = reason === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReason(active ? '' : opt.value)}
                  className="text-[13px] px-3 py-1 rounded-full transition-all"
                  style={{
                    background: active ? 'rgba(78,204,163,0.14)' : 'rgba(241,245,249,0.7)',
                    color: active ? '#15803d' : '#475569',
                    border: active ? '1px solid rgba(78,204,163,0.4)' : '1px solid rgba(226,232,240,0.9)',
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
          备注（选填）
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="px-2 py-1.5 rounded-md text-[14px]"
            style={{ border: '1px solid rgba(226,232,240,0.9)' }}
            placeholder="例如：嘴唇红肿，吃饭时取下"
          />
        </label>

        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[14px]"
            style={{ background: 'transparent', color: '#64748b', border: 0, cursor: 'pointer', padding: '6px 12px' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={endBeforeStart}
            className="text-[14px] font-semibold text-white"
            style={{
              background: endBeforeStart ? '#cbd5e1' : S.accent,
              padding: '6px 14px',
              borderRadius: 8,
              border: 0,
              cursor: endBeforeStart ? 'not-allowed' : 'pointer',
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** Converts a Date to the local-time string accepted by `<input type="datetime-local">`. */
function toLocalInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/** Converts a local-time `<input type="datetime-local">` value to ISO 8601 UTC. */
function fromLocalInputValue(value: string): string {
  // Browsers interpret datetime-local without TZ as local time. Construct a Date
  // from the parts then serialize to ISO (which is UTC).
  if (!value) return '';
  return new Date(value).toISOString();
}
