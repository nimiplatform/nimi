import { useCallback, useEffect, useState, type RefObject } from 'react';
import { DashedAddButton } from '@nimiplatform/nimi-kit/ui';
import { DrugComboBox, type DrugSelection } from './drug-combobox.js';
import { getMedicalEvents } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  COMMON_SYMPTOMS,
  EVENT_TYPE_COLORS,
  EVENT_TYPE_ICONS,
  EVENT_TYPE_LABELS,
  LAB_ITEMS,
  RESULT_LABELS,
  RESULT_OPTIONS,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  VISIT_TYPES,
} from './medical-events-page-shared.js';
import type {
  MedicalEventsChildContext,
  MedicalEventsFormMedication,
} from './medical-events-page-types.js';
import { useMedicalEventsFormState } from './medical-events-page-form-state.js';
import { Button, TextField, TextareaField } from '@nimiplatform/nimi-kit/ui';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  ChipGroup,
  type ChipOption,
  FormField,
  FormGrid,
  HealthRecordModalShell,
  InlineError,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SectionCard,
} from './health-record-modal-shell.js';

const NUMBER_INPUT_CLASS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

export function MedicalEventsForm(props: MedicalEventsFormProps) {
  return (
    <HealthRecordModalShell open size="XL" onClose={props.onClose}>
      <MedicalEventsFormBody {...props} />
    </HealthRecordModalShell>
  );
}

export type SmartInputState = {
  loading: boolean;
  error: string | null;
  imageName: string | null;
  onUpload: ((file: File) => void) | null;
};

export const EMPTY_SMART_INPUT_STATE: SmartInputState = {
  loading: false,
  error: null,
  imageName: null,
  onUpload: null,
};

export function MedicalEventFormContent({
  child,
  onSaved,
  onClose,
  onSmartInputStateChange,
}: {
  child: MedicalEventsChildContext;
  onSaved?: () => void;
  onClose: () => void;
  onSmartInputStateChange?: (state: SmartInputState) => void;
}) {
  const [events, setEvents] = useState<MedicalEventRow[]>([]);

  useEffect(() => {
    getMedicalEvents(child.childId)
      .then(setEvents)
      .catch(catchLog('medical-events', 'action:load-medical-events-failed'));
  }, [child.childId]);

  const formState = useMedicalEventsFormState(child, events, (next) => {
    setEvents(next);
    onSaved?.();
    onClose();
  });

  const handleOCRUpload = useCallback(
    (file: File) => { void formState.handleOCRUpload(file); },
    [formState.handleOCRUpload],
  );

  const smartInputHoisted = onSmartInputStateChange != null;

  useEffect(() => {
    if (!onSmartInputStateChange) return;
    onSmartInputStateChange({
      loading: formState.ocrLoading,
      error: formState.ocrError,
      imageName: formState.ocrImageName,
      onUpload: handleOCRUpload,
    });
  }, [
    onSmartInputStateChange,
    formState.ocrLoading,
    formState.ocrError,
    formState.ocrImageName,
    handleOCRUpload,
  ]);

  useEffect(() => {
    if (!onSmartInputStateChange) return;
    return () => onSmartInputStateChange(EMPTY_SMART_INPUT_STATE);
  }, [onSmartInputStateChange]);

  return (
    <MedicalEventsFormBody
      editingEventId={formState.editingEventId}
      formEventType={formState.formEventType}
      setFormEventType={formState.setFormEventType}
      formTitle={formState.formTitle}
      setFormTitle={formState.setFormTitle}
      formEventDate={formState.formEventDate}
      setFormEventDate={formState.setFormEventDate}
      formEndDate={formState.formEndDate}
      setFormEndDate={formState.setFormEndDate}
      formShowEndDate={formState.formShowEndDate}
      setFormShowEndDate={formState.setFormShowEndDate}
      formSeverity={formState.formSeverity}
      setFormSeverity={formState.setFormSeverity}
      formResult={formState.formResult}
      setFormResult={formState.setFormResult}
      formHospital={formState.formHospital}
      setFormHospital={formState.setFormHospital}
      formNotes={formState.formNotes}
      setFormNotes={formState.setFormNotes}
      formLabValues={formState.formLabValues}
      setFormLabValues={formState.setFormLabValues}
      formSymptomTags={formState.formSymptomTags}
      setFormSymptomTags={formState.setFormSymptomTags}
      formMeds={formState.formMeds}
      setFormMeds={formState.setFormMeds}
      historyDrugs={formState.historyDrugs}
      ocrLoading={formState.ocrLoading}
      ocrError={formState.ocrError}
      ocrImageName={formState.ocrImageName}
      ocrInputRef={formState.ocrInputRef}
      submitError={formState.submitError}
      saving={formState.saving}
      hideInlineSmartInput={smartInputHoisted}
      onClose={onClose}
      onSubmit={() => { void formState.submitForm(); }}
      onOCRUpload={handleOCRUpload}
    />
  );
}

