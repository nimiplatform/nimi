import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertAllergyRecord, updateAllergyRecord, getAllergyRecords } from '../../bridge/sqlite-bridge.js';
import type { AllergyRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

const CATEGORY_LABELS: Record<string, string> = {
  food: '食物',
  drug: '药物',
  environmental: '环境',
  contact: '接触',
  other: '其他',
};

const REACTION_TYPES = ['skin', 'respiratory', 'gastrointestinal', 'anaphylaxis', 'other'] as const;
const REACTION_LABELS: Record<string, string> = {
  skin: '皮肤反应',
  respiratory: '呼吸系统',
  gastrointestinal: '消化系统',
  anaphylaxis: '过敏性休克',
  other: '其他',
};

const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
const STATUS_OPTIONS = ['active', 'outgrown', 'uncertain'] as const;
const STATUS_LABELS: Record<string, string> = { active: '活跃', outgrown: '已脱敏', uncertain: '不确定' };
const CONFIRMED_BY_OPTIONS = ['clinical-test', 'physician-diagnosis', 'parent-observation'] as const;
const CONFIRMED_BY_LABELS: Record<string, string> = {
  'clinical-test': '临床检测',
  'physician-diagnosis': '医生诊断',
  'parent-observation': '家长观察',
};

export default function AllergyPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<AllergyRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formAllergen, setFormAllergen] = useState('');
  const [formCategory, setFormCategory] = useState('food');
  const [formReactionType, setFormReactionType] = useState('');
  const [formSeverity, setFormSeverity] = useState('mild');
  const [formStatus, setFormStatus] = useState('active');
  const [formDiagnosedAt, setFormDiagnosedAt] = useState(new Date().toISOString().slice(0, 10));
  const [formConfirmedBy, setFormConfirmedBy] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getAllergyRecords(activeChildId).then(setRecords).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const resetForm = () => {
    setFormAllergen('');
    setFormCategory('food');
    setFormReactionType('');
    setFormSeverity('mild');
    setFormStatus('active');
    setFormDiagnosedAt(new Date().toISOString().slice(0, 10));
    setFormConfirmedBy('');
    setFormNotes('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formAllergen.trim()) return;
    const now = isoNow();
    try {
      await insertAllergyRecord({
        recordId: ulid(),
        childId: child.childId,
        allergen: formAllergen.trim(),
        category: formCategory,
        reactionType: formReactionType || null,
        severity: formSeverity,
        diagnosedAt: formDiagnosedAt || null,
        ageMonthsAtDiagnosis: formDiagnosedAt ? computeAgeMonthsAt(child.birthDate, formDiagnosedAt) : null,
        status: formStatus,
        statusChangedAt: now,
        confirmedBy: formConfirmedBy || null,
        notes: formNotes || null,
        now,
      });
      const updated = await getAllergyRecords(child.childId);
      setRecords(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  const handleMarkOutgrown = async (record: AllergyRecordRow) => {
    const now = isoNow();
    try {
      await updateAllergyRecord({
        recordId: record.recordId,
        allergen: record.allergen,
        category: record.category,
        reactionType: record.reactionType,
        severity: record.severity,
        status: 'outgrown',
        statusChangedAt: now,
        confirmedBy: record.confirmedBy,
        notes: record.notes,
        now,
      });
      const updated = await getAllergyRecords(child.childId);
      setRecords(updated);
    } catch { /* bridge unavailable */ }
  };

  const statusBadge = (status: string) => {
    if (status === 'active') return 'bg-red-100 text-red-700';
    if (status === 'outgrown') return 'bg-green-100 text-green-700';
    return 'bg-gray-100 text-gray-500';
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">过敏记录</h1>
          <p className="text-sm text-gray-500">共 {records.length} 条记录</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            添加过敏原
          </button>
        )}
      </div>

      {/* Add Form */}
      {showForm && (
        <section className="mb-8 border rounded-lg p-4 bg-gray-50">
          <h2 className="text-lg font-semibold mb-3">新增过敏记录</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <input placeholder="过敏原名称" value={formAllergen} onChange={(e) => setFormAllergen(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm flex-1 min-w-40" />
              <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 flex-wrap">
              <select value={formReactionType} onChange={(e) => setFormReactionType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                <option value="">反应类型（可选）</option>
                {REACTION_TYPES.map((v) => (
                  <option key={v} value={v}>{REACTION_LABELS[v]}</option>
                ))}
              </select>
              <select value={formSeverity} onChange={(e) => setFormSeverity(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                {SEVERITY_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v === 'mild' ? '轻度' : v === 'moderate' ? '中度' : '重度'}</option>
                ))}
              </select>
              <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                {STATUS_OPTIONS.map((v) => (
                  <option key={v} value={v}>{STATUS_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 flex-wrap">
              <input type="date" value={formDiagnosedAt} onChange={(e) => setFormDiagnosedAt(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
              <select value={formConfirmedBy} onChange={(e) => setFormConfirmedBy(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                <option value="">确认方式（可选）</option>
                {CONFIRMED_BY_OPTIONS.map((v) => (
                  <option key={v} value={v}>{CONFIRMED_BY_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <input placeholder="备注" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-full" />
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">保存</button>
              <button onClick={resetForm} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md">取消</button>
            </div>
          </div>
        </section>
      )}

      {/* Records List */}
      <section>
        {records.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无过敏记录</p>
        ) : (
          <div className="space-y-2">
            {records.map((r) => (
              <div key={r.recordId} className="border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{r.allergen}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge(r.status)}`}>
                        {STATUS_LABELS[r.status] ?? r.status}
                      </span>
                      <span className="text-xs text-gray-400">{CATEGORY_LABELS[r.category] ?? r.category}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {r.reactionType && `${REACTION_LABELS[r.reactionType] ?? r.reactionType} · `}
                      {r.severity === 'mild' ? '轻度' : r.severity === 'moderate' ? '中度' : '重度'}
                      {r.diagnosedAt && ` · 诊断于 ${r.diagnosedAt.split('T')[0]}`}
                      {r.confirmedBy && ` · ${CONFIRMED_BY_LABELS[r.confirmedBy] ?? r.confirmedBy}`}
                    </p>
                    {r.notes && <p className="text-xs text-gray-400 mt-1">{r.notes}</p>}
                  </div>
                  {r.status === 'active' && (
                    <button onClick={() => handleMarkOutgrown(r)} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100 shrink-0">
                      标记脱敏
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
