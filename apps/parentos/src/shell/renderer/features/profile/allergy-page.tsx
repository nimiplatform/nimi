import { Button, DashedAddButton, DatePicker, Surface, TextareaField, TextField } from '@nimiplatform/kit/ui';
import {
  HealthRecordModalShell,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from './health-record-modal-shell.js';
import { useState, useEffect } from 'react';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertAllergyRecord, updateAllergyRecord, getAllergyRecords, upsertReminderState } from '../../bridge/sqlite-bridge.js';
import type { AllergyRecordRow } from '../../bridge/sqlite-bridge.js';
import { generateAllergyFollowups } from '../../engine/smart-alerts.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';

/* ── Constants ───────────────────────────────────────────── */

const CATEGORY_LABELS: Record<string, string> = { food: '食物', drug: '药物', environmental: '环境', contact: '接触', other: '其他' };
const STATUS_LABELS: Record<string, string> = { active: '活跃', outgrown: '已脱敏', uncertain: '不确定' };
const SEVERITY_LABELS: Record<string, string> = { mild: '轻度', moderate: '中度', severe: '重度' };
const CONFIRMED_LABELS: Record<string, string> = { 'clinical-test': '临床检测', 'physician-diagnosis': '医生诊断', 'parent-observation': '家长观察' };

// Quick-pick allergen tags
const COMMON_ALLERGENS: Array<{ label: string; category: string }> = [
  { label: '牛奶', category: 'food' }, { label: '鸡蛋', category: 'food' }, { label: '花生', category: 'food' },
  { label: '坚果', category: 'food' }, { label: '小麦', category: 'food' }, { label: '大豆', category: 'food' },
  { label: '海鲜', category: 'food' }, { label: '鱼类', category: 'food' }, { label: '芒果', category: 'food' },
  { label: '桃子', category: 'food' }, { label: '尘螨', category: 'environmental' }, { label: '花粉', category: 'environmental' },
  { label: '猫毛', category: 'environmental' }, { label: '狗毛', category: 'environmental' }, { label: '霉菌', category: 'environmental' },
  { label: '青霉素', category: 'drug' }, { label: '头孢', category: 'drug' }, { label: '阿莫西林', category: 'drug' },
  { label: '乳胶', category: 'contact' }, { label: '金属(镍)', category: 'contact' },
];

// Reaction symptom tags (multi-select)
const SYMPTOM_TAGS = [
  { key: 'rash', label: '起皮疹', emoji: '🔴' },
  { key: 'hives', label: '荨麻疹/风团', emoji: '⭕' },
  { key: 'eczema', label: '湿疹加重', emoji: '🟠' },
  { key: 'swelling', label: '局部红肿', emoji: '🫧' },
  { key: 'itching', label: '瘙痒', emoji: '😣' },
  { key: 'vomiting', label: '呕吐', emoji: '🤮' },
  { key: 'diarrhea', label: '腹泻', emoji: '💩' },
  { key: 'abdominal', label: '腹痛', emoji: '😫' },
  { key: 'runny-nose', label: '流鼻涕/打喷嚏', emoji: '🤧' },
  { key: 'cough', label: '咳嗽', emoji: '😮‍💨' },
  { key: 'wheeze', label: '呼吸急促/喘息', emoji: '😰' },
  { key: 'eye-itch', label: '眼睛痒/红', emoji: '👁️' },
  { key: 'anaphylaxis', label: '全身严重反应', emoji: '🚨' },
] as const;

// Treatment tags
const TREATMENT_TAGS = [
  '停止接触过敏原', '口服抗组胺药(如西替利嗪)', '外用激素药膏',
  '口服激素', '肾上腺素笔', '雾化吸入', '紧急就医/急诊', '冷敷',
  '观察未用药',
] as const;

const choiceChipClass = (selected: boolean) =>
  `rounded-full border px-2.5 py-1 text-[13px] transition-all ${selected
    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]'}`;

const roundedChoiceClass = (selected: boolean, extra = '') =>
  `rounded-2xl border px-2.5 py-1.5 text-[13px] transition-all ${selected
    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]'} ${extra}`;

const severityClass = (severity: string) => {
  if (severity === 'severe') return 'border-[color-mix(in_srgb,var(--nimi-status-danger)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]';
  if (severity === 'moderate') return 'border-[color-mix(in_srgb,var(--nimi-status-warning)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]';
  return 'border-[color-mix(in_srgb,var(--nimi-text-primary)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,var(--nimi-surface-card))] text-[var(--nimi-text-primary)]';
};

