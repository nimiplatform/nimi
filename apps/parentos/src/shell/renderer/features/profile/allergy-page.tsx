import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertAllergyRecord, updateAllergyRecord, getAllergyRecords, upsertReminderState } from '../../bridge/sqlite-bridge.js';
import type { AllergyRecordRow } from '../../bridge/sqlite-bridge.js';
import { generateAllergyFollowups } from '../../engine/smart-alerts.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';

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
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<AllergyRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showMore, setShowMore] = useState(false); // toggle optional fields

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
    if (activeChildId) getAllergyRecords(activeChildId).then(setRecords).catch(() => {});
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
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header with child identity */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ background: '#86AFDA' }}>
            {child.displayName.charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: S.text }}>过敏记录</h1>
            <p className="text-[11px]" style={{ color: S.sub }}>{child.displayName} · {ageY > 0 ? `${ageY}岁` : ''}{ageR > 0 ? `${ageR}个月` : ''}</p>
          </div>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} hover:opacity-90`}
            style={{ background: S.accent }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            记录过敏
          </button>
        )}
      </div>

      <AISummaryCard domain="allergy" childName={child.displayName} childId={child.childId}
        ageLabel={`${ageY}岁${ageR}个月`} gender={child.gender}
        dataContext={activeRecords.length > 0 ? `活跃过敏原: ${activeRecords.map((r) => `${r.allergen}(${SEVERITY_LABELS[r.severity] ?? r.severity})`).join('、')}` : ''} />

      {/* ── Form ─────────────────────────────────────────── */}
      {showForm && (
        <div className={`${S.radius} mb-5 overflow-hidden`} style={{ background: S.card, boxShadow: S.shadow }}>
          {/* Core section — visually distinct */}
          <div className="p-5" style={{ borderBottom: `1px solid ${S.border}` }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>记录过敏反应</h2>
              <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
            </div>

            {/* Allergen input + quick tags */}
            <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.text }}>过敏原 <span style={{ color: '#dc2626' }}>*</span></p>
            <input value={formAllergen} onChange={(e) => setFormAllergen(e.target.value)} placeholder="输入过敏原名称"
              className={`w-full ${S.radiusSm} px-3 py-2.5 text-[13px] border-0 outline-none mb-2`} style={{ background: '#f5f3ef', color: S.text }} />
            <div className="flex flex-wrap gap-1 mb-4">
              {COMMON_ALLERGENS.map((a) => (
                <button key={a.label} onClick={() => { setFormAllergen(a.label); setFormCategory(a.category); }}
                  className={`px-2 py-1 text-[10px] rounded-full transition-all ${formAllergen === a.label ? 'text-white' : 'hover:bg-[#e8e5e0]'}`}
                  style={formAllergen === a.label ? { background: S.accent, color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                  {a.label}
                </button>
              ))}
            </div>

            {/* Date + Severity — core fields */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.text }}>发生日期 <span style={{ color: '#dc2626' }}>*</span></p>
                <input type="date" value={formDiagnosedAt} onChange={(e) => setFormDiagnosedAt(e.target.value)}
                  className={`w-full ${S.radiusSm} px-3 py-2.5 text-[13px] border-0 outline-none`} style={{ background: '#f5f3ef', color: S.text }} />
              </div>
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.text }}>严重程度 <span style={{ color: '#dc2626' }}>*</span></p>
                <div className="flex gap-1.5">
                  {(['mild', 'moderate', 'severe'] as const).map((sv) => (
                    <button key={sv} onClick={() => setFormSeverity(formSeverity === sv ? '' : sv)}
                      className={`flex-1 py-2.5 text-[11px] font-medium ${S.radiusSm} transition-all`}
                      style={formSeverity === sv ? { background: sevColor(sv), color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                      {SEVERITY_LABELS[sv]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Symptom tags — multi-select */}
            <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.text }}>症状表现 <span className="font-normal" style={{ color: S.sub }}>（可多选）</span></p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {SYMPTOM_TAGS.map((t) => (
                <button key={t.key} onClick={() => toggleSymptom(t.key)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-[10px] ${S.radiusSm} transition-all`}
                  style={formSymptoms.has(t.key) ? { background: S.accent, color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                  <span>{t.emoji}</span> {t.label}
                </button>
              ))}
              <input value={formCustomSymptom} onChange={(e) => setFormCustomSymptom(e.target.value)}
                placeholder="其它症状..."
                className={`px-2.5 py-1.5 text-[10px] ${S.radiusSm} border-0 outline-none w-28`}
                style={{ background: '#f5f3ef', color: S.text }} />
            </div>
          </div>

          {/* Optional section — collapsible */}
          <div className="px-5 py-3" style={{ background: '#fafcfb' }}>
            <button onClick={() => setShowMore(!showMore)} className="flex items-center gap-1.5 text-[11px] font-medium w-full" style={{ color: S.sub }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                className={`transition-transform ${showMore ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
              {showMore ? '收起详细信息' : '补充详细信息（处理措施、照片、确认方式...）'}
            </button>

            {showMore && (
              <div className="mt-3 space-y-4">
                {/* Treatment tags */}
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.text }}>处理措施 <span className="font-normal" style={{ color: S.sub }}>（可多选）</span></p>
                  <div className="flex flex-wrap gap-1.5">
                    {TREATMENT_TAGS.map((t) => (
                      <button key={t} onClick={() => toggleTreatment(t)}
                        className={`px-2.5 py-1.5 text-[10px] ${S.radiusSm} transition-all`}
                        style={formTreatments.has(t) ? { background: '#86AFDA', color: '#fff' } : { background: '#fff', border: `1px solid ${S.border}`, color: S.sub }}>
                        {t}
                      </button>
                    ))}
                    <input value={formCustomTreatment} onChange={(e) => setFormCustomTreatment(e.target.value)}
                      placeholder="其它措施..."
                      className={`px-2.5 py-1.5 text-[10px] ${S.radiusSm} border-0 outline-none w-28`}
                      style={{ background: '#f5f3ef', color: S.text }} />
                  </div>
                </div>

                {/* Photo upload */}
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.text }}>
                    上传照片 <span className="font-normal" style={{ color: S.sub }}>（皮疹/红斑等现场照片，就医时极为重要）</span>
                  </p>
                  <button onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
                    input.onchange = () => {
                      const files = input.files;
                      if (files && files.length > 0) setFormPhotoName(Array.from(files).map((f) => f.name).join(', '));
                    };
                    input.click();
                  }}
                    className={`flex items-center gap-2 px-4 py-2.5 w-full ${S.radiusSm} transition-colors hover:bg-[#e8e5e0]`}
                    style={{ background: '#f5f3ef', color: S.sub, border: `1px dashed ${S.border}` }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M3 8h2l2-3h10l2 3h2" />
                    </svg>
                    {formPhotoName || '点击拍照或选择照片'}
                  </button>
                </div>

                {/* Category + Confirmed by + Status */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] mb-1" style={{ color: S.sub }}>过敏类别</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
                        <button key={k} onClick={() => setFormCategory(k)}
                          className={`px-2 py-1 text-[10px] rounded-full`}
                          style={formCategory === k ? { background: S.accent, color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] mb-1" style={{ color: S.sub }}>确认方式</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(CONFIRMED_LABELS).map(([k, l]) => (
                        <button key={k} onClick={() => setFormConfirmedBy(formConfirmedBy === k ? '' : k)}
                          className={`px-2 py-1 text-[10px] rounded-full`}
                          style={formConfirmedBy === k ? { background: '#86AFDA', color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] mb-1" style={{ color: S.sub }}>当前状态</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(STATUS_LABELS).map(([k, l]) => (
                        <button key={k} onClick={() => setFormStatus(k)}
                          className={`px-2 py-1 text-[10px] rounded-full`}
                          style={formStatus === k ? { background: S.accent, color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <p className="text-[11px] mb-1" style={{ color: S.sub }}>补充备注</p>
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="其他需要记录的信息..."
                    className={`w-full ${S.radiusSm} px-3 py-2 text-[12px] border-0 outline-none resize-none`} rows={2}
                    style={{ background: '#fff', border: `1px solid ${S.border}`, color: S.text }} />
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between px-5 py-3.5" style={{ borderTop: `1px solid ${S.border}` }}>
            <p className="text-[10px]" style={{ color: S.sub }}>
              {!formAllergen.trim() && '请填写过敏原'}
              {formAllergen.trim() && !formSeverity && '请选择严重程度'}
              {formAllergen.trim() && formSeverity && `${formSymptoms.size} 项症状 · ${formTreatments.size} 项处理`}
            </p>
            <div className="flex gap-2">
              <button onClick={resetForm} className={`px-4 py-2 text-[12px] ${S.radiusSm}`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={() => void handleSubmit()} disabled={!formAllergen.trim() || !formSeverity}
                className={`px-5 py-2 text-[12px] font-medium text-white ${S.radiusSm} disabled:opacity-40 hover:opacity-90`}
                style={{ background: S.accent }}>保存</button>
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
