import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { insertAllergyRecord, updateAllergyRecord, getAllergyRecords, upsertReminderState } from '../../bridge/sqlite-bridge.js';
import type { AllergyRecordRow } from '../../bridge/sqlite-bridge.js';
import { generateAllergyFollowups } from '../../engine/smart-alerts.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { ProfileDatePicker } from './profile-date-picker.js';

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

/* ── Main page ───────────────────────────────────────────── */

export default function AllergyPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
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
  const [photoHover, setPhotoHover] = useState(false);

  useEffect(() => {
    if (activeChildId) getAllergyRecords(activeChildId).then(setRecords).catch(catchLog('allergy', 'action:load-allergy-records-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const ageY = Math.floor(ageMonths / 12), ageR = ageMonths % 12;
  const activeRecords = records.filter((r) => r.status === 'active');
  const otherRecords = records.filter((r) => r.status !== 'active');

  const toggleSymptom = (key: string) => setFormSymptoms((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleTreatment = (t: string) => setFormTreatments((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

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

  const sevColor = (s: string) => s === 'severe' ? '#dc2626' : s === 'moderate' ? '#d97706' : '#94A533';
  const statusBg = (s: string) => s === 'active' ? { background: '#fef2f2', color: '#dc2626' } : s === 'outgrown' ? { background: '#f0fdf4', color: '#16a34a' } : { background: '#f5f3ef', color: S.sub };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>过敏记录</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} hover:opacity-90`}
            style={{ background: S.accent }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            记录过敏
          </button>
        )}
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>

      <AISummaryCard domain="allergy" childName={child.displayName} childId={child.childId}
        ageLabel={`${ageY}岁${ageR}个月`} gender={child.gender}
        dataContext={activeRecords.length > 0 ? `活跃过敏原: ${activeRecords.map((r) => `${r.allergen}(${SEVERITY_LABELS[r.severity] ?? r.severity})`).join('、')}` : ''} />

      {/* ── Form ─────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
        <div className={`w-[480px] max-h-[85vh] overflow-y-auto flex flex-col ${S.radius} shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>

          {/* ── Header ── */}
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">🤧</span>
              <h2 className="text-[15px] font-bold" style={{ color: S.text }}>添加过敏记录</h2>
            </div>
            <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
          </div>

          <div className="px-6 pb-2 flex-1">

            {/* ━━ Section 1: Core ━━ */}
            <div className="space-y-3 pb-4">

              {/* Allergen */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>过敏原 <span style={{ color: '#dc2626' }}>*</span></p>
                <input value={formAllergen} onChange={(e) => setFormAllergen(e.target.value)} placeholder="输入过敏原名称"
                  className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`}
                  style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
              </div>

              {/* Quick-pick: top 6 visible, rest in expandable row */}
              <div className="flex flex-wrap gap-1.5">
                {COMMON_ALLERGENS.slice(0, 6).map((a) => (
                  <button key={a.label} onClick={() => { setFormAllergen(a.label); setFormCategory(a.category); }}
                    className={`px-2.5 py-1 text-[11px] rounded-full transition-all`}
                    style={formAllergen === a.label
                      ? { background: S.accent, color: '#fff' }
                      : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                    {a.label}
                  </button>
                ))}
                <button onClick={() => setShowMore(showMore === 'allergens' ? false : 'allergens')}
                  className="px-2.5 py-1 text-[11px] rounded-full transition-all"
                  style={{ border: `1px solid ${S.border}`, color: S.sub, background: showMore === 'allergens' ? '#f0f2ee' : '#fff' }}>
                  + 更多
                </button>
              </div>
              {showMore === 'allergens' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COMMON_ALLERGENS.slice(6).map((a) => (
                    <button key={a.label} onClick={() => { setFormAllergen(a.label); setFormCategory(a.category); }}
                      className="px-2.5 py-1 text-[11px] rounded-full transition-all"
                      style={formAllergen === a.label
                        ? { background: S.accent, color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Date + Severity side-by-side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>发生日期 <span style={{ color: '#dc2626' }}>*</span></p>
                  <ProfileDatePicker
                    value={formDiagnosedAt}
                    onChange={setFormDiagnosedAt}
                    style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }}
                  />
                </div>
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>严重程度 <span style={{ color: '#dc2626' }}>*</span></p>
                  <div className="flex gap-1.5">
                    {(['mild', 'moderate', 'severe'] as const).map((sv) => (
                      <button key={sv} onClick={() => setFormSeverity(formSeverity === sv ? '' : sv)}
                        className={`flex-1 py-2 text-[11px] font-medium ${S.radiusSm} transition-all`}
                        style={formSeverity === sv
                          ? { background: sevColor(sv), color: '#fff' }
                          : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                        {SEVERITY_LABELS[sv]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ━━ Section 2: Symptoms + Photo ━━ */}
            <div className="space-y-3 py-4" style={{ borderTop: `1px solid ${S.border}` }}>
              <p className="text-[11px] font-medium" style={{ color: S.sub }}>症状表现 <span className="font-normal">（可多选）</span></p>

              {/* Top 6 symptoms visible */}
              <div className="flex flex-wrap gap-1.5">
                {SYMPTOM_TAGS.slice(0, 6).map((t) => (
                  <button key={t.key} onClick={() => toggleSymptom(t.key)}
                    className={`px-2.5 py-1.5 text-[11px] ${S.radiusSm} transition-all`}
                    style={formSymptoms.has(t.key)
                      ? { background: S.accent, color: '#fff' }
                      : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                    {t.label}
                  </button>
                ))}
                <button onClick={() => setShowMore(showMore === 'symptoms' ? false : 'symptoms')}
                  className={`px-2.5 py-1.5 text-[11px] ${S.radiusSm} transition-all`}
                  style={{ border: `1px solid ${S.border}`, color: S.sub, background: showMore === 'symptoms' ? '#f0f2ee' : '#fff' }}>
                  + 更多症状
                </button>
              </div>
              {showMore === 'symptoms' && (
                <div className="flex flex-wrap gap-1.5">
                  {SYMPTOM_TAGS.slice(6).map((t) => (
                    <button key={t.key} onClick={() => toggleSymptom(t.key)}
                      className={`px-2.5 py-1.5 text-[11px] ${S.radiusSm} transition-all`}
                      style={formSymptoms.has(t.key)
                        ? { background: S.accent, color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                      {t.label}
                    </button>
                  ))}
                  <input value={formCustomSymptom} onChange={(e) => setFormCustomSymptom(e.target.value)}
                    placeholder="自定义症状..."
                    className={`px-2.5 py-1.5 text-[13px] ${S.radiusSm} outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 w-32`}
                    style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
                </div>
              )}

              {/* Photo — tight to symptoms */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>
                  现场照片 <span className="font-normal">（皮疹/红斑等，就医时极有帮助）</span>
                </p>
                {formPhotoName ? (
                  <div className={`flex items-center gap-2 px-4 py-2 w-full ${S.radiusSm} text-[12px] group`}
                    style={{ background: '#fff', color: S.text, border: `1px solid ${S.accent}` }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={S.accent} strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M3 8h2l2-3h10l2 3h2" />
                    </svg>
                    <span className="truncate flex-1">{formPhotoName}</span>
                    <button onClick={() => setFormPhotoName('')}
                      className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500"
                      style={{ color: S.sub }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
                    input.onchange = () => {
                      const files = input.files;
                      if (files && files.length > 0) setFormPhotoName(Array.from(files).map((f) => f.name).join(', '));
                    };
                    input.click();
                  }}
                    onMouseEnter={() => setPhotoHover(true)}
                    onMouseLeave={() => setPhotoHover(false)}
                    className={`w-full h-20 ${S.radiusSm} flex flex-col items-center justify-center gap-1.5 cursor-pointer`}
                    style={{
                      border: `2px dashed ${photoHover ? '#c8e64a' : '#d0d0cc'}`,
                      background: '#fafaf8',
                      transition: 'border-color 0.25s ease',
                    }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round"
                      style={{
                        stroke: photoHover ? '#94A533' : '#b0b0aa',
                        transform: photoHover ? 'scale(1.15)' : 'scale(1)',
                        transition: 'stroke 0.25s ease, transform 0.25s ease',
                      }}>
                      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M3 8h2l2-3h10l2 3h2" />
                    </svg>
                    <span className="text-[11px]" style={{
                      color: photoHover ? '#94A533' : '#a0a0a0',
                      transition: 'color 0.25s ease',
                    }}>点击拍照或选择照片</span>
                  </button>
                )}
              </div>
            </div>

            {/* ━━ Section 3: Medical details (collapsed) ━━ */}
            <div className="py-3" style={{ borderTop: `1px solid ${S.border}` }}>
              <button onClick={() => setShowMore(showMore === 'medical' ? false : 'medical')}
                className="flex items-center gap-1.5 text-[11px] font-medium w-full" style={{ color: S.sub }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  className={`transition-transform duration-200 ${showMore === 'medical' ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
                {showMore === 'medical' ? '收起医疗与后续信息' : '补充医疗与后续信息'}
              </button>

              {showMore === 'medical' && (
                <div className="mt-3 space-y-4">

                  {/* Treatment tags */}
                  <div>
                    <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>处理措施 <span className="font-normal">（可多选）</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {TREATMENT_TAGS.map((t) => (
                        <button key={t} onClick={() => toggleTreatment(t)}
                          className={`px-2.5 py-1.5 text-[11px] ${S.radiusSm} transition-all`}
                          style={formTreatments.has(t)
                            ? { background: S.accent, color: '#fff' }
                            : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                          {t}
                        </button>
                      ))}
                      <input value={formCustomTreatment} onChange={(e) => setFormCustomTreatment(e.target.value)}
                        placeholder="自定义..."
                        className={`px-2.5 py-1.5 text-[13px] ${S.radiusSm} outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 w-28`}
                        style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
                    </div>
                  </div>

                  {/* Category + Confirmed by + Status — unified grid */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>过敏类别</p>
                      <div className="flex flex-col gap-1">
                        {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                          <button key={k} onClick={() => setFormCategory(k)}
                            className={`px-2.5 py-1 text-[11px] ${S.radiusSm} text-left transition-all`}
                            style={formCategory === k
                              ? { background: S.accent, color: '#fff' }
                              : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>确认方式</p>
                      <div className="flex flex-col gap-1">
                        {Object.entries(CONFIRMED_LABELS).map(([k, l]) => (
                          <button key={k} onClick={() => setFormConfirmedBy(formConfirmedBy === k ? '' : k)}
                            className={`px-2.5 py-1 text-[11px] ${S.radiusSm} text-left transition-all`}
                            style={formConfirmedBy === k
                              ? { background: S.accent, color: '#fff' }
                              : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>当前状态</p>
                      <div className="flex flex-col gap-1">
                        {Object.entries(STATUS_LABELS).map(([k, l]) => (
                          <button key={k} onClick={() => setFormStatus(k)}
                            className={`px-2.5 py-1 text-[11px] ${S.radiusSm} text-left transition-all`}
                            style={formStatus === k
                              ? { background: S.accent, color: '#fff' }
                              : { border: `1px solid ${S.border}`, color: S.sub, background: '#fff' }}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>补充备注</p>
                    <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="其他需要记录的信息..."
                      className={`w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 resize-none`} rows={2}
                      style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 pt-3 pb-5">
            <div className="flex items-center justify-end gap-2">
              <button onClick={resetForm} className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={() => void handleSubmit()} disabled={!formAllergen.trim() || !formSeverity}
                className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} disabled:opacity-40 transition-colors hover:brightness-110`}
                style={{ background: S.accent }}>保存</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── Active allergies ─────────────────────────────── */}
      {activeRecords.length > 0 && (
        <div className="mb-5">
          <h2 className="text-[13px] font-semibold mb-3" style={{ color: S.text }}>
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
          <h2 className="text-[13px] font-semibold mb-3" style={{ color: S.sub }}>已脱敏 / 不确定（{otherRecords.length}）</h2>
          <div className="space-y-2">
            {otherRecords.map((r) => <AllergyCard key={r.recordId} record={r} />)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {records.length === 0 && !showForm && (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[28px]">🤧</span>
          <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有过敏记录</p>
          <p className="text-[11px] mt-1" style={{ color: S.sub }}>记录已知的过敏原，方便就医时快速参考</p>
        </div>
      )}
    </div>
  );
}

/* ── Allergy record card ─────────────────────────────────── */

function AllergyCard({ record: r, onMarkOutgrown }: { record: AllergyRecordRow; onMarkOutgrown?: () => void }) {
  const sevColor = r.severity === 'severe' ? '#dc2626' : r.severity === 'moderate' ? '#d97706' : '#94A533';
  const statusStyle = r.status === 'active' ? { background: '#fef2f2', color: '#dc2626' } : r.status === 'outgrown' ? { background: '#f0fdf4', color: '#16a34a' } : { background: '#f5f3ef', color: '#8a8f9a' };

  // Parse structured notes
  const symptoms = r.notes?.match(/症状: ([^|]+)/)?.[1];
  const treatments = r.notes?.match(/处理: ([^|]+)/)?.[1];
  const hasPhoto = r.notes?.includes('附照片:');

  return (
    <div className={`${S.radiusSm} p-4`}
      style={{ background: S.card, boxShadow: S.shadow, borderLeft: `3px solid ${sevColor}` }}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color: S.text }}>{r.allergen}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={statusStyle}>{STATUS_LABELS[r.status] ?? r.status}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: sevColor + '18', color: sevColor }}>{SEVERITY_LABELS[r.severity] ?? r.severity}</span>
            <span className="text-[10px]" style={{ color: '#b0b5bc' }}>{CATEGORY_LABELS[r.category] ?? r.category}</span>
            {hasPhoto && <span className="text-[10px]" title="有照片记录">📷</span>}
          </div>
          {symptoms && <p className="text-[11px] mt-1.5" style={{ color: S.sub }}>症状：{symptoms}</p>}
          {treatments && <p className="text-[11px] mt-0.5" style={{ color: S.sub }}>处理：{treatments}</p>}
          <p className="text-[10px] mt-1" style={{ color: '#c0bdb8' }}>
            {r.diagnosedAt && `${r.diagnosedAt.split('T')[0]}`}
            {r.confirmedBy && ` · ${CONFIRMED_LABELS[r.confirmedBy] ?? r.confirmedBy}`}
          </p>
        </div>
        {r.status === 'active' && onMarkOutgrown && (
          <button onClick={onMarkOutgrown}
            className={`shrink-0 px-3 py-1.5 text-[10px] font-medium ${S.radiusSm} transition-colors hover:bg-green-100`}
            style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
            标记脱敏
          </button>
        )}
      </div>
    </div>
  );
}
