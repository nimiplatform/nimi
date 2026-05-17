import { Button, OverlayShell, Surface } from '@nimiplatform/nimi-kit/ui';
import { useEffect, useState } from 'react';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { deleteSleepRecord, getSleepRecords } from '../../bridge/sqlite-bridge.js';
import type { SleepRecordRow } from '../../bridge/sqlite-bridge.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
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

  if (!child) {
    return (
      <ProfileDetailShell title="睡眠记录">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

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
    <ProfileDetailShell
      title="睡眠记录"
      actions={!showForm ? (
        <Button tone="primary" size="sm" onClick={() => setShowForm(true)} className="rounded-2xl">
          添加记录
        </Button>
      ) : null}
      aiSummary={
        <AISummaryCard domain="sleep" childName={child.displayName} childId={child.childId}
          ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
          dataContext={records.length > 0 ? `近期 ${records.length} 条睡眠记录，最近一次: ${records[0]?.sleepDate ?? ''}` : ''}
        />
      }
    >
      <p className="text-sm mb-4 text-[var(--nimi-text-muted)]">
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
          <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="rounded-3xl p-8 text-center">
            <span className="text-[24px]">😴</span>
            <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">还没有睡眠记录</p>
            <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">点击上方按钮添加第一条记录</p>
          </Surface>
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
        <OverlayShell
          open
          kind="dialog"
          onClose={() => setDeletingRecordId(null)}
          panelClassName="w-[340px] rounded-3xl"
          title={<p className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">确认删除</p>}
          footer={
            <div className="flex justify-end gap-2">
              <Button tone="ghost" size="sm" onClick={() => setDeletingRecordId(null)} className="rounded-2xl">取消</Button>
              <Button tone="danger" size="sm" onClick={() => void handleDelete(deletingRecordId)} className="rounded-2xl">确认删除</Button>
            </div>
          }
        >
          <p className="text-[14px] text-[var(--nimi-text-muted)]">删除后无法恢复，确定要删除这条睡眠记录吗？</p>
        </OverlayShell>
      ) : null}
    </ProfileDetailShell>
  );
}
