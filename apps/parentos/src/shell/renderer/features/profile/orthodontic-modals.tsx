import { Surface } from '@nimiplatform/nimi-kit/ui';
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
  updateDentalRecord,
  updateOrthodonticApplianceReview,
  updateOrthodonticAppliancePlan,
  updateOrthodonticCase,
  type DentalRecordRow,
  type OrthoClinicalEventType,
  type OrthodonticApplianceRow,
  type OrthodonticApplianceType,
  type OrthodonticCaseRow,
  type OrthodonticStage,
  type WritableOrthodonticCaseType,
} from '../../bridge/sqlite-bridge.js';
import {
  APPLIANCE_PHASES,
  applianceSupportsWearGap,
  applianceTypeLabel,
  defaultReviewIntervalDays,
} from './orthodontic-derive.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  addDaysIso,
  applianceRequiresPrescribedHours,
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

function ModalDangerNote({ children }: { children: ReactNode }) {
  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="sm"
      className="rounded-md border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] text-[14px] text-[var(--nimi-status-danger)]"
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
  const [activationInterval, setActivationInterval] = useState<string>('');
  const [totalAligners, setTotalAligners] = useState<string>('');
  const [daysPerAligner, setDaysPerAligner] = useState<string>('');
  const [currentPhase, setCurrentPhase] = useState<string>('');
  const [reviewIntervalDays, setReviewIntervalDays] = useState<string>('');
  const [nextReviewAgenda, setNextReviewAgenda] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const needsPrescribedHours = applianceRequiresPrescribedHours(applianceType);
  const isClearAligner = applianceType === 'clear-aligner';
  const isExpander = applianceType === 'expander';
  // Phase options are type-specific (PO-ORTHO-013) — reset the picked phase
  // whenever the appliance type changes so an invalid phaseId can't carry over.
  const handleTypeChange = (next: OrthodonticApplianceType) => {
    setApplianceType(next);
    setCurrentPhase('');
  };
  const activationIntervalValid =
    !isExpander || activationInterval === ''
      ? true
      : Number.isInteger(Number(activationInterval)) && Number(activationInterval) > 0;
  const totalAlignersValid = isClearAligner
    ? Number.isInteger(Number(totalAligners)) && Number(totalAligners) > 0
    : true;
  const daysPerAlignerValid = isClearAligner
    ? Number.isInteger(Number(daysPerAligner)) && Number(daysPerAligner) > 0
    : true;

  const handleSubmit = async () => {
    if (!startedAt) return;
    if (needsPrescribedHours && !prescribedHours.trim()) {
      const msg = '请填写矫治器的医嘱每日佩戴小时数';
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
        activationIntervalDays:
          isExpander && activationInterval !== '' ? Number(activationInterval) : null,
        totalAligners: isClearAligner ? Number(totalAligners) : null,
        daysPerAligner: isClearAligner ? Number(daysPerAligner) : null,
        // currentPhase + phaseStartedAt are paired: both set when the parent
        // picks an initial phase, both NULL otherwise (PO-ORTHO-013).
        currentPhase: currentPhase === '' ? null : currentPhase,
        phaseStartedAt: currentPhase === '' ? null : startedAt,
        reviewIntervalDays: reviewIntervalDays ? Number(reviewIntervalDays) : null,
        nextReviewAgenda: nextReviewAgenda.trim() === '' ? null : nextReviewAgenda.trim(),
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
    <Modal title="添加矫治器" onClose={onClose}>
      {localError && <ModalErrorBanner message={localError} onDismiss={() => setLocalError(null)} />}
      <FieldSelect label="矫治器类型" value={applianceType}
        onChange={(v) => handleTypeChange(v as OrthodonticApplianceType)}
        options={eligibleTypes.map((o) => ({ value: o.value, label: o.label }))} />
      {eligibleTypes.length === 0 && (
        <ModalDangerNote>
          孩子当前年龄不满足任何矫治器的最小年龄门槛。
        </ModalDangerNote>
      )}
      <FieldInput label="开始日期" type="date" value={startedAt} onChange={setStartedAt} />
      {dateIsBeforeBirth && (
        <div className="text-[13px] text-[var(--nimi-status-danger)]">
          开始日期不能早于孩子出生日。
        </div>
      )}
      <FieldInput label="医嘱佩戴小时/天" type="number" value={prescribedHours} onChange={setPrescribedHours}
        required={needsPrescribedHours} />
      {isExpander && (
        <>
          <FieldInput label="扩弓总激活次数" type="number" value={prescribedActivations}
            onChange={setPrescribedActivations} />
          <FieldInput label="扩弓转动周期（天，可选）" type="number" value={activationInterval}
            onChange={setActivationInterval} placeholder="例如 3" />
          {!activationIntervalValid && (
            <div className="text-[13px] text-[var(--nimi-status-danger)]">
              转动周期必须是大于 0 的整数。
            </div>
          )}
        </>
      )}
      {isClearAligner && (
        <>
          <FieldInput label="牙套总副数" type="number" value={totalAligners} onChange={setTotalAligners}
            placeholder="例如 30" />
          {!totalAlignersValid && (
            <div className="text-[13px] text-[var(--nimi-status-danger)]">
              总副数必须是大于 0 的整数。
            </div>
          )}
          <FieldInput label="每副佩戴天数" type="number" value={daysPerAligner} onChange={setDaysPerAligner}
            placeholder="例如 7" />
          {!daysPerAlignerValid && (
            <div className="text-[13px] text-[var(--nimi-status-danger)]">
              每副佩戴天数必须是大于 0 的整数。
            </div>
          )}
        </>
      )}
      <FieldInput label="复诊间隔（天）" type="number" value={reviewIntervalDays}
        onChange={setReviewIntervalDays} />
      <FieldSelect label="初始治疗阶段（可选）" value={currentPhase} onChange={setCurrentPhase}
        options={[
          { value: '', label: '暂不设置' },
          ...APPLIANCE_PHASES[applianceType].map((p) => ({ value: p.phaseId, label: p.label })),
        ]} />
      <FieldTextarea label="下次复诊议程（可选）" value={nextReviewAgenda}
        onChange={setNextReviewAgenda} placeholder="例如 评估扩弓量 / 换主弓丝" />
      {startedAt && childBirthDate && !dateIsBeforeBirth && (
        <div className="text-[13px] text-[var(--nimi-text-muted)]">
          开始时孩子 {Math.floor(startedAgeMonths / 12)} 岁 {startedAgeMonths % 12} 月
        </div>
      )}
      <ModalFooter onCancel={onClose} onSubmit={() => void handleSubmit()} submitLabel="保存"
        disabled={
          eligibleTypes.length === 0
          || Boolean(dateIsBeforeBirth)
          || (needsPrescribedHours && !prescribedHours.trim())
          || (isClearAligner && (!totalAlignersValid || !daysPerAlignerValid))
          || !activationIntervalValid
        } />
    </Modal>
  );
}

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
