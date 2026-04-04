import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertFitnessAssessment, getFitnessAssessments } from '../../bridge/sqlite-bridge.js';
import type { FitnessAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

const SOURCE_OPTIONS = ['school-pe', 'sports-club', 'clinic', 'self'] as const;
const SOURCE_LABELS: Record<string, string> = {
  'school-pe': '学校体育',
  'sports-club': '体育俱乐部',
  clinic: '医疗机构',
  self: '自测',
};

const FOOT_ARCH_OPTIONS = ['normal', 'flat', 'high-arch', 'monitoring'] as const;
const FOOT_ARCH_LABELS: Record<string, string> = {
  normal: '正常',
  flat: '扁平足',
  'high-arch': '高弓足',
  monitoring: '观察中',
};

const GRADE_OPTIONS = ['excellent', 'good', 'pass', 'fail'] as const;
const GRADE_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  pass: '及格',
  fail: '不及格',
};

function parseNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseIntNum(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export default function FitnessPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [assessments, setAssessments] = useState<FitnessAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formAssessedAt, setFormAssessedAt] = useState(new Date().toISOString().slice(0, 10));
  const [formSource, setFormSource] = useState('school-pe');
  const [formRun50m, setFormRun50m] = useState('');
  const [formRun800m, setFormRun800m] = useState('');
  const [formRun1000m, setFormRun1000m] = useState('');
  const [formSitAndReach, setFormSitAndReach] = useState('');
  const [formStandingLongJump, setFormStandingLongJump] = useState('');
  const [formSitUps, setFormSitUps] = useState('');
  const [formPullUps, setFormPullUps] = useState('');
  const [formRopeSkipping, setFormRopeSkipping] = useState('');
  const [formVitalCapacity, setFormVitalCapacity] = useState('');
  const [formFootArch, setFormFootArch] = useState('');
  const [formGrade, setFormGrade] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getFitnessAssessments(activeChildId).then(setAssessments).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const isFemale = child.gender === 'female';
  const sortedAssessments = [...assessments].sort(
    (a, b) => new Date(b.assessedAt).getTime() - new Date(a.assessedAt).getTime(),
  );

  const resetForm = () => {
    setFormAssessedAt(new Date().toISOString().slice(0, 10));
    setFormSource('school-pe');
    setFormRun50m('');
    setFormRun800m('');
    setFormRun1000m('');
    setFormSitAndReach('');
    setFormStandingLongJump('');
    setFormSitUps('');
    setFormPullUps('');
    setFormRopeSkipping('');
    setFormVitalCapacity('');
    setFormFootArch('');
    setFormGrade('');
    setFormNotes('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formAssessedAt) return;
    const now = isoNow();
    try {
      await insertFitnessAssessment({
        assessmentId: ulid(),
        childId: child.childId,
        assessedAt: formAssessedAt,
        ageMonths: computeAgeMonthsAt(child.birthDate, formAssessedAt),
        assessmentSource: formSource || null,
        run50m: parseNum(formRun50m),
        run800m: parseNum(formRun800m),
        run1000m: parseNum(formRun1000m),
        sitAndReach: parseNum(formSitAndReach),
        standingLongJump: parseNum(formStandingLongJump),
        sitUps: parseIntNum(formSitUps),
        pullUps: parseIntNum(formPullUps),
        ropeSkipping: parseIntNum(formRopeSkipping),
        vitalCapacity: parseIntNum(formVitalCapacity),
        footArchStatus: formFootArch || null,
        overallGrade: formGrade || null,
        notes: formNotes || null,
        now,
      });
      const updated = await getFitnessAssessments(child.childId);
      setAssessments(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  /** Render metric row in assessment card if value exists */
  const metric = (label: string, value: number | null, unit: string) =>
    value != null ? (
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500">{label}:</span>
        <span className="text-sm font-medium">{value}{unit}</span>
      </div>
    ) : null;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">体能评估</h1>
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
          <h2 className="text-lg font-semibold mb-3">新增体能评估</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap items-end">
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                评估日期
                <input type="date" value={formAssessedAt} onChange={(e) => setFormAssessedAt(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                来源
                <select value={formSource} onChange={(e) => setFormSource(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  {SOURCE_OPTIONS.map((v) => (
                    <option key={v} value={v}>{SOURCE_LABELS[v]}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Speed */}
            <div>
              <p className="text-xs text-gray-400 mb-1">速度</p>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  50米跑 (秒)
                  <input type="number" step="0.1" min="0" placeholder="--" value={formRun50m} onChange={(e) => setFormRun50m(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                </label>
                {isFemale ? (
                  <label className="text-xs text-gray-500 flex flex-col gap-1">
                    800米跑 (秒)
                    <input type="number" step="1" min="0" placeholder="--" value={formRun800m} onChange={(e) => setFormRun800m(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                  </label>
                ) : (
                  <label className="text-xs text-gray-500 flex flex-col gap-1">
                    1000米跑 (秒)
                    <input type="number" step="1" min="0" placeholder="--" value={formRun1000m} onChange={(e) => setFormRun1000m(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                  </label>
                )}
              </div>
            </div>

            {/* Flexibility & Power */}
            <div>
              <p className="text-xs text-gray-400 mb-1">柔韧 & 力量</p>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  坐位体前屈 (cm)
                  <input type="number" step="0.1" placeholder="--" value={formSitAndReach} onChange={(e) => setFormSitAndReach(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                </label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  立定跳远 (cm)
                  <input type="number" step="1" min="0" placeholder="--" value={formStandingLongJump} onChange={(e) => setFormStandingLongJump(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                </label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  仰卧起坐 (次/分)
                  <input type="number" step="1" min="0" placeholder="--" value={formSitUps} onChange={(e) => setFormSitUps(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                </label>
                {!isFemale && (
                  <label className="text-xs text-gray-500 flex flex-col gap-1">
                    引体向上 (次)
                    <input type="number" step="1" min="0" placeholder="--" value={formPullUps} onChange={(e) => setFormPullUps(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                  </label>
                )}
              </div>
            </div>

            {/* Coordination & Cardio */}
            <div>
              <p className="text-xs text-gray-400 mb-1">协调 & 心肺</p>
              <div className="flex gap-2 flex-wrap items-end">
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  跳绳 (次/分)
                  <input type="number" step="1" min="0" placeholder="--" value={formRopeSkipping} onChange={(e) => setFormRopeSkipping(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-24" />
                </label>
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  肺活量 (mL)
                  <input type="number" step="1" min="0" placeholder="--" value={formVitalCapacity} onChange={(e) => setFormVitalCapacity(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-28" />
                </label>
              </div>
            </div>

            {/* Foot & Grade */}
            <div className="flex gap-2 flex-wrap items-end">
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                足弓状态
                <select value={formFootArch} onChange={(e) => setFormFootArch(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  <option value="">可选</option>
                  {FOOT_ARCH_OPTIONS.map((v) => (
                    <option key={v} value={v}>{FOOT_ARCH_LABELS[v]}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                综合等级
                <select value={formGrade} onChange={(e) => setFormGrade(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  <option value="">可选</option>
                  {GRADE_OPTIONS.map((v) => (
                    <option key={v} value={v}>{GRADE_LABELS[v]}</option>
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

      {/* Assessment Cards */}
      <section>
        {sortedAssessments.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无体能评估</p>
        ) : (
          <div className="space-y-3">
            {sortedAssessments.map((a) => (
              <div key={a.assessmentId} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{a.assessedAt.split('T')[0]}</span>
                    <span className="text-xs text-gray-400">{a.ageMonths} 月龄</span>
                    {a.assessmentSource && (
                      <span className="text-xs text-gray-400">{SOURCE_LABELS[a.assessmentSource] ?? a.assessmentSource}</span>
                    )}
                  </div>
                  {a.overallGrade && (
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${a.overallGrade === 'excellent' ? 'bg-green-100 text-green-700' : a.overallGrade === 'good' ? 'bg-blue-100 text-blue-700' : a.overallGrade === 'pass' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {GRADE_LABELS[a.overallGrade] ?? a.overallGrade}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {metric('50米跑', a.run50m, 's')}
                  {metric('800米跑', a.run800m, 's')}
                  {metric('1000米跑', a.run1000m, 's')}
                  {metric('坐位体前屈', a.sitAndReach, 'cm')}
                  {metric('立定跳远', a.standingLongJump, 'cm')}
                  {metric('仰卧起坐', a.sitUps, '次/分')}
                  {metric('引体向上', a.pullUps, '次')}
                  {metric('跳绳', a.ropeSkipping, '次/分')}
                  {metric('肺活量', a.vitalCapacity, 'mL')}
                  {a.footArchStatus && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">足弓:</span>
                      <span className="text-sm font-medium">{FOOT_ARCH_LABELS[a.footArchStatus] ?? a.footArchStatus}</span>
                    </div>
                  )}
                </div>
                {a.notes && <p className="text-xs text-gray-400 mt-2">{a.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
