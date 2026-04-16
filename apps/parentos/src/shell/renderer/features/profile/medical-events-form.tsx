import type { RefObject } from 'react';
import { S } from '../../app-shell/page-style.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { DrugComboBox, type DrugSelection } from './drug-combobox.js';
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
import type { MedicalEventsFormMedication } from './medical-events-page-types.js';

export function MedicalEventsForm({
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
  onClose,
  onSubmit,
  onOCRUpload,
}: {
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
  onClose: () => void;
  onSubmit: () => void;
  onOCRUpload: (file: File) => void;
}) {
  const showResultField = formEventType === 'checkup';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-[520px] max-h-[85vh] flex flex-col rounded-2xl shadow-xl" style={{ background: '#f4f5f0' }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px]" style={{ background: '#f1f5f9' }}>
              {EVENT_TYPE_ICONS[formEventType] ?? '🏥'}
            </span>
            <h2 className="text-[16px] font-bold" style={{ color: S.text }}>{editingEventId ? '编辑就医记录' : '新增就医记录'}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors" style={{ color: S.sub }}>✕</button>
        </div>

        {!editingEventId ? (
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
            <div className="mx-6 mb-4 rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #f1f5f9, #e8f0e8)', border: `1px solid ${S.border}` }}>
              <span className="text-[22px]">{ocrLoading ? '⏳' : '🤖'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold" style={{ color: S.text }}>智能录入</p>
                {ocrLoading ? (
                  <p className="text-[10px]" style={{ color: S.accent }}>正在识别 {ocrImageName}...</p>
                ) : ocrError ? (
                  <p className="text-[10px]" style={{ color: '#dc2626' }}>{ocrError}</p>
                ) : ocrImageName ? (
                  <p className="text-[10px]" style={{ color: S.accent }}>✓ 已从 {ocrImageName} 提取信息，请确认并补充</p>
                ) : (
                  <p className="text-[10px]" style={{ color: S.sub }}>上传病历/处方单图片，AI 自动提取关键信息填入表单</p>
                )}
              </div>
              <button
                onClick={() => ocrInputRef.current?.click()}
                disabled={ocrLoading}
                className="shrink-0 px-3 py-1.5 text-[11px] font-medium text-white rounded-lg transition-colors hover:brightness-110 disabled:opacity-50"
                style={{ background: S.accent }}
              >
                {ocrLoading ? '识别中...' : '上传识别'}
              </button>
            </div>
          </>
        ) : null}

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
            <p className="text-[12px] font-semibold" style={{ color: S.text }}>就诊基础</p>

            <div>
              <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>就诊类型</p>
              <div className="flex flex-wrap gap-1.5">
                {VISIT_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => setFormEventType(type)}
                    className="px-3 py-2 text-[11px] font-medium rounded-xl transition-all"
                    style={formEventType === type
                      ? { background: EVENT_TYPE_COLORS[type] ?? S.accent, color: '#fff' }
                      : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}
                  >
                    {EVENT_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>就诊日期</p>
                <ProfileDatePicker value={formEventDate} onChange={setFormEventDate} style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text, borderRadius: 12 }} />
              </div>
              <div>
                {formShowEndDate ? (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-medium" style={{ color: S.sub }}>结束日期</p>
                      <button onClick={() => { setFormShowEndDate(false); setFormEndDate(''); }} className="text-[10px]" style={{ color: S.sub }}>取消</button>
                    </div>
                    <ProfileDatePicker value={formEndDate} onChange={setFormEndDate} allowClear style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text, borderRadius: 12 }} />
                  </>
                ) : (
                  <div className="flex items-end h-full pb-0.5">
                    <button onClick={() => setFormShowEndDate(true)} className="text-[11px] font-medium rounded-xl px-3 py-2 transition-colors hover:bg-[#f0f2ee]" style={{ border: `1px dashed ${S.border}`, color: S.sub }}>
                      + 持续治疗/住院
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>就诊机构</p>
              <input
                value={formHospital}
                onChange={(event) => setFormHospital(event.target.value)}
                placeholder="医院/诊所名称"
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50"
                style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }}
              />
            </div>
          </div>

          {formEventType !== 'lab-report' ? (
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>病情与诊断</p>

              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>确诊疾病/主要症状</p>
                <input
                  value={formTitle}
                  onChange={(event) => setFormTitle(event.target.value)}
                  placeholder="如：手足口病、急性上呼吸道感染"
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50"
                  style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }}
                />
              </div>

              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>伴随症状（可多选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_SYMPTOMS.map((symptom) => (
                    <button
                      key={symptom}
                      onClick={() => {
                        const next = new Set(formSymptomTags);
                        if (next.has(symptom)) next.delete(symptom);
                        else next.add(symptom);
                        setFormSymptomTags(next);
                      }}
                      className="px-2.5 py-1.5 text-[11px] rounded-xl transition-all"
                      style={formSymptomTags.has(symptom)
                        ? { background: S.accent, color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}
                    >
                      {symptom}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>严重程度</p>
                <div className="flex gap-1.5">
                  {SEVERITY_OPTIONS.map((severity) => (
                    <button
                      key={severity}
                      onClick={() => setFormSeverity(formSeverity === severity ? '' : severity)}
                      className="flex-1 py-2.5 text-[11px] font-medium rounded-xl transition-all"
                      style={formSeverity === severity
                        ? { background: SEVERITY_COLORS[severity], color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}
                    >
                      {SEVERITY_LABELS[severity]}
                    </button>
                  ))}
                </div>
              </div>

              {showResultField ? (
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>筛查结果</p>
                  <div className="flex gap-1.5">
                    {RESULT_OPTIONS.map((result) => (
                      <button
                        key={result}
                        onClick={() => setFormResult(formResult === result ? '' : result)}
                        className="flex-1 py-2.5 text-[11px] font-medium rounded-xl transition-all"
                        style={formResult === result
                          ? { background: S.accent, color: '#fff' }
                          : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}
                      >
                        {RESULT_LABELS[result]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>化验项目</p>
              <p className="text-[10px]" style={{ color: S.sub }}>填写有数值的项目即可</p>
              <div className="grid grid-cols-2 gap-2">
                {LAB_ITEMS.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <label className="text-[11px] w-16 shrink-0 font-medium" style={{ color: S.text }}>{item.label}</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder={item.unit}
                      value={formLabValues[item.key] ?? ''}
                      onChange={(event) => setFormLabValues({ ...formLabValues, [item.key]: event.target.value })}
                      className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50"
                      style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8' }}
                    />
                    <span className="text-[10px] w-14 shrink-0" style={{ color: S.sub }}>{item.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {formEventType !== 'lab-report' ? (
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold" style={{ color: S.text }}>用药与处置</p>
                {formMeds.length > 0 ? <span className="text-[10px]" style={{ color: S.sub }}>{formMeds.length} 种药品</span> : null}
              </div>

              <div className="space-y-3">
                {formMeds.map((med, index) => (
                  <div key={index} className="rounded-xl px-3 py-3 space-y-2" style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
                    <div className="flex items-center gap-2">
                      <DrugComboBox
                        value={med.name}
                        onChange={(value) => setFormMeds((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, name: value } : item))}
                        onSelect={(selection: DrugSelection) => setFormMeds((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, name: selection.name, unit: selection.unit, frequency: selection.frequency, tags: selection.tags } : item))}
                        historyDrugs={historyDrugs}
                        placeholder="搜索药品名称或拼音首字母"
                      />
                      <button onClick={() => setFormMeds((prev) => prev.filter((_, itemIndex) => itemIndex !== index))} className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors" style={{ color: S.sub }}>✕</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input value={med.dose} onChange={(event) => setFormMeds((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, dose: event.target.value } : item))} placeholder="剂量" className="w-16 rounded-lg px-2 py-1.5 text-[12px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50" style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fff', color: S.text }} />
                      <span className="text-[11px] px-2 py-1 rounded-lg" style={{ background: '#f1f5f9', color: S.accent }}>{med.unit || '次'}</span>
                      <input value={med.frequency} onChange={(event) => setFormMeds((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, frequency: event.target.value } : item))} placeholder="频次（如每日3次）" className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-[12px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50" style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fff', color: S.text }} />
                      <input value={med.days} onChange={(event) => setFormMeds((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, days: event.target.value } : item))} placeholder="天" className="w-12 rounded-lg px-2 py-1.5 text-[12px] outline-none text-center transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50" style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fff', color: S.text }} />
                      <span className="text-[11px] shrink-0" style={{ color: S.sub }}>天</span>
                    </div>
                    {med.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        <span className="text-[9px]" style={{ color: S.sub }}>常见用法参考：</span>
                        {med.tags.map((tag) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#f0f7e4', color: '#6b8a1a' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <button onClick={() => setFormMeds((prev) => [...prev, { name: '', dose: '', unit: '次', frequency: '', days: '', tags: [] }])} className="w-full py-2.5 text-[11px] font-medium rounded-xl transition-colors hover:bg-[#f0f2ee]" style={{ border: `1px dashed ${S.border}`, color: S.sub }}>
                + 添加药品
              </button>
            </div>
          ) : null}

          <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
            <p className="text-[12px] font-semibold" style={{ color: S.text }}>附件与备注</p>
            <div>
              <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>补充说明</p>
              <textarea
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                placeholder="医嘱、复诊安排、其他需要记录的信息..."
                rows={2}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#4ECCA3]/50 resize-none"
                style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }}
              />
            </div>
          </div>

          {submitError ? (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{submitError}</p>
          ) : null}
        </div>

        <div className="shrink-0 px-6 py-4" style={{ borderTop: `1px solid ${S.border}`, background: '#f4f5f0' }}>
          <div className="flex items-center justify-end gap-2.5">
            <button onClick={onClose} className="px-5 py-2.5 text-[13px] rounded-xl transition-colors hover:bg-[#e8e8e4]" style={{ background: '#e8e8e4', color: S.sub }}>取消</button>
            <button onClick={onSubmit} disabled={saving} className="px-6 py-2.5 text-[13px] font-medium text-white rounded-xl transition-colors hover:brightness-110 disabled:opacity-50" style={{ background: S.accent }}>
              {saving ? '保存中...' : editingEventId ? '更新记录' : '保存记录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
