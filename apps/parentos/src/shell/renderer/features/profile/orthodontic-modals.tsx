import { Surface } from '@nimiplatform/nimi-kit/ui';
import { useMemo, useState, type ReactNode } from 'react';
import {
  insertOrthodonticCase,
  insertOrthoClinicalDentalRecord,
  updateDentalRecord,
  updateOrthodonticApplianceReview,
  updateOrthodonticAppliancePlan,
  updateOrthodonticCase,
  type DentalRecordRow,
  type OrthoClinicalEventType,
  type OrthodonticApplianceRow,
  type OrthodonticCaseRow,
  type OrthodonticStage,
  type WritableOrthodonticCaseType,
} from '../../bridge/sqlite-bridge.js';
import {
  applianceSupportsWearGap,
  applianceTypeLabel,
  defaultReviewIntervalDays,
} from './orthodontic-derive.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  addDaysIso,
  CASE_CREATE_STAGE_OPTIONS,
  CASE_TYPE_OPTIONS,
  eventTypeAdvancesReview,
  ORTHO_CLINICAL_EVENT_OPTIONS,
} from './orthodontic-modal-domain.js';
import {
  FieldInput,
  FieldSelect,
  FieldTextarea,
  Modal,
  ModalErrorBanner,
  ModalFooter,
} from './orthodontic-modal-primitives.js';
function ModalSuccessNote({ children }: { children: ReactNode }) {
  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="sm"
      className="rounded-md border-[color-mix(in_srgb,var(--nimi-status-success)_25%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] text-[13px] text-[var(--nimi-text-primary)]"
    >
      {children}
    </Surface>
  );
}

function ModalWarningNote({ children }: { children: ReactNode }) {
  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="sm"
      className="rounded-md border-[color-mix(in_srgb,var(--nimi-status-warning)_25%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] text-[13px] text-[var(--nimi-status-warning)]"
    >
      {children}
    </Surface>
  );
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
      const msg = '隐形牙套需要正整数的总副数和每副佩戴天数';
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
          // Preserved as-is here; the per-appliance editor (Wave 5) owns these.
          activationIntervalDays: primaryAppliance.activationIntervalDays,
          nextReviewAgenda: primaryAppliance.nextReviewAgenda,
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
      <FieldSelect
        label="类型"
        value={caseType}
        onChange={(v) => setCaseType(v as WritableOrthodonticCaseType)}
        options={CASE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      />
      <FieldInput label="开始日期" type="date" value={startedAt} onChange={setStartedAt} />

      {primaryAppliance && (showHoursField || showAlignerPlanFields) && (
        <>
          <div className="mt-2 border-t border-[var(--nimi-border-subtle)] pt-3 text-[12px] uppercase tracking-[0.06em] text-[var(--nimi-text-muted)]">
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
                <div className="text-[13px] text-[var(--nimi-status-danger)]">
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
                <div className="text-[13px] text-[var(--nimi-status-danger)]">
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
                <div className="text-[13px] text-[var(--nimi-status-danger)]">
                  每副佩戴天数必须是大于 0 的整数。
                </div>
              )}
              {derivedPlannedEndAt && (
                <ModalSuccessNote>
                  预计结束日期 <strong>{derivedPlannedEndAt}</strong>
                </ModalSuccessNote>
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

export { ApplianceFormModal } from './orthodontic-appliance-form-modal.js';

export { EditApplianceFormModal } from './orthodontic-edit-appliance-form-modal.js';

export function OrthoClinicalEventModal({
  childId,
  childBirthDate,
  activeAppliances,
  prefill,
  editingRecord,
  onClose,
  onSaved,
  onError,
}: {
  childId: string;
  childBirthDate: string;
  activeAppliances: OrthodonticApplianceRow[];
  /**
   * Wave D quick-tag / next-visit-grid wiring. When the parent opens this
   * modal from a deterministic affordance (e.g. the 脱落 chip in the
   * wearing hero), the relevant event type and a note prefix are seeded so
   * the user only confirms + saves. The fields stay editable.
   */
  prefill?: {
    eventType?: OrthoClinicalEventType;
    notes?: string;
  };
  /**
   * When present the modal is in EDIT mode: fields are seeded from the
   * existing dental record, the title flips, save dispatches
   * `updateDentalRecord` (preserving `toothId` / `toothSet` / `severity` /
   * `photoPath` that this modal doesn't surface), and the post-save
   * `updateOrthodonticApplianceReview` recompute is suppressed (the review
   * advance ran when the record was originally created — re-running it on
   * a subsequent edit would silently shift the next-visit date forward).
   */
  editingRecord?: DentalRecordRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const isEditing = !!editingRecord;
  const [eventType, setEventType] = useState<OrthoClinicalEventType>(
    (editingRecord?.eventType as OrthoClinicalEventType | undefined)
      ?? prefill?.eventType
      ?? 'ortho-review',
  );
  const [eventDate, setEventDate] = useState(
    editingRecord?.eventDate?.split('T')[0]
      ?? new Date().toISOString().slice(0, 10),
  );
  const [hospital, setHospital] = useState(editingRecord?.hospital ?? '');
  const [notes, setNotes] = useState(editingRecord?.notes ?? prefill?.notes ?? '');
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
      if (editingRecord) {
        await updateDentalRecord({
          recordId: editingRecord.recordId,
          eventType,
          // Preserve fields this modal doesn't expose; orthodontic clinical
          // events historically have no toothId/severity/photoPath, so these
          // pass through whatever was stored at create time.
          toothId: editingRecord.toothId,
          toothSet: editingRecord.toothSet,
          eventDate,
          ageMonths,
          severity: editingRecord.severity,
          hospital: hospital.trim() || null,
          notes: notes.trim() || null,
          photoPath: editingRecord.photoPath,
          now,
        });
      } else {
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
      }
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:save-ortho-clinical-event-failed')(error);
      const msg = error instanceof Error ? error.message : String(error);
      setLocalError(msg);
      onError(msg);
    }
  };

  return (
    <Modal title={isEditing ? '编辑正畸临床事件' : '记录正畸临床事件'} onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
      <FieldSelect label="事件类型" value={eventType}
        onChange={(v) => setEventType(v as OrthoClinicalEventType)}
        options={ORTHO_CLINICAL_EVENT_OPTIONS.map((o) => ({ value: o.value, label: `${o.label}（${o.desc}）` }))} />
      <FieldInput label="日期" type="date" value={eventDate} onChange={setEventDate} />
      {!isEditing && advancesReview && activeAppliances.length > 0 && (
        <>
          <FieldSelect label="对应装置" value={appliedToApplianceId}
            onChange={(v) => setAppliedToApplianceId(v)}
            options={activeAppliances.map((a) => ({
              value: a.applianceId,
              label: `${a.applianceType} · 开始 ${a.startedAt}`,
            }))} />
          {computedNextReviewDate && (
            <ModalSuccessNote>
              本次完成后，下次复诊自动设为 <strong>{computedNextReviewDate}</strong>；对应协议提醒会推进到该日。
            </ModalSuccessNote>
          )}
        </>
      )}
      {!isEditing && advancesReview && activeAppliances.length === 0 && (
        <ModalWarningNote>
          当前疗程没有进行中的装置。事件会写入时间线，但不会推进复诊周期。
        </ModalWarningNote>
      )}
      <FieldInput label="机构" value={hospital} onChange={setHospital} placeholder="可选" />
      <FieldTextarea label="备注" value={notes} onChange={setNotes} placeholder="可选" />
      <ModalFooter onCancel={onClose} onSubmit={() => void handleSubmit()} submitLabel="保存" />
    </Modal>
  );
}
