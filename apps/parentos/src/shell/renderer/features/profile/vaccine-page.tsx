import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { REMINDER_RULES } from '../../knowledge-base/index.js';
import { getVaccineRecords, insertVaccineRecord } from '../../bridge/sqlite-bridge.js';
import type { VaccineRecordRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';

export default function VaccinePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<VaccineRecordRow[]>([]);
  const [recordingRuleId, setRecordingRuleId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formBatch, setFormBatch] = useState('');
  const [formHospital, setFormHospital] = useState('');

  useEffect(() => {
    if (activeChildId) {
      getVaccineRecords(activeChildId).then(setRecords).catch(() => {});
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-gray-500">请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);
  const vaccineRules = REMINDER_RULES.filter((r) => r.domain === 'vaccine');
  const recordedRuleIds = new Set(records.map((r) => r.ruleId));

  const pendingVaccines = vaccineRules.filter((r) => !recordedRuleIds.has(r.ruleId));
  const completedVaccines = vaccineRules.filter((r) => recordedRuleIds.has(r.ruleId));

  const handleRecord = async (ruleId: string, title: string) => {
    const now = isoNow();
    try {
      await insertVaccineRecord({
        recordId: ulid(), childId: child.childId, ruleId,
        vaccineName: title, vaccinatedAt: formDate, ageMonths: computeAgeMonthsAt(child.birthDate, formDate),
        batchNumber: formBatch || null, hospital: formHospital || null,
        adverseReaction: null, photoPath: null, now,
      });
      const updated = await getVaccineRecords(child.childId);
      setRecords(updated);
      setRecordingRuleId(null);
      setFormBatch('');
      setFormHospital('');
    } catch { /* bridge unavailable */ }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 返回档案</Link>
      </div>
      <h1 className="text-2xl font-bold mb-2">疫苗记录</h1>
      <p className="text-sm text-gray-500 mb-6">
        已接种 {completedVaccines.length} / {vaccineRules.length} 项
      </p>

      {/* Pending */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">待接种</h2>
        {pendingVaccines.length === 0 ? (
          <p className="text-gray-400 text-sm">所有疫苗已接种完成</p>
        ) : (
          <div className="space-y-2">
            {pendingVaccines.map((r) => {
              const isOverdue = ageMonths > r.triggerAge.endMonths && r.triggerAge.endMonths !== -1;
              const isCurrent = ageMonths >= r.triggerAge.startMonths && (ageMonths <= r.triggerAge.endMonths || r.triggerAge.endMonths === -1);
              const isRecording = recordingRuleId === r.ruleId;

              return (
                <div key={r.ruleId} className={`border rounded-lg p-4 ${isOverdue ? 'border-red-200 bg-red-50' : isCurrent ? 'border-amber-200 bg-amber-50' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-sm">{r.title}</h3>
                        {isOverdue && <span className="text-xs text-red-600">已过期</span>}
                        {isCurrent && !isOverdue && <span className="text-xs text-amber-600">当前窗口</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>
                      <p className="text-xs text-gray-400">接种窗口: {r.triggerAge.startMonths}-{r.triggerAge.endMonths === -1 ? '无上限' : r.triggerAge.endMonths} 月龄 · {r.source}</p>
                    </div>
                    {!isRecording && (
                      <button onClick={() => setRecordingRuleId(r.ruleId)} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 shrink-0">
                        记录接种
                      </button>
                    )}
                  </div>
                  {isRecording && (
                    <div className="mt-3 pt-3 border-t space-y-2">
                      <div className="flex gap-2">
                        <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="border rounded-md px-2 py-1 text-sm" />
                        <input placeholder="批号" value={formBatch} onChange={(e) => setFormBatch(e.target.value)} className="border rounded-md px-2 py-1 text-sm flex-1" />
                        <input placeholder="接种机构" value={formHospital} onChange={(e) => setFormHospital(e.target.value)} className="border rounded-md px-2 py-1 text-sm flex-1" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleRecord(r.ruleId, r.title)} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-md">保存</button>
                        <button onClick={() => setRecordingRuleId(null)} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-md">取消</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Completed */}
      {completedVaccines.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">已接种</h2>
          <div className="space-y-2">
            {completedVaccines.map((r) => {
              const record = records.find((rec) => rec.ruleId === r.ruleId);
              return (
                <div key={r.ruleId} className="border rounded-lg p-4 bg-green-50 border-green-200">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600 text-sm">&#10003;</span>
                    <h3 className="font-medium text-sm">{r.title}</h3>
                  </div>
                  {record && (
                    <p className="text-xs text-gray-500 mt-1">
                      {record.vaccinatedAt.split('T')[0]}
                      {record.hospital && ` · ${record.hospital}`}
                      {record.batchNumber && ` · 批号 ${record.batchNumber}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
