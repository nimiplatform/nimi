/**
 * Orthodontic modal forms: new-case, add-appliance, clinical-event.
 *
 * Behavior is unchanged from the legacy `orthodontic-tab-forms.tsx` (which
 * this replaces). The only schema-touching adjustment is the absence of
 * `actualWearHours` / `prescribedHours` from the clinical event flow — those
 * fields no longer exist on `orthodontic_checkins` (PO-ORTHO-005b) and were
 * never written by these modals anyway.
 *
 * Pure composition of `bridge` writers + small primitives. PO-ORTHO-002 /
 * PO-ORTHO-003 / PO-ORTHO-006 fail-close happens in the Rust command layer.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  insertOrthodonticAppliance,
  insertOrthodonticCase,
  insertOrthoClinicalDentalRecord,
  updateOrthodonticApplianceReview,
  updateOrthodonticAppliancePlan,
  updateOrthodonticCase,
  type OrthoClinicalEventType,
  type OrthodonticApplianceRow,
  type OrthodonticApplianceType,
  type OrthodonticCaseRow,
  type OrthodonticStage,
  type WritableOrthodonticCaseType,
} from '../../bridge/sqlite-bridge.js';
import { applianceSupportsWearGap, applianceTypeLabel } from './orthodontic-derive.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { defaultReviewIntervalDays } from './orthodontic-derive.js';

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
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!startedAt) return;
    try {
      onError(null);
      setLocalError(null);
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
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title="新建正畸疗程" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
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

/**
 * Edit an existing orthodontic case + its primary appliance's wear plan in
 * one modal.
 *
 * Editable case fields: `caseType`, `startedAt`, `providerInstitution`,
 * `notes`. `stage` and `actualEndAt` are intentionally NOT editable —
 * `stage` advances via the Hero stepper (PO-ORTHO-002 parent-initiated only)
 * and `actualEndAt` is only set when transitioning to `completed`.
 *
 * Editable appliance fields (when `primaryAppliance` is provided and not
 * fixed-only): `prescribedHoursPerDay`, plus for clear-aligner the per-tray
 * schedule (`totalAligners`, `daysPerAligner`).
 *
 * `plannedEndAt` on the case is **derived**, not user-input. When the primary
 * appliance is clear-aligner with both `totalAligners` and `daysPerAligner`,
 * we compute `startedAt + totalAligners × daysPerAligner` and write it back
 * with the case update so reviewers and the Hero see the same number. When
 * either field is missing or the appliance is non-aligner, we leave
 * `plannedEndAt` unchanged (preserving any historical value the parent set
 * before this edit, including manually-entered ones from earlier UI).
 */
