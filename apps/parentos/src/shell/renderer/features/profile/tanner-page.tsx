import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertTannerAssessment, getTannerAssessments } from '../../bridge/sqlite-bridge.js';
import type { TannerAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

const ASSESSED_BY_OPTIONS = ['self', 'parent', 'physician'] as const;
const ASSESSED_BY_LABELS: Record<string, string> = {
  self: '自评',
  parent: '家长评估',
  physician: '医生评估',
};

export default function TannerPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [assessments, setAssessments] = useState<TannerAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formAssessedAt, setFormAssessedAt] = useState(new Date().toISOString().slice(0, 10));
  const [formBreastOrGenital, setFormBreastOrGenital] = useState('1');
  const [formPubicHair, setFormPubicHair] = useState('1');
  const [formAssessedBy, setFormAssessedBy] = useState('parent');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getTannerAssessments(activeChildId).then(setAssessments).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const isFemale = child.gender === 'female';
  const bgLabel = isFemale ? '乳房发育 (B期)' : '外生殖器发育 (G期)';

  const sortedAssessments = [...assessments].sort(
    (a, b) => new Date(b.assessedAt).getTime() - new Date(a.assessedAt).getTime(),
  );

  const resetForm = () => {
    setFormAssessedAt(new Date().toISOString().slice(0, 10));
    setFormBreastOrGenital('1');
    setFormPubicHair('1');
    setFormAssessedBy('parent');
    setFormNotes('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formAssessedAt) return;
    const now = isoNow();
    const bgStage = parseInt(formBreastOrGenital, 10);
    const phStage = parseInt(formPubicHair, 10);
    if (bgStage < 1 || bgStage > 5 || phStage < 1 || phStage > 5) return;
    try {
      await insertTannerAssessment({
        assessmentId: ulid(),
        childId: child.childId,
        assessedAt: formAssessedAt,
        ageMonths: computeAgeMonthsAt(child.birthDate, formAssessedAt),
        breastOrGenitalStage: bgStage,
        pubicHairStage: phStage,
        assessedBy: formAssessedBy || null,
        notes: formNotes || null,
        now,
      });
      const updated = await getTannerAssessments(child.childId);
      setAssessments(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Tanner 发育评估</h1>
          <p className="text-sm text-gray-500">共 {assessments.length} 次评估</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            添加评估
          </button>
        )}
      </div>

      {/* Add Form */}
      {showForm && (
        <section className="mb-8 border rounded-lg p-4 bg-gray-50">
          <h2 className="text-lg font-semibold mb-3">新增评估</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-end">
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                评估日期
                <input type="date" value={formAssessedAt} onChange={(e) => setFormAssessedAt(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                评估人
                <select value={formAssessedBy} onChange={(e) => setFormAssessedBy(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  {ASSESSED_BY_OPTIONS.map((v) => (
                    <option key={v} value={v}>{ASSESSED_BY_LABELS[v]}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-4 flex-wrap items-end">
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                {bgLabel}
                <select value={formBreastOrGenital} onChange={(e) => setFormBreastOrGenital(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} 期</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                阴毛发育 (PH期)
                <select value={formPubicHair} onChange={(e) => setFormPubicHair(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} 期</option>
                  ))}
                </select>
              </label>
            </div>
            <input placeholder="备注" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-full" />
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">保存</button>
              <button onClick={resetForm} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md">取消</button>
            </div>
          </div>
        </section>
      )}

      {/* Assessment Timeline */}
      <section>
        {sortedAssessments.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无评估记录</p>
        ) : (
          <div className="space-y-2">
            {sortedAssessments.map((a) => (
              <div key={a.assessmentId} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{a.assessedAt.split('T')[0]}</span>
                      <span className="text-xs text-gray-400">{a.ageMonths} 月龄</span>
                      {a.assessedBy && (
                        <span className="text-xs text-gray-400">{ASSESSED_BY_LABELS[a.assessedBy] ?? a.assessedBy}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">{bgLabel}:</span>
                        <span className="text-sm font-semibold text-indigo-600">{a.breastOrGenitalStage ?? '-'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">阴毛 (PH):</span>
                        <span className="text-sm font-semibold text-indigo-600">{a.pubicHairStage ?? '-'}</span>
                      </div>
                    </div>
                    {a.notes && <p className="text-xs text-gray-400 mt-1">{a.notes}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
