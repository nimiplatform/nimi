import { Button, cn, DatePicker, SelectField, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import {
  insertOrthodonticAppliance,
  type OrthodonticApplianceType,
} from '../../bridge/sqlite-bridge.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { APPLIANCE_PHASES } from './orthodontic-derive.js';
import { applianceRequiresPrescribedHours } from './orthodontic-modal-domain.js';
import {
  FormField,
  HealthRecordModalShell,
  InlineError,
  ModalContent,
  ModalFooter as ShellModalFooter,
  ModalHeader,
} from './health-record-modal-shell.js';

const NUMBER_INPUT_CLASS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const DANGER_DATE_FIELD_CLASS = 'border-[var(--nimi-status-danger)] ring-[length:var(--nimi-focus-ring-width)] ring-[var(--nimi-status-danger)]';

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
    <HealthRecordModalShell open size="S" onClose={onClose} ariaLabel="添加矫治器">
      <ModalHeader title="添加矫治器" icon="🦷" onClose={onClose} />
      <ModalContent>
        <div className="space-y-4">
          {localError && <InlineError>{localError}</InlineError>}
          {eligibleTypes.length === 0 && (
            <InlineError>孩子当前年龄不满足任何矫治器的最小年龄门槛。</InlineError>
          )}
          <FormField label="矫治器类型">
            <SelectField
              value={applianceType}
              onValueChange={(v) => handleTypeChange(v as OrthodonticApplianceType)}
              options={eligibleTypes.map((o) => ({ value: o.value, label: o.label }))}
              className="min-h-12"
            />
          </FormField>
          <FormField
            label="开始日期"
            error={dateIsBeforeBirth ? '开始日期不能早于孩子出生日。' : undefined}
          >
            <DatePicker
              value={startedAt}
              onChange={setStartedAt}
              className={cn('h-12', dateIsBeforeBirth && DANGER_DATE_FIELD_CLASS)}
            />
          </FormField>
          <FormField label="医嘱佩戴小时/天" required={needsPrescribedHours}>
            <TextField type="number" value={prescribedHours} onChange={(event) => setPrescribedHours(event.target.value)} className="w-full min-h-12" inputClassName={NUMBER_INPUT_CLASS} />
          </FormField>
          {isExpander && (
            <>
              <FormField label="扩弓总激活次数">
                <TextField type="number" value={prescribedActivations} onChange={(event) => setPrescribedActivations(event.target.value)} className="w-full min-h-12" inputClassName={NUMBER_INPUT_CLASS} />
              </FormField>
              <FormField
                label="扩弓转动周期（天，可选）"
                error={!activationIntervalValid ? '转动周期必须是大于 0 的整数。' : undefined}
              >
                <TextField
                  type="number"
                  tone={activationIntervalValid ? 'default' : 'danger'}
                  value={activationInterval}
                  onChange={(event) => setActivationInterval(event.target.value)}
                  placeholder="例如 3"
                  className="w-full min-h-12"
                  inputClassName={NUMBER_INPUT_CLASS}
                />
              </FormField>
            </>
          )}
          {isClearAligner && (
            <>
              <FormField
                label="牙套总副数"
                error={!totalAlignersValid ? '总副数必须是大于 0 的整数。' : undefined}
              >
                <TextField
                  type="number"
                  tone={totalAlignersValid ? 'default' : 'danger'}
                  value={totalAligners}
                  onChange={(event) => setTotalAligners(event.target.value)}
                  placeholder="例如 30"
                  className="w-full min-h-12"
                  inputClassName={NUMBER_INPUT_CLASS}
                />
              </FormField>
              <FormField
                label="每副佩戴天数"
                error={!daysPerAlignerValid ? '每副佩戴天数必须是大于 0 的整数。' : undefined}
              >
                <TextField
                  type="number"
                  tone={daysPerAlignerValid ? 'default' : 'danger'}
                  value={daysPerAligner}
                  onChange={(event) => setDaysPerAligner(event.target.value)}
                  placeholder="例如 7"
                  className="w-full min-h-12"
                  inputClassName={NUMBER_INPUT_CLASS}
                />
              </FormField>
            </>
          )}
          <FormField label="复诊间隔（天）">
            <TextField type="number" value={reviewIntervalDays} onChange={(event) => setReviewIntervalDays(event.target.value)} className="w-full min-h-12" inputClassName={NUMBER_INPUT_CLASS} />
          </FormField>
          <FormField label="初始治疗阶段（可选）">
            <SelectField
              value={currentPhase}
              onValueChange={setCurrentPhase}
              placeholder="暂不设置"
              options={APPLIANCE_PHASES[applianceType].map((p) => ({ value: p.phaseId, label: p.label }))}
              className="min-h-12"
            />
          </FormField>
          <FormField label="下次复诊议程（可选）">
            <TextareaField
              value={nextReviewAgenda}
              onChange={(event) => setNextReviewAgenda(event.target.value)}
              placeholder="例如 评估扩弓量 / 换主弓丝"
              rows={3}
              className="w-full"
            />
          </FormField>
          {startedAt && childBirthDate && !dateIsBeforeBirth && (
            <p className="text-[12.5px] text-[var(--nimi-text-muted)]">
              开始时孩子 {Math.floor(startedAgeMonths / 12)} 岁 {startedAgeMonths % 12} 月
            </p>
          )}
        </div>
      </ModalContent>
      <ShellModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={
            eligibleTypes.length === 0
            || Boolean(dateIsBeforeBirth)
            || (needsPrescribedHours && !prescribedHours.trim())
            || (isClearAligner && (!totalAlignersValid || !daysPerAlignerValid))
            || !activationIntervalValid
          }
          tone="primary"
          size="md"
        >
          保存
        </Button>
      </ShellModalFooter>
    </HealthRecordModalShell>
  );
}
