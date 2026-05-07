import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { deleteSleepRecord, getSleepRecords } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { SleepRecordForm } from './sleep-record-form.js';
import { SleepRecordCard } from './sleep-record-card.js';
import {
  referenceSleepRange,
  sleepAgeTier,
  sortSleepRecordsDesc,
  TIER_LABELS,
} from './sleep-page-shared.js';
import { SleepTrendChart } from './sleep-trend-chart.js';

/* 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
   Main Page
   鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲 */

export default function SleepPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [records, setRecords] = useState<SleepRecordRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const tier = sleepAgeTier(ageMonths);

  const [editingRecord, setEditingRecord] = useState<SleepRecordRow | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (activeChildId) getSleepRecords(activeChildId).then(setRecords).catch(catchLog('sleep', 'action:load-sleep-records-failed'));
  }, [activeChildId]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const sortedRecords = sortSleepRecordsDesc(records);
  const [refLo, refHi] = referenceSleepRange(ageMonths);

  const refreshRecords = async () => {
    setRecords(await getSleepRecords(child.childId));
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingRecord(null);
  };

  const startEdit = (record: SleepRecordRow) => {
    setEditingRecord(record);
    setShowForm(true);
  };

  const handleDelete = async (recordId: string) => {
    try {
      await deleteSleepRecord(recordId);
      const updated = await getSleepRecords(child.childId);
      setRecords(updated);
    } catch (err) {
      catchLog('sleep', 'action:delete-sleep-record-failed')(err);
    }
    setDeletingRecordId(null);
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[14px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>睡眠记录</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
            添加记录
          </button>
        )}
      </div>
      <AISummaryCard domain="sleep" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={records.length > 0 ? `近期 ${records.length} 条睡眠记录，最近一次: ${records[0]?.sleepDate ?? ''}` : ''}
      />
      <p className="text-sm mb-4" style={{ color: S.sub }}>
        参考睡眠时长: {refLo}-{refHi} 小时/天（{formatAge(ageMonths)} · {TIER_LABELS[tier]}）</p>

      {showForm ? (
        <SleepRecordForm
          child={{ childId: child.childId, birthDate: child.birthDate }}
          initialRecord={editingRecord}
          onSaved={refreshRecords}
          onClose={closeForm}
        />
      ) : null}

      {/* 鈹€鈹€ Trend Chart 鈹€鈹€ */}
      {records.length >= 2 && <SleepTrendChart records={records} ageMonths={ageMonths} />}

      {/* 鈹€鈹€ Records List 鈹€鈹€ */}
      <section>
        {sortedRecords.length === 0 ? (
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[24px]">😴</span>
            <p className="text-[14px] mt-2 font-medium" style={{ color: S.text }}>还没有睡眠记录</p>
            <p className="text-[13px] mt-1" style={{ color: S.sub }}>点击上方按钮添加第一条记录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedRecords.map((record) => (
              <SleepRecordCard key={record.recordId} record={record} onEdit={startEdit} onDelete={setDeletingRecordId} />
            ))}
          </div>
        )}
      </section>

      {/* Delete confirmation dialog */}
      {deletingRecordId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => setDeletingRecordId(null)}>
          <div className={`${S.radius} p-6 w-[340px] shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
            <p className="text-[16px] font-semibold mb-2" style={{ color: S.text }}>确认删除</p>
            <p className="text-[14px] mb-5" style={{ color: S.sub }}>删除后无法恢复，确定要删除这条睡眠记录吗？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingRecordId(null)} className={`px-4 py-2 text-[14px] ${S.radiusSm}`} style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
              <button onClick={() => void handleDelete(deletingRecordId)} className={`px-4 py-2 text-[14px] font-medium text-white ${S.radiusSm}`} style={{ background: '#dc2626' }}>确认删除</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
