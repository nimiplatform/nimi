import { useMemo, useState, type ReactNode } from 'react';
import {
  insertOrthodonticAppliance,
  insertOrthodonticCase,
  insertOrthoClinicalDentalRecord,
  updateOrthodonticApplianceReview,
  type OrthoClinicalEventType,
  type OrthodonticApplianceRow,
  type OrthodonticApplianceType,
  type OrthodonticStage,
  type WritableOrthodonticCaseType,
} from '../../bridge/sqlite-bridge.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';

export const CASE_TYPE_OPTIONS: { value: WritableOrthodonticCaseType; label: string }[] = [
  { value: 'early-intervention', label: '早期矫治' },
  { value: 'fixed-braces', label: '固定矫治' },
  { value: 'clear-aligners', label: '隐形矫治' },
];

export const STAGE_OPTIONS: { value: OrthodonticStage; label: string }[] = [
  { value: 'assessment', label: '初评' },
  { value: 'planning', label: '方案规划' },
  { value: 'active', label: '治疗中' },
  { value: 'retention', label: '保持期' },
  { value: 'completed', label: '已完成' },
];

const CASE_CREATE_STAGE_OPTIONS = STAGE_OPTIONS.filter((option) => option.value !== 'completed');

const ORTHO_CLINICAL_EVENT_OPTIONS: { value: OrthoClinicalEventType; label: string; desc: string }[] = [
  { value: 'ortho-review',     label: '复诊',  desc: '医生例行检查进度' },
  { value: 'ortho-adjustment', label: '调整',  desc: '弓丝/结扎/附件调整' },
  { value: 'ortho-issue',      label: '异常',  desc: '断裂、脱落、疼痛等' },
  { value: 'ortho-end',        label: '结束',  desc: '正畸结束或保持期开始' },
];

/**
 * Default days between reviews per applianceType. Mirrors
 * `orthodontic-protocols.yaml#rules.defaultIntervalDays` (and the Rust
 * `default_review_interval_days_for_rule` helper, which is the source of
 * truth at the command layer). Drift between THIS table and the YAML is
 * caught by the vitest in `orthodontic-protocol-catalog.test.ts`; drift
 * between the YAML and the Rust mirror is caught by the `cargo test`
 * protocol_catalog_drift_guard. Neither test validates TS ↔ Rust directly,
 * but both point at the same YAML as the single source of truth, so any
 * independent drift on one side fails one of the two tests.
 */
export function defaultReviewIntervalDays(applianceType: OrthodonticApplianceType): number {
  switch (applianceType) {
    case 'clear-aligner':       return 56;
    case 'metal-braces':
    case 'ceramic-braces':      return 28;
    case 'twin-block':
    case 'expander':
    case 'activator':           return 42;
    case 'retainer-fixed':
    case 'retainer-removable':  return 180;
  }
}

