import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { getFitnessAssessments } from '../../bridge/sqlite-bridge.js';
import type { FitnessAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { FitnessAssessmentModal, ageTier } from './fitness-assessment-form.js';

const AGE_TIER_LABELS: Record<string, string> = {
  preschool: '学龄前',
  grade12: '1-2年级',
  grade34: '3-4年级',
  grade56: '5-6年级',
  grade7plus: '初中及以上',
};

const FOOT_ARCH_LABELS: Record<string, string> = {
  normal: '正常',
  flat: '扁平足',
  'high-arch': '高弓足',
  monitoring: '观察中',
};

const SOURCE_LABELS: Record<string, string> = {
  'school-pe': '学校体育',
  'sports-club': '体育俱乐部',
  clinic: '医疗机构',
  self: '自测',
};

export default function FitnessPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [assessments, setAssessments] = useState<FitnessAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (activeChildId) {
      getFitnessAssessments(activeChildId).then(setAssessments).catch(catchLog('fitness', 'action:load-fitness-assessments-failed'));
    }
  }, [activeChildId]);

  if (!child) return <div className="p-8 text-[var(--nimi-text-muted)]">请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  const sortedAssessments = [...assessments].sort(
    (a, b) => new Date(b.assessedAt).getTime() - new Date(a.assessedAt).getTime(),
  );

  const refreshAssessments = async () => {
    setAssessments(await getFitnessAssessments(child.childId));
  };

  return (
    <div className="mx-auto min-h-full max-w-3xl px-6 pb-6 pt-[72px]">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[14px] hover:underline text-[var(--nimi-text-muted)]">&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-[var(--nimi-text-primary)]">体能评估</h1>
        {!showForm && (
          <Button tone="primary" size="sm" onClick={() => setShowForm(true)} className="rounded-2xl">
            添加评估
          </Button>
        )}
      </div>
      <AISummaryCard domain="fitness" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths/12)}岁${ageMonths%12}个月`} gender={child.gender}
        dataContext={assessments.length > 0 ? `共 ${assessments.length} 次体能测评` : ''}
      />

      {/* Add Form */}
      {showForm && (
        <FitnessAssessmentModal
          child={{ childId: child.childId, birthDate: child.birthDate, gender: child.gender }}
          ageMonths={ageMonths}
          onSaved={refreshAssessments}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Assessment Cards */}
      <section>
        {sortedAssessments.length === 0 ? (
          <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="rounded-3xl p-8 text-center">
            <span className="text-[24px]">🏃</span>
            <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">还没有体能评估</p>
            <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">记录体测成绩，追踪体能发展</p>
          </Surface>
        ) : (
          <div className="space-y-4">
            {sortedAssessments.map((a) => {
              const speedMetrics = [
                { label: '10米折返跑', value: a.run10mShuttle, unit: 's' },
                { label: '50米跑', value: a.run50m, unit: 's' },
                { label: '800米跑', value: a.run800m, unit: 's' },
                { label: '1000米跑', value: a.run1000m, unit: 's' },
                { label: '50m×8', value: a.run50x8, unit: 's' },
              ].filter((m) => m.value != null);
              const strengthMetrics = [
                { label: '立定跳远', value: a.standingLongJump, unit: 'cm' },
                { label: '网球掷远', value: a.tennisBallThrow, unit: 'm' },
                { label: '双脚连续跳', value: a.doubleFootJump, unit: 's' },
                { label: '坐位体前屈', value: a.sitAndReach, unit: 'cm' },
                { label: '仰卧起坐', value: a.sitUps, unit: '次/分' },
                { label: '引体向上', value: a.pullUps, unit: '次' },
              ].filter((m) => m.value != null);
              const cardioMetrics = [
                { label: '走平衡木', value: a.balanceBeam, unit: 's' },
                { label: '跳绳', value: a.ropeSkipping, unit: '次/分' },
                { label: '肺活量', value: a.vitalCapacity, unit: 'mL' },
              ].filter((m) => m.value != null);

              const metricChip = (m: { label: string; value: number | null; unit: string }) => (
                <span key={m.label} className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[14px]">
                  <span className="text-[var(--nimi-text-muted)]">{m.label}</span>
                  <span className="font-medium text-[var(--nimi-text-primary)]">{m.value}{m.unit}</span>
                </span>
              );

              return (
                <Surface key={a.assessmentId} tone="card" material="glass-regular" elevation="raised" padding="none" className="rounded-3xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-[var(--nimi-text-primary)]">{a.assessedAt.split('T')[0]}</span>
                      <span className="rounded bg-[var(--nimi-surface-panel)] px-1.5 py-0.5 text-[13px] text-[var(--nimi-text-muted)]">{AGE_TIER_LABELS[ageTier(a.ageMonths)]}</span>
                      {a.assessmentSource && (
                        <span className="text-[13px] text-[var(--nimi-text-muted)]">{SOURCE_LABELS[a.assessmentSource] ?? a.assessmentSource}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {speedMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8 text-[var(--nimi-text-muted)]">速度</span>
                        {speedMetrics.map(metricChip)}
                      </div>
                    )}
                    {strengthMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8 text-[var(--nimi-text-muted)]">力量</span>
                        {strengthMetrics.map(metricChip)}
                      </div>
                    )}
                    {cardioMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8 text-[var(--nimi-text-muted)]">心肺</span>
                        {cardioMetrics.map(metricChip)}
                      </div>
                    )}
                    {a.footArchStatus && (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] w-8 text-[var(--nimi-text-muted)]">足弓</span>
                        <span className="inline-flex items-center rounded-full bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[14px] font-medium text-[var(--nimi-text-primary)]">
                          {FOOT_ARCH_LABELS[a.footArchStatus] ?? a.footArchStatus}
                        </span>
                      </div>
                    )}
                  </div>
                  {a.notes && <p className="mt-3 border-t border-[var(--nimi-border-subtle)] pt-2 text-[14px] text-[var(--nimi-text-muted)]">{a.notes}</p>}
                </Surface>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
