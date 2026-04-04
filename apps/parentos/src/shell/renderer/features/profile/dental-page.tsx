import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertDentalRecord, getDentalRecords } from '../../bridge/sqlite-bridge.js';
import type { DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

const EVENT_TYPE_LABELS: Record<string, string> = {
  eruption: '萌出',
  loss: '脱落',
  caries: '龋齿',
  cleaning: '洁牙',
  'ortho-assessment': '正畸评估',
};

const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
const TOOTH_SET_OPTIONS = ['primary', 'permanent'] as const;

export default function DentalPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<DentalRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formEventType, setFormEventType] = useState('eruption');
  const [formToothId, setFormToothId] = useState('');
  const [formToothSet, setFormToothSet] = useState('primary');
  const [formEventDate, setFormEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [formSeverity, setFormSeverity] = useState('');
  const [formHospital, setFormHospital] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getDentalRecords(activeChildId).then(setRecords).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const sortedRecords = [...records].sort(
    (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime(),
  );

  const resetForm = () => {
    setFormEventType('eruption');
    setFormToothId('');
    setFormToothSet('primary');
    setFormEventDate(new Date().toISOString().slice(0, 10));
    setFormSeverity('');
    setFormHospital('');
    setFormNotes('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formEventDate) return;
    const now = isoNow();
    try {
      await insertDentalRecord({
        recordId: ulid(),
        childId: child.childId,
        eventType: formEventType,
        toothId: formToothId || null,
        toothSet: formToothSet || null,
        eventDate: formEventDate,
        ageMonths: computeAgeMonthsAt(child.birthDate, formEventDate),
        severity: formSeverity || null,
        hospital: formHospital || null,
        notes: formNotes || null,
        photoPath: null,
        now,
      });
      const updated = await getDentalRecords(child.childId);
      setRecords(updated);
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
          <h1 className="text-2xl font-bold mb-1">牙齿记录</h1>
          <p className="text-sm text-gray-500">共 {records.length} 条记录</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            添加记录
          </button>
        )}
      </div>

      {/* Add Form */}
      {showForm && (
        <section className="mb-8 border rounded-lg p-4 bg-gray-50">
          <h2 className="text-lg font-semibold mb-3">新增牙齿事件</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select value={formEventType} onChange={(e) => setFormEventType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                {Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <input placeholder="牙位 (FDI, 如 11)" value={formToothId} onChange={(e) => setFormToothId(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-32" />
              <select value={formToothSet} onChange={(e) => setFormToothSet(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                {TOOTH_SET_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v === 'primary' ? '乳牙' : '恒牙'}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 flex-wrap">
              <input type="date" value={formEventDate} onChange={(e) => setFormEventDate(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
              <select value={formSeverity} onChange={(e) => setFormSeverity(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                <option value="">严重程度（可选）</option>
                {SEVERITY_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v === 'mild' ? '轻度' : v === 'moderate' ? '中度' : '重度'}</option>
                ))}
              </select>
              <input placeholder="医院/诊所" value={formHospital} onChange={(e) => setFormHospital(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm flex-1" />
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
        {sortedRecords.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无牙齿记录</p>
        ) : (
          <div className="space-y-2">
            {sortedRecords.map((r) => (
              <div key={r.recordId} className="border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{EVENT_TYPE_LABELS[r.eventType] ?? r.eventType}</span>
                  {r.toothId && <span className="text-xs text-gray-500">牙位 {r.toothId}</span>}
                  {r.toothSet && <span className="text-xs text-gray-400">({r.toothSet === 'primary' ? '乳牙' : '恒牙'})</span>}
                  {r.severity && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${r.severity === 'severe' ? 'bg-red-100 text-red-700' : r.severity === 'moderate' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {r.severity === 'mild' ? '轻度' : r.severity === 'moderate' ? '中度' : '重度'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {r.eventDate.split('T')[0]} · {r.ageMonths} 月龄
                  {r.hospital && ` · ${r.hospital}`}
                </p>
                {r.notes && <p className="text-xs text-gray-400 mt-1">{r.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