/** eventTypes that advance the appliance review cycle when recorded. */
function eventTypeAdvancesReview(t: OrthoClinicalEventType): boolean {
  return t === 'ortho-review' || t === 'ortho-adjustment';
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function applianceRequiresPrescribedHours(applianceType: OrthodonticApplianceType): boolean {
  return applianceType === 'clear-aligner'
    || applianceType === 'twin-block'
    || applianceType === 'activator'
    || applianceType === 'retainer-removable';
}

export function CaseFormModal({
  childId,
  onClose,
  onSaved,
  onError,
}: {
  childId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [caseType, setCaseType] = useState<WritableOrthodonticCaseType>('clear-aligners');
  const [stage, setStage] = useState<OrthodonticStage>('assessment');
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [providerInstitution, setProviderInstitution] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async () => {
    if (!startedAt) return;
    try {
      onError(null);
      await insertOrthodonticCase({
        caseId: ulid(),
        childId,
        caseType,
        stage,
        startedAt,
        plannedEndAt: null,
        primaryIssues: null,
        providerName: null,
        providerInstitution: providerInstitution || null,
        notes: notes || null,
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:insert-case-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Modal title="新建正畸疗程" onClose={onClose}>
      <FieldSelect label="类型" value={caseType} onChange={(v) => setCaseType(v as WritableOrthodonticCaseType)}
        options={CASE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      <FieldSelect label="阶段" value={stage} onChange={(v) => setStage(v as OrthodonticStage)}
        options={CASE_CREATE_STAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      <FieldInput label="开始日期" type="date" value={startedAt} onChange={setStartedAt} />
      <FieldInput label="机构" value={providerInstitution} onChange={setProviderInstitution} placeholder="可选" />
      <FieldTextarea label="备注" value={notes} onChange={setNotes} placeholder="可选" />
      <ModalFooter onCancel={onClose} onSubmit={() => void handleSubmit()} submitLabel="保存" />
    </Modal>
  );
}

export function ApplianceFormModal({
  caseId,
  childId,
  childBirthDate,
  eligibleTypes,
  onClose,
  onSaved,
  onError,
}: {
  caseId: string;
  childId: string;
  childBirthDate: string;
  eligibleTypes: { value: OrthodonticApplianceType; label: string }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [applianceType, setApplianceType] = useState<OrthodonticApplianceType>(eligibleTypes[0]?.value ?? 'clear-aligner');
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [prescribedHours, setPrescribedHours] = useState<string>('');
  const [prescribedActivations, setPrescribedActivations] = useState<string>('');
  const [reviewIntervalDays, setReviewIntervalDays] = useState<string>('');
  const needsPrescribedHours = applianceRequiresPrescribedHours(applianceType);

  const handleSubmit = async () => {
    if (!startedAt) return;
    if (needsPrescribedHours && !prescribedHours.trim()) {
      onError('请填写该装置的医嘱每日佩戴小时数');
      return;
    }
    try {
      onError(null);
      await insertOrthodonticAppliance({
        applianceId: ulid(),
        caseId,
        childId,
        childBirthDate,
        applianceType,
        status: 'active',
        startedAt,
        prescribedHoursPerDay: prescribedHours ? Number(prescribedHours) : null,
        prescribedActivations: prescribedActivations ? Number(prescribedActivations) : null,
        reviewIntervalDays: reviewIntervalDays ? Number(reviewIntervalDays) : null,
        notes: null,
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:insert-appliance-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  // `computeAgeMonthsAt` is referenced here so the import is considered used even
  // when the age gate is enforced in Rust; keep a small date-validity side-check
  // so the parent sees a typed failure before the Rust rejection if the date is
  // clearly pre-birth.
  const dateIsBeforeBirth = startedAt && childBirthDate && startedAt < childBirthDate;
  const startedAgeMonths = startedAt && childBirthDate ? computeAgeMonthsAt(childBirthDate, startedAt) : 0;

  return (
    <Modal title="添加装置" onClose={onClose}>
      <FieldSelect label="装置类型" value={applianceType} onChange={(v) => setApplianceType(v as OrthodonticApplianceType)}
        options={eligibleTypes.map((o) => ({ value: o.value, label: o.label }))} />
      {eligibleTypes.length === 0 && (
        <div className="text-[14px] px-3 py-2 rounded-md"
          style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          孩子当前年龄不满足任何装置的最小年龄门槛（PO-ORTHO-009）。
        </div>
      )}
      <FieldInput label="开始日期" type="date" value={startedAt} onChange={setStartedAt} />
      {dateIsBeforeBirth && (
        <div className="text-[13px]" style={{ color: '#b91c1c' }}>
          开始日期不能早于孩子出生日。
        </div>
      )}
      <FieldInput label="医嘱佩戴小时/天" type="number" value={prescribedHours} onChange={setPrescribedHours}
        placeholder={needsPrescribedHours ? '该装置必填' : '非日佩戴类装置可不填'} />
      {needsPrescribedHours && !prescribedHours.trim() && (
        <div className="text-[13px]" style={{ color: '#b91c1c' }}>
          每日佩戴类装置必须有医嘱小时数（PO-ORTHO-003）。
        </div>
      )}
      {applianceType === 'expander' && (
        <FieldInput label="扩弓总激活次数" type="number" value={prescribedActivations} onChange={setPrescribedActivations} />
      )}
      <FieldInput label="复诊间隔（天）" type="number" value={reviewIntervalDays} onChange={setReviewIntervalDays}
        placeholder="不填使用协议默认值" />
      {startedAt && childBirthDate && !dateIsBeforeBirth && (
        <div className="text-[13px]" style={{ color: S.sub }}>
          开始时孩子 {Math.floor(startedAgeMonths / 12)} 岁 {startedAgeMonths % 12} 月
        </div>
      )}
      <ModalFooter onCancel={onClose} onSubmit={() => void handleSubmit()} submitLabel="保存"
        disabled={eligibleTypes.length === 0 || Boolean(dateIsBeforeBirth) || (needsPrescribedHours && !prescribedHours.trim())} />
    </Modal>
  );
}

export function OrthoClinicalEventModal({
  childId,
  childBirthDate,
  activeAppliances,
  onClose,
  onSaved,
  onError,
}: {
  childId: string;
  childBirthDate: string;
  /** Active appliances on the current case; used to advance review cycle bookkeeping. */
  activeAppliances: OrthodonticApplianceRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [eventType, setEventType] = useState<OrthoClinicalEventType>('ortho-review');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [hospital, setHospital] = useState('');
  const [notes, setNotes] = useState('');
  // `appliedToApplianceId = ''` means "general, no specific appliance" — the timeline
  // row still lands but the review-cycle bookkeeping is skipped. review/adjustment
  // default to the first active appliance so the cycle closes by default.
  const [appliedToApplianceId, setAppliedToApplianceId] = useState<string>(
    activeAppliances[0]?.applianceId ?? '',
  );

  const advancesReview = eventTypeAdvancesReview(eventType);

  const selectedAppliance = useMemo(
    () => activeAppliances.find((a) => a.applianceId === appliedToApplianceId) ?? null,
    [activeAppliances, appliedToApplianceId],
  );

  const computedNextReviewDate = useMemo(() => {
    if (!advancesReview || !selectedAppliance || !eventDate) return null;
    const interval = selectedAppliance.reviewIntervalDays
      ?? defaultReviewIntervalDays(selectedAppliance.applianceType);
    return addDaysIso(eventDate, interval);
  }, [advancesReview, selectedAppliance, eventDate]);

  const handleSubmit = async () => {
    if (!eventDate) {
      onError('请填写事件日期');
      return;
    }
    if (advancesReview && activeAppliances.length > 0 && !appliedToApplianceId) {
      onError('请选择本次复诊对应的装置');
      return;
    }
    try {
      onError(null);
      const now = isoNow();
      const ageMonths = computeAgeMonthsAt(childBirthDate, eventDate);
      await insertOrthoClinicalDentalRecord({
        recordId: ulid(),
        childId,
        eventType,
        eventDate,
        ageMonths,
        hospital: hospital.trim() || null,
        notes: notes.trim() || null,
        now,
      });

      // Close the review cycle on the selected appliance: set lastReviewAt to
      // today's event date, recompute nextReviewDate, advance the matching
      // PO-ORTHO-REVIEW-* reminder_state (Rust-side).
      if (advancesReview && selectedAppliance && computedNextReviewDate) {
        await updateOrthodonticApplianceReview({
          applianceId: selectedAppliance.applianceId,
          lastReviewAt: eventDate,
          nextReviewDate: computedNextReviewDate,
          now,
        });
      }

      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:insert-ortho-clinical-event-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Modal title="记录正畸临床事件" onClose={onClose}>
      <p className="text-[13px]" style={{ color: S.sub }}>
        将写入口腔档案的临床时间线（dental_records），不参与依从率统计。
      </p>
      <FieldSelect label="事件类型" value={eventType} onChange={(v) => setEventType(v as OrthoClinicalEventType)}
        options={ORTHO_CLINICAL_EVENT_OPTIONS.map((o) => ({ value: o.value, label: `${o.label}（${o.desc}）` }))} />
      <FieldInput label="日期" type="date" value={eventDate} onChange={setEventDate} />

      {advancesReview && activeAppliances.length > 0 && (
        <>
          <FieldSelect label="对应装置" value={appliedToApplianceId}
            onChange={(v) => setAppliedToApplianceId(v)}
            options={activeAppliances.map((a) => ({ value: a.applianceId, label: `${a.applianceType} · 开始 ${a.startedAt}` }))} />
          {computedNextReviewDate && (
            <div className="text-[13px] px-3 py-2 rounded-md"
              style={{ background: 'rgba(78,204,163,0.08)', color: S.text, border: '1px solid rgba(78,204,163,0.25)' }}>
              本次完成后，下次复诊自动设为 <strong>{computedNextReviewDate}</strong>；对应协议提醒会推进到该日。
            </div>
          )}
        </>
      )}
      {advancesReview && activeAppliances.length === 0 && (
        <div className="text-[13px] px-3 py-2 rounded-md"
          style={{ background: 'rgba(245,158,11,0.08)', color: '#b45309', border: '1px solid rgba(245,158,11,0.25)' }}>
          当前疗程没有进行中的装置。事件会写入时间线，但不会推进复诊周期。
        </div>
      )}

      <FieldInput label="机构" value={hospital} onChange={setHospital} placeholder="可选" />
      <FieldTextarea label="备注" value={notes} onChange={setNotes} placeholder="可选" />
      <ModalFooter onCancel={onClose} onSubmit={() => void handleSubmit()} submitLabel="保存" />
    </Modal>
  );
}

/* ── Primitives ────────────────────────────────────────── */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 16, minWidth: 360, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="flex items-center justify-between">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 18, color: '#64748b' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalFooter({ onCancel, onSubmit, submitLabel, disabled }: { onCancel: () => void; onSubmit: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 mt-2">
      <button type="button" onClick={onCancel} className="text-[14px]"
        style={{ background: 'transparent', color: '#64748b', border: 0, cursor: 'pointer', padding: '6px 12px' }}>
        取消
      </button>
      <button type="button" onClick={onSubmit} disabled={disabled} className="text-[14px] font-semibold text-white"
        style={{ background: disabled ? '#cbd5e1' : S.accent, padding: '6px 14px', borderRadius: 8, border: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {submitLabel}
      </button>
    </div>
  );
}

export function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FieldInput({ label, type = 'text', value, onChange, placeholder }: { label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }} />
    </label>
  );
}

export function FieldTextarea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }} />
    </label>
  );
}
