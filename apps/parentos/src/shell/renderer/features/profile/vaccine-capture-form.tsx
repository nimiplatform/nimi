import { useState } from 'react';
import { Button, DatePicker, TextField } from '@nimiplatform/kit/ui';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertVaccineRecord } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  ChipGroup,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  InlineError,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SectionCard,
} from './health-record-modal-shell.js';

const REMIND_OPTIONS = [
  { value: '', label: '不提醒' },
  { value: '6', label: '6 个月后' },
  { value: '12', label: '每年' },
  { value: '24', label: '每 2 年' },
  { value: 'custom', label: '自定义' },
] as const;

type VaccineCaptureChild = {
  childId: string;
  birthDate: string;
};

export type VaccineCaptureProps = {
  child: VaccineCaptureChild;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
};

/**
 * Free-form vaccine capture form. Vaccines are a retained-owner stateful domain
 * (health-record-console-contract.md#PO-HREC-007): writes land in
 * `vaccine_records`, not `health_record_events`. This content component is the
 * single owner of the custom-vaccine write path, consumed both by the vaccine
 * detail page and the `/profile` health-capture modal sidebar.
 */
export function VaccineCaptureContent({ child, onSaved, onClose }: VaccineCaptureProps) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [batch, setBatch] = useState('');
  const [hospital, setHospital] = useState('');
  const [reaction, setReaction] = useState('');
  const [remindOption, setRemindOption] = useState('');
  const [customMonths, setCustomMonths] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const remindMonths =
    remindOption === 'custom' ? parseInt(customMonths, 10) || 0 : parseInt(remindOption, 10) || 0;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setErrorMsg('请填写疫苗名称');
      return;
    }
    if (!date) {
      setErrorMsg('请选择接种日期');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      const now = isoNow();
      await insertVaccineRecord({
        recordId: ulid(),
        childId: child.childId,
        ruleId: `custom-vac-${ulid()}`,
        vaccineName: name.trim(),
        vaccinatedAt: date,
        ageMonths: computeAgeMonthsAt(child.birthDate, date),
        batchNumber: batch || null,
        hospital: hospital || null,
        adverseReaction: reaction || null,
        photoPath: null,
        now,
      });
      // A reminder is stored as a placeholder future-dated record.
      if (remindMonths > 0) {
        const nextDate = new Date(date);
        nextDate.setMonth(nextDate.getMonth() + remindMonths);
        await insertVaccineRecord({
          recordId: ulid(),
          childId: child.childId,
          ruleId: `custom-vac-next-${ulid()}`,
          vaccineName: `${name.trim()} (下次)`,
          vaccinatedAt: nextDate.toISOString().slice(0, 10),
          ageMonths: computeAgeMonthsAt(child.birthDate, nextDate.toISOString()),
          batchNumber: null,
          hospital: null,
          adverseReaction: null,
          photoPath: null,
          now,
        });
      }
      await onSaved();
      onClose();
    } catch (error) {
      catchLog('vaccine-capture', 'action:submit-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const remindPreview =
    remindMonths > 0
      ? new Date(new Date(date).setMonth(new Date(date).getMonth() + remindMonths)).toLocaleDateString('zh-CN')
      : null;

  return (
    <>
      <ModalHeader title="添加疫苗记录" subtitle="计划外或自费疫苗" icon="💉" onClose={onClose} />
      <ModalContent>
        <div className="space-y-4">
          <SectionCard title="接种信息">
            <div className="space-y-3">
              <FormField label="疫苗名称" required>
                <TextField
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：流感疫苗、水痘疫苗"
                  className="w-full min-h-12"
                />
              </FormField>
              <FormGrid cols={2}>
                <FormField label="接种日期" required>
                  <DatePicker value={date} onChange={setDate} className="h-12" />
                </FormField>
                <FormField label="接种机构">
                  <TextField
                    value={hospital}
                    onChange={(e) => setHospital(e.target.value)}
                    placeholder="选填"
                    className="w-full min-h-12"
                  />
                </FormField>
                <FormField label="疫苗批号">
                  <TextField
                    value={batch}
                    onChange={(e) => setBatch(e.target.value)}
                    placeholder="选填"
                    className="w-full min-h-12"
                  />
                </FormField>
                <FormField label="不良反应">
                  <TextField
                    value={reaction}
                    onChange={(e) => setReaction(e.target.value)}
                    placeholder="如有请记录"
                    className="w-full min-h-12"
                  />
                </FormField>
              </FormGrid>
            </div>
          </SectionCard>

          <SectionCard title="下次接种提醒">
            <div className="space-y-3">
              <ChipGroup
                size="sm"
                options={REMIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={remindOption}
                onChange={setRemindOption}
              />
              {remindOption === 'custom' && (
                <div className="flex items-center gap-2">
                  <TextField
                    type="number"
                    min="1"
                    max="120"
                    value={customMonths}
                    onChange={(e) => setCustomMonths(e.target.value)}
                    placeholder="月数"
                    className="w-24 min-h-12"
                  />
                  <span className="text-[13px] text-[var(--nimi-text-muted)]">个月后提醒</span>
                </div>
              )}
              {remindPreview && (
                <p className="text-[12px] text-[var(--nimi-action-primary-bg)]">
                  将在 {remindPreview} 前后提醒下次接种
                </p>
              )}
            </div>
          </SectionCard>

          {errorMsg ? <InlineError>{errorMsg}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={saving} tone="primary" size="md">
          {saving ? '保存中...' : '记录接种'}
        </Button>
      </ModalFooter>
    </>
  );
}

export function VaccineCaptureModal(props: VaccineCaptureProps) {
  return (
    <HealthRecordModalShell open size="M" onClose={props.onClose}>
      <VaccineCaptureContent {...props} />
    </HealthRecordModalShell>
  );
}
