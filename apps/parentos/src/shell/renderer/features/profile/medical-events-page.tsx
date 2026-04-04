import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { insertMedicalEvent, getMedicalEvents } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

const EVENT_TYPE_LABELS: Record<string, string> = {
  injury: '外伤',
  fracture: '骨折',
  surgery: '手术',
  'skin-condition': '皮肤问题',
  medication: '用药',
  'hearing-screening': '听力筛查',
  other: '其他',
};

const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
const RESULT_OPTIONS = ['pass', 'refer', 'fail'] as const;
const RESULT_LABELS: Record<string, string> = { pass: '通过', refer: '转诊', fail: '未通过' };

export default function MedicalEventsPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [events, setEvents] = useState<MedicalEventRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formEventType, setFormEventType] = useState('injury');
  const [formTitle, setFormTitle] = useState('');
  const [formEventDate, setFormEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState('');
  const [formSeverity, setFormSeverity] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formHospital, setFormHospital] = useState('');
  const [formMedication, setFormMedication] = useState('');
  const [formDosage, setFormDosage] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getMedicalEvents(activeChildId).then(setEvents).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime(),
  );

  const resetForm = () => {
    setFormEventType('injury');
    setFormTitle('');
    setFormEventDate(new Date().toISOString().slice(0, 10));
    setFormEndDate('');
    setFormSeverity('');
    setFormResult('');
    setFormHospital('');
    setFormMedication('');
    setFormDosage('');
    setFormNotes('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formTitle.trim() || !formEventDate) return;
    const now = isoNow();
    try {
      await insertMedicalEvent({
        eventId: ulid(),
        childId: child.childId,
        eventType: formEventType,
        title: formTitle.trim(),
        eventDate: formEventDate,
        endDate: formEndDate || null,
        ageMonths: computeAgeMonthsAt(child.birthDate, formEventDate),
        severity: formSeverity || null,
        result: formResult || null,
        hospital: formHospital || null,
        medication: formMedication || null,
        dosage: formDosage || null,
        notes: formNotes || null,
        photoPath: null,
        now,
      });
      const updated = await getMedicalEvents(child.childId);
      setEvents(updated);
      resetForm();
    } catch { /* bridge unavailable */ }
  };

  const isScreening = formEventType === 'hearing-screening';

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">医疗事件</h1>
          <p className="text-sm text-gray-500">共 {events.length} 条记录</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            添加事件
          </button>
        )}
      </div>

      {/* Add Form */}
      {showForm && (
        <section className="mb-8 border rounded-lg p-4 bg-gray-50">
          <h2 className="text-lg font-semibold mb-3">新增医疗事件</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select value={formEventType} onChange={(e) => setFormEventType(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                {Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <input placeholder="事件标题" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm flex-1 min-w-40" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                发生日期
                <input type="date" value={formEventDate} onChange={(e) => setFormEventDate(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                结束日期（可选）
                <input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-gray-500 flex flex-col gap-1">
                严重程度
                <select value={formSeverity} onChange={(e) => setFormSeverity(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                  <option value="">可选</option>
                  {SEVERITY_OPTIONS.map((v) => (
                    <option key={v} value={v}>{v === 'mild' ? '轻度' : v === 'moderate' ? '中度' : '重度'}</option>
                  ))}
                </select>
              </label>
            </div>
            {isScreening && (
              <div className="flex gap-2">
                <label className="text-xs text-gray-500 flex flex-col gap-1">
                  筛查结果
                  <select value={formResult} onChange={(e) => setFormResult(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm">
                    <option value="">可选</option>
                    {RESULT_OPTIONS.map((v) => (
                      <option key={v} value={v}>{RESULT_LABELS[v]}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <input placeholder="医院/诊所" value={formHospital} onChange={(e) => setFormHospital(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm flex-1" />
              <input placeholder="用药名称" value={formMedication} onChange={(e) => setFormMedication(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm flex-1" />
              <input placeholder="剂量" value={formDosage} onChange={(e) => setFormDosage(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-28" />
            </div>
            <input placeholder="备注" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="border rounded-md px-2 py-1.5 text-sm w-full" />
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">保存</button>
              <button onClick={resetForm} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md">取消</button>
            </div>
          </div>
        </section>
      )}

      {/* Events List */}
      <section>
        {sortedEvents.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无医疗事件</p>
        ) : (
          <div className="space-y-2">
            {sortedEvents.map((ev) => (
              <div key={ev.eventId} className="border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                    {EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
                  </span>
                  <span className="text-sm font-medium">{ev.title}</span>
                  {ev.severity && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${ev.severity === 'severe' ? 'bg-red-100 text-red-700' : ev.severity === 'moderate' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                      {ev.severity === 'mild' ? '轻度' : ev.severity === 'moderate' ? '中度' : '重度'}
                    </span>
                  )}
                  {ev.result && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${ev.result === 'pass' ? 'bg-green-100 text-green-700' : ev.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {RESULT_LABELS[ev.result] ?? ev.result}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {ev.eventDate.split('T')[0]}
                  {ev.endDate && ` - ${ev.endDate.split('T')[0]}`}
                  {` · ${ev.ageMonths} 月龄`}
                  {ev.hospital && ` · ${ev.hospital}`}
                </p>
                {(ev.medication || ev.dosage) && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {ev.medication && `用药: ${ev.medication}`}
                    {ev.dosage && ` · 剂量: ${ev.dosage}`}
                  </p>
                )}
                {ev.notes && <p className="text-xs text-gray-400 mt-1">{ev.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