type MedicalEventsFormProps = {
  editingEventId: string | null;
  formEventType: string;
  setFormEventType: (value: string) => void;
  formTitle: string;
  setFormTitle: (value: string) => void;
  formEventDate: string;
  setFormEventDate: (value: string) => void;
  formEndDate: string;
  setFormEndDate: (value: string) => void;
  formShowEndDate: boolean;
  setFormShowEndDate: (value: boolean) => void;
  formSeverity: string;
  setFormSeverity: (value: string) => void;
  formResult: string;
  setFormResult: (value: string) => void;
  formHospital: string;
  setFormHospital: (value: string) => void;
  formNotes: string;
  setFormNotes: (value: string) => void;
  formLabValues: Record<string, string>;
  setFormLabValues: (value: Record<string, string>) => void;
  formSymptomTags: Set<string>;
  setFormSymptomTags: (next: Set<string>) => void;
  formMeds: MedicalEventsFormMedication[];
  setFormMeds: (updater: (prev: MedicalEventsFormMedication[]) => MedicalEventsFormMedication[]) => void;
  historyDrugs: Array<{ name: string; unit?: string; frequency?: string }>;
  ocrLoading: boolean;
  ocrError: string | null;
  ocrImageName: string | null;
  ocrInputRef: RefObject<HTMLInputElement | null>;
  submitError: string | null;
  saving: boolean;
  hideInlineSmartInput?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onOCRUpload: (file: File) => void;
};