export function EditCaseFormModal({
  caseRow,
  primaryAppliance,
  onClose,
  onSaved,
  onError,
}: {
  caseRow: OrthodonticCaseRow;
  /**
   * The case's primary appliance for plan editing. Pass `null` when the case
   * has no appliance yet or the parent should manage appliance plans via the
   * appliance form. The modal still allows editing case-level fields.
   */
  primaryAppliance: OrthodonticApplianceRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  // unknown-legacy is migration-authored only and must be re-classified by the
  // user before editing; default the dropdown to clear-aligners in that case.
  const initialType: WritableOrthodonticCaseType =
    caseRow.caseType === 'unknown-legacy' ? 'clear-aligners' : caseRow.caseType;
  const [caseType, setCaseType] = useState<WritableOrthodonticCaseType>(initialType);
  const [startedAt, setStartedAt] = useState(caseRow.startedAt);
  const [providerInstitution, setProviderInstitution] = useState(caseRow.providerInstitution ?? '');
  const [notes, setNotes] = useState(caseRow.notes ?? '');

  const isClearAligner = primaryAppliance?.applianceType === 'clear-aligner';
  const supportsWearGap = primaryAppliance
    ? applianceSupportsWearGap(primaryAppliance.applianceType)
    : false;
  const showHoursField = supportsWearGap;
  const showAlignerPlanFields = isClearAligner;

  const [prescribedHours, setPrescribedHours] = useState<string>(
    primaryAppliance?.prescribedHoursPerDay !== null && primaryAppliance?.prescribedHoursPerDay !== undefined
      ? String(primaryAppliance.prescribedHoursPerDay)
      : '',
  );
  const [totalAligners, setTotalAligners] = useState<string>(
    primaryAppliance?.totalAligners !== null && primaryAppliance?.totalAligners !== undefined
      ? String(primaryAppliance.totalAligners)
      : '',
  );
  const [daysPerAligner, setDaysPerAligner] = useState<string>(
    primaryAppliance?.daysPerAligner !== null && primaryAppliance?.daysPerAligner !== undefined
      ? String(primaryAppliance.daysPerAligner)
      : '',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const totalAlignersNum = Number(totalAligners);
  const daysPerAlignerNum = Number(daysPerAligner);
  const prescribedHoursNum = Number(prescribedHours);

  const totalAlignersValid = !showAlignerPlanFields
    || (Number.isInteger(totalAlignersNum) && totalAlignersNum > 0);
  const daysPerAlignerValid = !showAlignerPlanFields
    || (Number.isInteger(daysPerAlignerNum) && daysPerAlignerNum > 0);
  const prescribedHoursValid = !showHoursField
    || (Number.isInteger(prescribedHoursNum) && prescribedHoursNum > 0 && prescribedHoursNum <= 24);

  // Derive plannedEndAt from clear-aligner total × per-aligner days when both
  // are set. For non-aligner cases we keep whatever value already lives on
  // the case row (untouched by this modal).
  const derivedPlannedEndAt = useMemo<string | null>(() => {
    if (!showAlignerPlanFields) return null;
    if (!totalAlignersValid || !daysPerAlignerValid) return null;
    if (!startedAt) return null;
    const totalDays = totalAlignersNum * daysPerAlignerNum;
    return addDaysIso(startedAt, totalDays);
  }, [showAlignerPlanFields, totalAlignersValid, daysPerAlignerValid, startedAt, totalAlignersNum, daysPerAlignerNum]);

  const formValid = startedAt !== ''
    && totalAlignersValid
    && daysPerAlignerValid
    && prescribedHoursValid;

  const handleSubmit = async () => {
    if (!startedAt) {
      const msg = '请填写开始日期';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (showAlignerPlanFields && (!totalAlignersValid || !daysPerAlignerValid)) {
      const msg = '隐形牙套需要正整数的总副数和每副佩戴天数（PO-ORTHO-003）';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (showHoursField && !prescribedHoursValid) {
      const msg = '医嘱每日佩戴小时数必须在 1..24 之间';
      setLocalError(msg);
      onError(msg);
      return;
    }
    try {
      onError(null);
      setLocalError(null);
      const now = isoNow();
      // Case update first; plannedEndAt is auto-derived from the aligner plan
      // when admissible, otherwise we keep whatever value already lives on
      // the row (the bridge update overwrites with the value we pass, so we
      // pass the derived one when present, otherwise the row's existing one).
      const nextPlannedEndAt =
        derivedPlannedEndAt !== null ? derivedPlannedEndAt : caseRow.plannedEndAt;
      await updateOrthodonticCase({
        caseId: caseRow.caseId,
        caseType,
        stage: caseRow.stage,
        startedAt,
        plannedEndAt: nextPlannedEndAt,
        actualEndAt: caseRow.actualEndAt,
        primaryIssues: caseRow.primaryIssues,
        providerName: caseRow.providerName,
        providerInstitution:
          providerInstitution.trim() === '' ? null : providerInstitution.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
        now,
      });
      // Appliance plan update if a primary appliance is in scope.
      if (primaryAppliance) {
        await updateOrthodonticAppliancePlan({
          applianceId: primaryAppliance.applianceId,
          prescribedHoursPerDay: showHoursField ? prescribedHoursNum : null,
          totalAligners: showAlignerPlanFields ? totalAlignersNum : null,
          daysPerAligner: showAlignerPlanFields ? daysPerAlignerNum : null,
          now,
        });
      }
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:update-case-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title="编辑当前疗程" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
      <p className="text-[13px]" style={{ color: S.sub }}>
        阶段（如「治疗中 → 保持期」）请在页面顶部疗程卡的进度条上点击切换，这里不修改。
      </p>
      <FieldSelect
        label="类型"
        value={caseType}
        onChange={(v) => setCaseType(v as WritableOrthodonticCaseType)}
        options={CASE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      />
      <FieldInput label="开始日期" type="date" value={startedAt} onChange={setStartedAt} />

      {primaryAppliance && (showHoursField || showAlignerPlanFields) && (
        <>
          <div className="text-[12px] uppercase tracking-[0.06em] mt-2 pt-3 border-t" style={{ color: S.sub, borderColor: 'rgba(226,232,240,0.7)' }}>
            装置：{applianceTypeLabel(primaryAppliance.applianceType)}
          </div>
          {showHoursField && (
            <>
              <FieldInput
                label="医嘱每日佩戴小时"
                type="number"
                value={prescribedHours}
                onChange={setPrescribedHours}
                placeholder="例如 22"
              />
              {!prescribedHoursValid && (
                <div className="text-[13px]" style={{ color: '#b91c1c' }}>
                  医嘱每日佩戴小时数必须在 1..24 之间。
                </div>
              )}
            </>
          )}
          {showAlignerPlanFields && (
            <>
              <FieldInput
                label="牙套总副数"
                type="number"
                value={totalAligners}
                onChange={setTotalAligners}
                placeholder="例如 30"
              />
              {!totalAlignersValid && (
                <div className="text-[13px]" style={{ color: '#b91c1c' }}>
                  总副数必须是大于 0 的整数。
                </div>
              )}
              <FieldInput
                label="每副佩戴天数"
                type="number"
                value={daysPerAligner}
                onChange={setDaysPerAligner}
                placeholder="例如 7"
              />
              {!daysPerAlignerValid && (
                <div className="text-[13px]" style={{ color: '#b91c1c' }}>
                  每副佩戴天数必须是大于 0 的整数。
                </div>
              )}
              {derivedPlannedEndAt && (
                <div
                  className="text-[13px] px-3 py-2 rounded-md"
                  style={{
                    background: 'rgba(78,204,163,0.08)',
                    color: S.text,
                    border: '1px solid rgba(78,204,163,0.25)',
                  }}
                >
                  预计结束日期 <strong>{derivedPlannedEndAt}</strong>
                </div>
              )}
            </>
          )}
        </>
      )}

      <FieldInput
        label="机构"
        value={providerInstitution}
        onChange={setProviderInstitution}
        placeholder="可选"
      />
      <FieldTextarea label="备注" value={notes} onChange={setNotes} placeholder="可选" />
      <ModalFooter
        onCancel={onClose}
        onSubmit={() => void handleSubmit()}
        submitLabel="保存"
        disabled={!formValid}
      />
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
  const [applianceType, setApplianceType] = useState<OrthodonticApplianceType>(
    eligibleTypes[0]?.value ?? 'clear-aligner',
  );
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [prescribedHours, setPrescribedHours] = useState<string>('');
  const [prescribedActivations, setPrescribedActivations] = useState<string>('');
  const [totalAligners, setTotalAligners] = useState<string>('');
  const [daysPerAligner, setDaysPerAligner] = useState<string>('');
  const [reviewIntervalDays, setReviewIntervalDays] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const needsPrescribedHours = applianceRequiresPrescribedHours(applianceType);
  const isClearAligner = applianceType === 'clear-aligner';
  const totalAlignersValid = isClearAligner
    ? Number.isInteger(Number(totalAligners)) && Number(totalAligners) > 0
    : true;
  const daysPerAlignerValid = isClearAligner
    ? Number.isInteger(Number(daysPerAligner)) && Number(daysPerAligner) > 0
    : true;

  const handleSubmit = async () => {
    if (!startedAt) return;
    if (needsPrescribedHours && !prescribedHours.trim()) {
      const msg = '请填写该装置的医嘱每日佩戴小时数';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (isClearAligner && (!totalAlignersValid || !daysPerAlignerValid)) {
      const msg = '隐形牙套需要正整数的总副数和每副佩戴天数（PO-ORTHO-003）';
      setLocalError(msg);
      onError(msg);
      return;
    }
    try {
      onError(null);
      setLocalError(null);
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
        totalAligners: isClearAligner ? Number(totalAligners) : null,
        daysPerAligner: isClearAligner ? Number(daysPerAligner) : null,
        reviewIntervalDays: reviewIntervalDays ? Number(reviewIntervalDays) : null,
        notes: null,
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:insert-appliance-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  const dateIsBeforeBirth = startedAt && childBirthDate && startedAt < childBirthDate;
  const startedAgeMonths = startedAt && childBirthDate
    ? computeAgeMonthsAt(childBirthDate, startedAt)
    : 0;

  return (
    <Modal title="添加装置" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
      <FieldSelect label="装置类型" value={applianceType}
        onChange={(v) => setApplianceType(v as OrthodonticApplianceType)}
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
        <FieldInput label="扩弓总激活次数" type="number" value={prescribedActivations}
          onChange={setPrescribedActivations} />
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
      <FieldInput label="复诊间隔（天）" type="number" value={reviewIntervalDays}
        onChange={setReviewIntervalDays} placeholder="不填使用协议默认值" />
      {startedAt && childBirthDate && !dateIsBeforeBirth && (
        <div className="text-[13px]" style={{ color: S.sub }}>
          开始时孩子 {Math.floor(startedAgeMonths / 12)} 岁 {startedAgeMonths % 12} 月
        </div>
      )}
      <ModalFooter onCancel={onClose} onSubmit={() => void handleSubmit()} submitLabel="保存"
        disabled={
          eligibleTypes.length === 0
          || Boolean(dateIsBeforeBirth)
          || (needsPrescribedHours && !prescribedHours.trim())
          || (isClearAligner && (!totalAlignersValid || !daysPerAlignerValid))
        } />
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
  activeAppliances: OrthodonticApplianceRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [eventType, setEventType] = useState<OrthoClinicalEventType>('ortho-review');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [hospital, setHospital] = useState('');
  const [notes, setNotes] = useState('');
  const [appliedToApplianceId, setAppliedToApplianceId] = useState<string>(
    activeAppliances[0]?.applianceId ?? '',
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const advancesReview = eventTypeAdvancesReview(eventType);

  const selectedAppliance = useMemo(
    () => activeAppliances.find((a) => a.applianceId === appliedToApplianceId) ?? null,
    [activeAppliances, appliedToApplianceId],
  );

  const computedNextReviewDate = useMemo(() => {
    if (!advancesReview || !selectedAppliance || !eventDate) return null;
    const interval =
      selectedAppliance.reviewIntervalDays
      ?? defaultReviewIntervalDays(selectedAppliance.applianceType);
    return addDaysIso(eventDate, interval);
  }, [advancesReview, selectedAppliance, eventDate]);

  const handleSubmit = async () => {
    if (!eventDate) {
      const msg = '请填写事件日期';
      setLocalError(msg);
      onError(msg);
      return;
    }
    if (advancesReview && activeAppliances.length > 0 && !appliedToApplianceId) {
      const msg = '请选择本次复诊对应的装置';
      setLocalError(msg);
      onError(msg);
      return;
    }
    try {
      onError(null);
      setLocalError(null);
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
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title="记录正畸临床事件" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
      <p className="text-[13px]" style={{ color: S.sub }}>
        将写入口腔档案的临床时间线（dental_records），不参与日常依从率统计。
      </p>
      <FieldSelect label="事件类型" value={eventType}
        onChange={(v) => setEventType(v as OrthoClinicalEventType)}
        options={ORTHO_CLINICAL_EVENT_OPTIONS.map((o) => ({ value: o.value, label: `${o.label}（${o.desc}）` }))} />
      <FieldInput label="日期" type="date" value={eventDate} onChange={setEventDate} />
      {advancesReview && activeAppliances.length > 0 && (
        <>
          <FieldSelect label="对应装置" value={appliedToApplianceId}
            onChange={(v) => setAppliedToApplianceId(v)}
            options={activeAppliances.map((a) => ({
              value: a.applianceId,
              label: `${a.applianceType} · 开始 ${a.startedAt}`,
            }))} />
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
      <div style={{ background: '#fff', padding: 24, borderRadius: 16, minWidth: 360, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="flex items-center justify-between">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 18, color: '#64748b' }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="text-[13px] px-3 py-2 rounded-md flex items-start justify-between gap-2"
      style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
      <span style={{ wordBreak: 'break-word' }}>{message}</span>
      <button type="button" onClick={onDismiss}
        style={{ background: 'transparent', border: 0, color: '#b91c1c', cursor: 'pointer', flexShrink: 0 }}>
        ×
      </button>
    </div>
  );
}

function ModalFooter({ onCancel, onSubmit, submitLabel, disabled }: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 mt-2">
      <button type="button" onClick={onCancel} className="text-[14px]"
        style={{ background: 'transparent', color: '#64748b', border: 0, cursor: 'pointer', padding: '6px 12px' }}>
        取消
      </button>
      <button type="button" onClick={onSubmit} disabled={disabled} className="text-[14px] font-semibold text-white"
        style={{
          background: disabled ? '#cbd5e1' : S.accent,
          padding: '6px 14px',
          borderRadius: 8,
          border: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {submitLabel}
      </button>
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
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

function FieldInput({ label, type = 'text', value, onChange, placeholder }: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }} />
    </label>
  );
}

function FieldTextarea({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[14px]" style={{ color: '#475569' }}>
      {label}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3}
        className="px-2 py-1.5 rounded-md text-[14px]" style={{ border: '1px solid rgba(226,232,240,0.9)' }} />
    </label>
  );
}
