import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { getFitnessAssessments } from '../../bridge/sqlite-bridge.js';
import type { FitnessAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
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

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  const sortedAssessments = [...assessments].sort(
    (a, b) => new Date(b.assessedAt).getTime() - new Date(a.assessedAt).getTime(),
  );

  const refreshAssessments = async () => {
    setAssessments(await getFitnessAssessments(child.childId));
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[14px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>体能评估</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
            添加评估
          </button>
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
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[24px]">🏃</span>
            <p className="text-[14px] mt-2 font-medium" style={{ color: S.text }}>还没有体能评估</p>
            <p className="text-[13px] mt-1" style={{ color: S.sub }}>记录体测成绩，追踪体能发展</p>
          </div>
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
                <span key={m.label} className="inline-flex items-center gap-1 text-[14px] px-2 py-0.5 rounded-full" style={{ background: '#f4f4f2' }}>
                  <span style={{ color: S.sub }}>{m.label}</span>
                  <span className="font-medium" style={{ color: S.text }}>{m.value}{m.unit}</span>
                </span>
              );

              return (
                <div key={a.assessmentId} className={S.radius + ' p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold" style={{ color: S.text }}>{a.assessedAt.split('T')[0]}</span>
                      <span className="text-[13px] px-1.5 py-0.5 rounded" style={{ background: '#f4f4f2', color: S.sub }}>{AGE_TIER_LABELS[ageTier(a.ageMonths)]}</span>
                      {a.assessmentSource && (
                        <span className="text-[13px]" style={{ color: S.sub }}>{SOURCE_LABELS[a.assessmentSource] ?? a.assessmentSource}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {speedMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>速度</span>
                        {speedMetrics.map(metricChip)}
                      </div>
                    )}
                    {strengthMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>力量</span>
                        {strengthMetrics.map(metricChip)}
                      </div>
                    )}
                    {cardioMetrics.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>心肺</span>
                        {cardioMetrics.map(metricChip)}
                      </div>
                    )}
                    {a.footArchStatus && (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] w-8" style={{ color: S.sub }}>足弓</span>
                        <span className="inline-flex items-center text-[14px] px-2 py-0.5 rounded-full font-medium" style={{ background: '#f4f4f2', color: S.text }}>
                          {FOOT_ARCH_LABELS[a.footArchStatus] ?? a.footArchStatus}
                        </span>
                      </div>
                    )}
                  </div>
                  {a.notes && <p className="text-[14px] mt-3 pt-2" style={{ color: S.sub, borderTop: `1px solid ${S.border}` }}>{a.notes}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