function MedicalEventsFormBody({
  editingEventId,
  formEventType,
  setFormEventType,
  formTitle,
  setFormTitle,
  formEventDate,
  setFormEventDate,
  formEndDate,
  setFormEndDate,
  formShowEndDate,
  setFormShowEndDate,
  formSeverity,
  setFormSeverity,
  formResult,
  setFormResult,
  formHospital,
  setFormHospital,
  formNotes,
  setFormNotes,
  formLabValues,
  setFormLabValues,
  formSymptomTags,
  setFormSymptomTags,
  formMeds,
  setFormMeds,
  historyDrugs,
  ocrLoading,
  ocrError,
  ocrImageName,
  ocrInputRef,
  submitError,
  saving,
  hideInlineSmartInput = false,
  onClose,
  onSubmit,
  onOCRUpload,
}: MedicalEventsFormProps) {
  const showResultField = formEventType === 'checkup';

  const visitChips: ChipOption<string>[] = VISIT_TYPES.map((type) => ({
    value: type,
    label: EVENT_TYPE_LABELS[type] ?? type,
  }));

  const symptomChips: ChipOption<string>[] = COMMON_SYMPTOMS.map((symptom) => ({
    value: symptom,
    label: symptom,
  }));

  const severityChips: ChipOption<string>[] = SEVERITY_OPTIONS.map((severity) => ({
    value: severity,
    label: SEVERITY_LABELS[severity] ?? severity,
  }));

  const resultChips: ChipOption<string>[] = RESULT_OPTIONS.map((result) => ({
    value: result,
    label: RESULT_LABELS[result] ?? result,
  }));

  return (
    <>
      <ModalHeader
        title={editingEventId ? '编辑就医记录' : '新增就医记录'}
        icon={EVENT_TYPE_ICONS[formEventType] ?? '🏥'}
        onClose={onClose}
      />
      <ModalContent>
        <div className="space-y-4">
          {!editingEventId && !hideInlineSmartInput ? (
            <>
              <input
                ref={ocrInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onOCRUpload(file);
                  event.target.value = '';
                }}
              />
              <div
                className="flex items-center gap-3 rounded-[16px] px-4 py-3"
                style={{
                  background: 'linear-gradient(135deg, #f1f5f9, #e8f0e8)',
                  border: `1px solid ${'var(--nimi-border-subtle)'}`,
                }}
              >
                <span className="text-[24px]">{ocrLoading ? '⏳' : '🤖'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--nimi-text-primary)' }}>
                    智能录入
                  </p>
                  {ocrLoading ? (
                    <p className="text-[12px]" style={{ color: 'var(--nimi-action-primary-bg)' }}>
                      正在识别 {ocrImageName}...
                    </p>
                  ) : ocrError ? (
                    <p className="text-[12px] text-[var(--nimi-status-danger)]">
                      {ocrError}
                    </p>
                  ) : ocrImageName ? (
                    <p className="text-[12px]" style={{ color: 'var(--nimi-action-primary-bg)' }}>
                      ✓ 已从 {ocrImageName} 提取信息，请确认并补充
                    </p>
                  ) : (
                    <p className="text-[12px]" style={{ color: 'var(--nimi-text-muted)' }}>
                      上传病历/处方单图片，AI 自动提取关键信息填入表单
                    </p>
                  )}
                </div>
                <button
                  onClick={() => ocrInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="shrink-0 rounded-[12px] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
                  style={{ background: 'var(--nimi-action-primary-bg)' }}
                >
                  {ocrLoading ? '识别中...' : '上传识别'}
                </button>
              </div>
            </>
          ) : null}

          <SectionCard title="就诊基础">
            <div className="space-y-4">
              <FormField label="就诊类型">
                <ChipGroup
                  options={visitChips}
                  value={formEventType}
                  onChange={setFormEventType}
                  activeColor={EVENT_TYPE_COLORS[formEventType] ?? 'var(--nimi-action-primary-bg)'}
                />
              </FormField>

              <FormGrid cols={2}>
                <FormField label="就诊日期">
                  <ProfileDatePicker value={formEventDate} onChange={setFormEventDate} className="h-12" />
                </FormField>
                <FormField label={formShowEndDate ? '结束日期' : '持续治疗/住院'}>
                  {formShowEndDate ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ProfileDatePicker value={formEndDate} onChange={setFormEndDate} allowClear className="h-12" />
                      </div>
                      <button
                        onClick={() => {
                          setFormShowEndDate(false);
                          setFormEndDate('');
                        }}
                        className="text-[12px]"
                        style={{ color: 'var(--nimi-text-muted)' }}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <DashedAddButton shape="row" onClick={() => setFormShowEndDate(true)} label="持续治疗/住院" />
                  )}
                </FormField>
              </FormGrid>

              <FormField label="就诊机构">
                <TextField
                  value={formHospital}
                  onChange={(event) => setFormHospital(event.target.value)}
                  placeholder="医院/诊所名称"
                  className="w-full min-h-12"
                />
              </FormField>
            </div>
          </SectionCard>

          {formEventType !== 'lab-report' ? (
            <SectionCard title="病情与诊断">
              <div className="space-y-4">
                <FormField label="确诊疾病/主要症状">
                  <TextField
                    value={formTitle}
                    onChange={(event) => setFormTitle(event.target.value)}
                    placeholder="如：手足口病、急性上呼吸道感染"
                    className="w-full min-h-12"
                  />
                </FormField>

                <FormField label="伴随症状（可多选）">
                  <div className="flex flex-wrap gap-1.5">
                    {symptomChips.map((chip) => {
                      const active = formSymptomTags.has(chip.value);
                      return (
                        <button
                          key={chip.value}
                          onClick={() => {
                            const next = new Set(formSymptomTags);
                            if (next.has(chip.value)) next.delete(chip.value);
                            else next.add(chip.value);
                            setFormSymptomTags(next);
                          }}
                          className="inline-flex h-9 items-center rounded-[12px] px-3 text-[13px] transition-all"
                          style={
                            active
                              ? { background: 'var(--nimi-action-primary-bg)', color: '#fff' }
                              : {
                                  border: `1px solid ${'var(--nimi-field-border)'}`,
                                  color: 'var(--nimi-text-muted)',
                                  background: 'var(--nimi-field-bg)',
                                }
                          }
                        >
                          {chip.label}
                        </button>
                      );
                    })}
                  </div>
                </FormField>

                <FormField label="严重程度">
                  <ChipGroup
                    options={severityChips}
                    value={formSeverity}
                    onChange={setFormSeverity}
                    layout="fill"
                    clearable
                    activeColor={SEVERITY_COLORS[formSeverity] ?? 'var(--nimi-action-primary-bg)'}
                  />
                </FormField>

                {showResultField ? (
                  <FormField label="筛查结果">
                    <ChipGroup options={resultChips} value={formResult} onChange={setFormResult} layout="fill" clearable />
                  </FormField>
                ) : null}
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="化验项目" description="填写有数值的项目即可">
              <FormGrid cols={2} gap={2}>
                {LAB_ITEMS.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <label
                      className="w-16 shrink-0 text-[13px] font-medium"
                      style={{ color: 'var(--nimi-text-primary)' }}
                    >
                      {item.label}
                    </label>
                    <div className="flex-1">
                      <TextField
                        type="number"
                        step="0.1"
                        placeholder={item.unit}
                        value={formLabValues[item.key] ?? ''}
                        onChange={(event) =>
                          setFormLabValues({ ...formLabValues, [item.key]: event.target.value })
                        }
                        className="w-full min-h-12"
                        inputClassName={NUMBER_INPUT_CLASS}
                      />
                    </div>
                    <span
                      className="w-14 shrink-0 text-[12px]"
                      style={{ color: 'var(--nimi-text-muted)' }}
                    >
                      {item.unit}
                    </span>
                  </div>
                ))}
              </FormGrid>
            </SectionCard>
          )}

          {formEventType !== 'lab-report' ? (
            <SectionCard
              title="用药与处置"
              trailing={
                formMeds.length > 0 ? (
                  <span className="text-[12px]" style={{ color: 'var(--nimi-text-muted)' }}>
                    {formMeds.length} 种药品
                  </span>
                ) : null
              }
            >
              <div className="space-y-3">
                {formMeds.map((med, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-[14px] px-3 py-3"
                    style={{ background: 'var(--nimi-field-bg)', border: `1px solid ${'var(--nimi-field-border)'}` }}
                  >
                    <div className="flex items-center gap-2">
                      <DrugComboBox
                        value={med.name}
                        onChange={(value) =>
                          setFormMeds((prev) => prev.map((item, i) => (i === index ? { ...item, name: value } : item)))
                        }
                        onSelect={(selection: DrugSelection) =>
                          setFormMeds((prev) =>
                            prev.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    name: selection.name,
                                    unit: selection.unit,
                                    frequency: selection.frequency,
                                    tags: selection.tags,
                                  }
                                : item,
                            ),
                          )
                        }
                        historyDrugs={historyDrugs}
                        placeholder="搜索药品名称或拼音首字母"
                      />
                      <button
                        onClick={() => setFormMeds((prev) => prev.filter((_, i) => i !== index))}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors hover:bg-red-50"
                        style={{ color: 'var(--nimi-text-muted)' }}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={med.dose}
                        onChange={(event) =>
                          setFormMeds((prev) => prev.map((item, i) => (i === index ? { ...item, dose: event.target.value } : item)))
                        }
                        placeholder="剂量"
                        className="w-16 rounded-[10px] px-2 py-1.5 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/35"
                        style={{ border: `1px solid ${'var(--nimi-field-border)'}`, background: '#fff', color: 'var(--nimi-text-primary)' }}
                      />
                      <span
                        className="rounded-[10px] px-2 py-1 text-[13px]"
                        style={{ background: '#f1f5f9', color: 'var(--nimi-action-primary-bg)' }}
                      >
                        {med.unit || '次'}
                      </span>
                      <input
                        value={med.frequency}
                        onChange={(event) =>
                          setFormMeds((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, frequency: event.target.value } : item)),
                          )
                        }
                        placeholder="频次（如每日3次）"
                        className="min-w-0 flex-1 rounded-[10px] px-2 py-1.5 text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/35"
                        style={{ border: `1px solid ${'var(--nimi-field-border)'}`, background: '#fff', color: 'var(--nimi-text-primary)' }}
                      />
                      <input
                        value={med.days}
                        onChange={(event) =>
                          setFormMeds((prev) => prev.map((item, i) => (i === index ? { ...item, days: event.target.value } : item)))
                        }
                        placeholder="天"
                        className="w-12 rounded-[10px] px-2 py-1.5 text-center text-[14px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/35"
                        style={{ border: `1px solid ${'var(--nimi-field-border)'}`, background: '#fff', color: 'var(--nimi-text-primary)' }}
                      />
                      <span className="shrink-0 text-[13px]" style={{ color: 'var(--nimi-text-muted)' }}>
                        天
                      </span>
                    </div>
                    {med.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        <span className="text-[12px]" style={{ color: 'var(--nimi-text-muted)' }}>
                          常见用法参考：
                        </span>
                        {med.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded px-1.5 py-0.5 text-[12px]"
                            style={{ background: '#f0f7e4', color: '#6b8a1a' }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}

                <DashedAddButton
                  shape="row"
                  onClick={() =>
                    setFormMeds((prev) => [...prev, { name: '', dose: '', unit: '次', frequency: '', days: '', tags: [] }])
                  }
                  label="添加药品"
                />
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="附件与备注">
            <FormField label="补充说明">
              <TextareaField
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                placeholder="医嘱、复诊安排、其他需要记录的信息..."
                rows={2}
                className="w-full"
              />
            </FormField>
          </SectionCard>

          {submitError ? <InlineError>{submitError}</InlineError> : null}
        </div>
      </ModalContent>
      <ModalFooter>
        <Button type="button" onClick={onClose} tone="ghost" size="md">取消</Button>
        <Button type="button" onClick={onSubmit} disabled={saving} tone="primary" size="md">
          {saving ? '保存中...' : editingEventId ? '更新记录' : '保存记录'}
        </Button>
      </ModalFooter>
    </>
  );
}