const severityBorderClass = (severity: string) => {
  if (severity === 'severe') return 'border-l-[var(--nimi-status-danger)]';
  if (severity === 'moderate') return 'border-l-[var(--nimi-status-warning)]';
  return 'border-l-[var(--nimi-text-primary)]';
};

const statusClass = (status: string) => {
  if (status === 'active') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]';
  if (status === 'outgrown') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]';
  return 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]';
};

/* ── Main page ───────────────────────────────────────────── */

export default function AllergyPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<AllergyRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showMore, setShowMore] = useState<false | 'allergens' | 'symptoms' | 'medical'>(false);

  // Form state — core
  const [formAllergen, setFormAllergen] = useState('');
  const [formCategory, setFormCategory] = useState('food');
  const [formSeverity, setFormSeverity] = useState('');
  const [formDiagnosedAt, setFormDiagnosedAt] = useState(new Date().toISOString().slice(0, 10));

  // Form state — optional details
  const [formSymptoms, setFormSymptoms] = useState<Set<string>>(new Set());
  const [formTreatments, setFormTreatments] = useState<Set<string>>(new Set());
  const [formStatus, setFormStatus] = useState('active');
  const [formConfirmedBy, setFormConfirmedBy] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formCustomSymptom, setFormCustomSymptom] = useState('');
  const [formCustomTreatment, setFormCustomTreatment] = useState('');
  // Photo is stored as notes reference (actual file handling would need Tauri FS)
  const [formPhotoName, setFormPhotoName] = useState('');

  useEffect(() => {
    if (activeChildId) getAllergyRecords(activeChildId).then(setRecords).catch(catchLog('allergy', 'action:load-allergy-records-failed'));
  }, [activeChildId]);

  if (!child) {
    return (
      <ProfileDetailShell title="过敏记录">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);
  const ageY = Math.floor(ageMonths / 12), ageR = ageMonths % 12;
  const activeRecords = records.filter((r) => r.status === 'active');
  const otherRecords = records.filter((r) => r.status !== 'active');

  const toggleSymptom = (key: string) => setFormSymptoms((prev) => {
    const next = new Set(prev);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  });
  const toggleTreatment = (t: string) => setFormTreatments((prev) => {
    const next = new Set(prev);
    if (next.has(t)) {
      next.delete(t);
    } else {
      next.add(t);
    }
    return next;
  });

  const resetForm = () => {
    setFormAllergen(''); setFormCategory('food'); setFormSeverity(''); setFormDiagnosedAt(new Date().toISOString().slice(0, 10));
    setFormSymptoms(new Set()); setFormTreatments(new Set()); setFormStatus('active');
    setFormConfirmedBy(''); setFormNotes(''); setFormCustomSymptom(''); setFormCustomTreatment('');
    setFormPhotoName(''); setShowMore(false); setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formAllergen.trim() || !formSeverity) return;
    const now = isoNow();
    // Build structured notes
    const parts: string[] = [];
    const allSymptoms = [...formSymptoms].map((k) => SYMPTOM_TAGS.find((t) => t.key === k)?.label ?? k);
    if (formCustomSymptom.trim()) allSymptoms.push(formCustomSymptom.trim());
    if (allSymptoms.length > 0) parts.push(`症状: ${allSymptoms.join('、')}`);
    const allTreatments = [...formTreatments];
    if (formCustomTreatment.trim()) allTreatments.push(formCustomTreatment.trim());
    if (allTreatments.length > 0) parts.push(`处理: ${allTreatments.join('、')}`);
    if (formPhotoName) parts.push(`附照片: ${formPhotoName}`);
    if (formNotes) parts.push(formNotes);
    const noteStr = parts.length > 0 ? parts.join(' | ') : null;
    const reactionType = formSymptoms.has('anaphylaxis') ? 'anaphylaxis' : formSymptoms.has('wheeze') || formSymptoms.has('cough') ? 'respiratory' : formSymptoms.has('vomiting') || formSymptoms.has('diarrhea') || formSymptoms.has('abdominal') ? 'gastrointestinal' : formSymptoms.size > 0 ? 'skin' : null;

    try {
      await insertAllergyRecord({
        recordId: ulid(), childId: child.childId, allergen: formAllergen.trim(), category: formCategory,
        reactionType, severity: formSeverity, diagnosedAt: formDiagnosedAt || null,
        ageMonthsAtDiagnosis: formDiagnosedAt ? computeAgeMonthsAt(child.birthDate, formDiagnosedAt) : null,
        status: formStatus, statusChangedAt: now, confirmedBy: formConfirmedBy || null, notes: noteStr, now,
      });
      setRecords(await getAllergyRecords(child.childId));

      // Generate follow-up tasks based on symptoms and severity
      const followups = generateAllergyFollowups(child.childId, {
        allergen: formAllergen.trim(),
        severity: formSeverity,
        symptoms: [...formSymptoms],
        eventDate: formDiagnosedAt || (now.split('T')[0] ?? now),
      });
      for (const task of followups) {
        try {
          await upsertReminderState({
            stateId: ulid(), childId: child.childId,
            ruleId: task.id, status: 'active', activatedAt: now,
            completedAt: null, dismissedAt: null, dismissReason: null,
            repeatIndex: 0, nextTriggerAt: task.triggerDate,
            notes: `${task.title}: ${task.description}`, now,
          });
        } catch { /* skip if duplicate */ }
      }

      resetForm();
    } catch { /* bridge */ }
  };

  const handleMarkOutgrown = async (r: AllergyRecordRow) => {
    const now = isoNow();
    try {
      await updateAllergyRecord({ recordId: r.recordId, allergen: r.allergen, category: r.category, reactionType: r.reactionType, severity: r.severity, status: 'outgrown', statusChangedAt: now, confirmedBy: r.confirmedBy, notes: r.notes, now });
      setRecords(await getAllergyRecords(child.childId));
    } catch { /* bridge */ }
  };

  return (
    <ProfileDetailShell
      title="过敏记录"
      actions={!showForm ? (
        <Button onClick={() => setShowForm(true)} tone="primary" size="md">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          记录过敏
        </Button>
      ) : null}
      aiSummary={
        <AISummaryCard domain="allergy" childName={child.displayName} childId={child.childId}
          ageLabel={`${ageY}岁${ageR}个月`} gender={child.gender}
          dataContext={activeRecords.length > 0 ? `活跃过敏原: ${activeRecords.map((r) => `${r.allergen}(${SEVERITY_LABELS[r.severity] ?? r.severity})`).join('、')}` : ''} />
      }
    >
      {/* ── Form ─────────────────────────────────────────── */}
      {showForm && (
        <HealthRecordModalShell open size="M" onClose={resetForm}>
          <ModalHeader title="添加过敏记录" icon="🤧" onClose={resetForm} />
          <ModalContent>

            {/* ━━ Section 1: Core ━━ */}
            <div className="space-y-3 pb-4">

              {/* Allergen */}
              <div>
                <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">过敏原 <span className="text-[var(--nimi-status-danger)]">*</span></p>
                <TextField value={formAllergen} onChange={(e) => setFormAllergen(e.target.value)} placeholder="输入过敏原名称" className="w-full" />
              </div>

              {/* Quick-pick: top 6 visible, rest in expandable row */}
              <div className="flex flex-wrap gap-1.5">
                {COMMON_ALLERGENS.slice(0, 6).map((a) => (
                  <button key={a.label} onClick={() => { setFormAllergen(a.label); setFormCategory(a.category); }}
                    className={choiceChipClass(formAllergen === a.label)}>
                    {a.label}
                  </button>
                ))}
                <button onClick={() => setShowMore(showMore === 'allergens' ? false : 'allergens')}
                  className={choiceChipClass(showMore === 'allergens')}>
                  + 更多
                </button>
              </div>
              {showMore === 'allergens' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COMMON_ALLERGENS.slice(6).map((a) => (
                    <button key={a.label} onClick={() => { setFormAllergen(a.label); setFormCategory(a.category); }}
                      className={choiceChipClass(formAllergen === a.label)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Date + Severity side-by-side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">发生日期 <span className="text-[var(--nimi-status-danger)]">*</span></p>
                  <DatePicker
                    value={formDiagnosedAt}
                    onChange={setFormDiagnosedAt}
                  />
                </div>
                <div>
                  <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">严重程度 <span className="text-[var(--nimi-status-danger)]">*</span></p>
                  <div className="flex gap-1.5">
                    {(['mild', 'moderate', 'severe'] as const).map((sv) => (
                      <button key={sv} onClick={() => setFormSeverity(formSeverity === sv ? '' : sv)}
                        className={`flex-1 rounded-2xl border py-2 text-[13px] font-medium transition-all ${formSeverity === sv ? severityClass(sv) : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]'}`}>
                        {SEVERITY_LABELS[sv]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ━━ Section 2: Symptoms + Photo ━━ */}
            <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] py-4">
              <p className="text-[13px] font-medium text-[var(--nimi-text-muted)]">症状表现 <span className="font-normal">（可多选）</span></p>

              {/* Top 6 symptoms visible */}
              <div className="flex flex-wrap gap-1.5">
                {SYMPTOM_TAGS.slice(0, 6).map((t) => (
                  <button key={t.key} onClick={() => toggleSymptom(t.key)}
                    className={roundedChoiceClass(formSymptoms.has(t.key))}>
                    {t.label}
                  </button>
                ))}
                <button onClick={() => setShowMore(showMore === 'symptoms' ? false : 'symptoms')}
                  className={roundedChoiceClass(showMore === 'symptoms')}>
                  + 更多症状
                </button>
              </div>
              {showMore === 'symptoms' && (
                <div className="flex flex-wrap gap-1.5">
                  {SYMPTOM_TAGS.slice(6).map((t) => (
                    <button key={t.key} onClick={() => toggleSymptom(t.key)}
                      className={roundedChoiceClass(formSymptoms.has(t.key))}>
                      {t.label}
                    </button>
                  ))}
                  <TextField value={formCustomSymptom} onChange={(e) => setFormCustomSymptom(e.target.value)}
                    placeholder="自定义症状..."
                    className="w-32" />
                </div>
              )}

              {/* Photo — tight to symptoms */}
              <div>
                <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">
                  现场照片 <span className="font-normal">（皮疹/红斑等，就医时极有帮助）</span>
                </p>
                {formPhotoName ? (
                  <div className="group flex w-full items-center gap-2 rounded-2xl border border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-card)] px-4 py-2 text-[14px] text-[var(--nimi-text-primary)]">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={'var(--nimi-action-primary-bg)'} strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M3 8h2l2-3h10l2 3h2" />
                    </svg>
                    <span className="truncate flex-1">{formPhotoName}</span>
                    <button onClick={() => setFormPhotoName('')}
                      className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[12px] text-[var(--nimi-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] hover:text-[var(--nimi-status-danger)]">✕</button>
                  </div>
                ) : (
                  <DashedAddButton
                    shape="tile"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
                      input.onchange = () => {
                        const files = input.files;
                        if (files && files.length > 0) setFormPhotoName(Array.from(files).map((f) => f.name).join(', '));
                      };
                      input.click();
                    }}
                    label="点击拍照或选择照片"
                  />
                )}
              </div>
            </div>

            {/* ━━ Section 3: Medical details (collapsed) ━━ */}
            <div className="border-t border-[var(--nimi-border-subtle)] py-3">
              <button onClick={() => setShowMore(showMore === 'medical' ? false : 'medical')}
                className="flex items-center gap-1.5 text-[13px] font-medium w-full text-[var(--nimi-text-muted)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  className={`transition-transform duration-200 ${showMore === 'medical' ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
                {showMore === 'medical' ? '收起医疗与后续信息' : '补充医疗与后续信息'}
              </button>

              {showMore === 'medical' && (
                <div className="mt-3 space-y-4">

                  {/* Treatment tags */}
                  <div>
                    <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">处理措施 <span className="font-normal">（可多选）</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {TREATMENT_TAGS.map((t) => (
                        <button key={t} onClick={() => toggleTreatment(t)}
                          className={roundedChoiceClass(formTreatments.has(t))}>
                          {t}
                        </button>
                      ))}
                      <TextField value={formCustomTreatment} onChange={(e) => setFormCustomTreatment(e.target.value)}
                        placeholder="自定义..."
                        className="w-28" />
                    </div>
                  </div>

                  {/* Category + Confirmed by + Status — unified grid */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">过敏类别</p>
                      <div className="flex flex-col gap-1">
                        {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                          <button key={k} onClick={() => setFormCategory(k)}
                            className={roundedChoiceClass(formCategory === k, 'text-left')}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">确认方式</p>
                      <div className="flex flex-col gap-1">
                        {Object.entries(CONFIRMED_LABELS).map(([k, l]) => (
                          <button key={k} onClick={() => setFormConfirmedBy(formConfirmedBy === k ? '' : k)}
                            className={roundedChoiceClass(formConfirmedBy === k, 'text-left')}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">当前状态</p>
                      <div className="flex flex-col gap-1">
                        {Object.entries(STATUS_LABELS).map(([k, l]) => (
                          <button key={k} onClick={() => setFormStatus(k)}
                            className={roundedChoiceClass(formStatus === k, 'text-left')}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <p className="text-[13px] mb-1.5 font-medium text-[var(--nimi-text-muted)]">补充备注</p>
                    <TextareaField value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="其他需要记录的信息..."
                      className="w-full" rows={2} />
                  </div>
                </div>
              )}
            </div>
          </ModalContent>
          <ModalFooter>
            <Button onClick={resetForm} tone="ghost" size="md">取消</Button>
            <Button onClick={() => void handleSubmit()} disabled={!formAllergen.trim() || !formSeverity} tone="primary" size="md">保存</Button>
          </ModalFooter>
        </HealthRecordModalShell>
      )}

      {/* ── Active allergies ─────────────────────────────── */}
      {activeRecords.length > 0 && (
        <div className="mb-5">
          <h2 className="text-[14px] font-semibold mb-3 text-[var(--nimi-text-primary)]">
            活跃过敏原（{activeRecords.length}）
          </h2>
          <div className="space-y-2">
            {activeRecords.map((r) => (
              <AllergyCard key={r.recordId} record={r} onMarkOutgrown={() => void handleMarkOutgrown(r)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Resolved / other ─────────────────────────────── */}
      {otherRecords.length > 0 && (
        <div className="mb-5">
          <h2 className="text-[14px] font-semibold mb-3 text-[var(--nimi-text-muted)]">已脱敏 / 不确定（{otherRecords.length}）</h2>
          <div className="space-y-2">
            {otherRecords.map((r) => <AllergyCard key={r.recordId} record={r} />)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {records.length === 0 && !showForm && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-8 text-center">
          <span className="text-[24px]">🤧</span>
          <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">还没有过敏记录</p>
          <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">记录已知的过敏原，方便就医时快速参考</p>
        </Surface>
      )}
    </ProfileDetailShell>
  );
}

/* ── Allergy record card ─────────────────────────────────── */

function AllergyCard({ record: r, onMarkOutgrown }: { record: AllergyRecordRow; onMarkOutgrown?: () => void }) {
  // Parse structured notes
  const symptoms = r.notes?.match(/症状: ([^|]+)/)?.[1];
  const treatments = r.notes?.match(/处理: ([^|]+)/)?.[1];
  const hasPhoto = r.notes?.includes('附照片:');

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className={`rounded-2xl border-l-4 ${severityBorderClass(r.severity)}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">{r.allergen}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[12px] ${statusClass(r.status)}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[12px] ${severityClass(r.severity)}`}>{SEVERITY_LABELS[r.severity] ?? r.severity}</span>
            <span className="text-[12px] text-[var(--nimi-text-muted)]">{CATEGORY_LABELS[r.category] ?? r.category}</span>
            {hasPhoto && <span className="text-[12px]" title="有照片记录">📷</span>}
          </div>
          {symptoms && <p className="text-[13px] mt-1.5 text-[var(--nimi-text-muted)]">症状：{symptoms}</p>}
          {treatments && <p className="text-[13px] mt-0.5 text-[var(--nimi-text-muted)]">处理：{treatments}</p>}
          <p className="mt-1 text-[12px] text-[var(--nimi-text-muted)]">
            {r.diagnosedAt && `${r.diagnosedAt.split('T')[0]}`}
            {r.confirmedBy && ` · ${CONFIRMED_LABELS[r.confirmedBy] ?? r.confirmedBy}`}
          </p>
        </div>
        {r.status === 'active' && onMarkOutgrown && (
          <Button onClick={onMarkOutgrown} tone="secondary" size="sm" className="shrink-0 border-[color-mix(in_srgb,var(--nimi-status-success)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]">
            标记脱敏
          </Button>
        )}
      </div>
    </Surface>
  );
}
