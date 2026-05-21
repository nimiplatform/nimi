import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect } from 'react';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { getPostureAssessments, getFitnessAssessments } from '../../bridge/sqlite-bridge.js';
import type { PostureAssessmentRow, FitnessAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { AISummaryCard } from './ai-summary-card.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { PostureGuide } from './posture-guide.js';
import { PostureCaptureModal } from './posture-capture-form.js';

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const SHOULDER_LABELS: Record<string, string> = { '0': '对称', '1': '左肩偏高', '2': '右肩偏高' };

const FOOT_ARCH_LABELS: Record<string, string> = { normal: '正常', flat: '扁平足', 'high-arch': '高弓足', monitoring: '观察中' };
const FOOT_ARCH_TONES: Record<string, BadgeTone> = { normal: 'success', flat: 'warning', 'high-arch': 'warning', monitoring: 'info' };

const COBB_LEVELS = [
  { max: 10, label: '正常', tone: 'success' },
  { max: 25, label: '需定期监测', tone: 'warning' },
  { max: 40, label: '建议支具治疗', tone: 'danger' },
  { max: Infinity, label: '建议手术评估', tone: 'danger' },
] as const;

function cobbLevel(angle: number) {
  return COBB_LEVELS.find((l) => angle <= l.max) ?? COBB_LEVELS[COBB_LEVELS.length - 1]!;
}

function fmtAge(months: number) {
  const y = Math.floor(months / 12); const m = months % 12;
  return y > 0 ? (m > 0 ? `${y}岁${m}个月` : `${y}岁`) : `${m}个月`;
}

function badgeToneClass(tone: BadgeTone) {
  if (tone === 'success') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]';
  if (tone === 'warning') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-[var(--nimi-status-warning)]';
  if (tone === 'danger') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_15%,transparent)] text-[var(--nimi-status-danger)]';
  if (tone === 'info') return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_15%,transparent)] text-[var(--nimi-status-info)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-status-neutral)_15%,transparent)] text-[var(--nimi-status-neutral)]';
}

export default function PosturePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  const [assessments, setAssessments] = useState<PostureAssessmentRow[]>([]);
  const [fitnessAssessments, setFitnessAssessments] = useState<FitnessAssessmentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const loadData = async (cid: string) => {
    const [pa, fa] = await Promise.all([getPostureAssessments(cid), getFitnessAssessments(cid)]);
    setAssessments(pa);
    setFitnessAssessments(fa);
  };

  useEffect(() => { if (activeChildId) loadData(activeChildId).catch(catchLog('posture', 'action:load-posture-data-failed')); }, [activeChildId]);

  if (!child) {
    return (
      <ProfileDetailShell title="体态档案">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);
  const sortedAssessments = [...assessments].sort((a, b) => b.assessedAt.localeCompare(a.assessedAt));
  const latestCobb = sortedAssessments.find((a) => a.cobbAngle != null);
  const latestShoulder = sortedAssessments.find((a) => a.shoulder != null && a.shoulder !== '');
  const latestFootArch = [...fitnessAssessments].sort((a, b) => b.assessedAt.localeCompare(a.assessedAt)).find((a) => a.footArchStatus);

  // Each posture assessment is one timeline entry, newest first.
  const timeline = sortedAssessments;

  return (
    <ProfileDetailShell
      title="体态档案"
      actions={
        <>
          <Button
            onClick={() => setShowGuide((prev) => !prev)}
            tone={showGuide ? 'primary' : 'secondary'}
            size="sm"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            录入指引
          </Button>
          {!showForm && (
            <Button onClick={() => setShowForm(true)} tone="primary" size="sm">
              + 添加记录
            </Button>
          )}
        </>
      }
      aiSummary={
        <AISummaryCard domain="posture" childName={child.displayName} childId={child.childId}
          ageLabel={fmtAge(ageMonths)} gender={child.gender}
          dataContext={(() => {
            const lines: string[] = [];
            if (latestCobb?.cobbAngle != null) lines.push(`Cobb角: ${latestCobb.cobbAngle}° (${latestCobb.assessedAt.split('T')[0]})`);
            if (latestFootArch?.footArchStatus) lines.push(`足弓: ${FOOT_ARCH_LABELS[latestFootArch.footArchStatus] ?? latestFootArch.footArchStatus}`);
            return lines.join('\n');
          })()} />
      }
    >
      {showGuide && <PostureGuide onClose={() => setShowGuide(false)} />}

      {/* Quick overview */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Surface tone="card" elevation="raised" padding="md" className="rounded-2xl">
          <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">🦴 Cobb 角</p>
          {latestCobb?.cobbAngle != null ? (() => {
            const level = cobbLevel(latestCobb.cobbAngle);
            return (<>
              <p className="text-[20px] font-bold mt-1 text-[var(--nimi-text-primary)]">{latestCobb.cobbAngle}°</p>
              <span className={`text-[12px] px-1.5 py-0.5 rounded-full mt-1 inline-block ${badgeToneClass(level.tone)}`}>{level.label}</span>
            </>);
          })() : <p className="text-[14px] mt-1 text-[var(--nimi-text-muted)]">未记录</p>}
        </Surface>

        <Surface tone="card" elevation="raised" padding="md" className="rounded-2xl">
          <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">🧍 肩部</p>
          {latestShoulder?.shoulder ? (
            <p className="text-[16px] font-bold mt-1 text-[var(--nimi-text-primary)]">{SHOULDER_LABELS[latestShoulder.shoulder] ?? '未知'}</p>
          ) : <p className="text-[14px] mt-1 text-[var(--nimi-text-muted)]">未记录</p>}
        </Surface>

        <Surface tone="card" elevation="raised" padding="md" className="rounded-2xl">
          <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">🦶 足弓</p>
          {latestFootArch?.footArchStatus ? (
            <p className={`text-[16px] font-bold mt-1 ${badgeToneClass(FOOT_ARCH_TONES[latestFootArch.footArchStatus] ?? 'neutral')}`}>
              {FOOT_ARCH_LABELS[latestFootArch.footArchStatus] ?? latestFootArch.footArchStatus}
            </p>
          ) : <p className="text-[14px] mt-1 text-[var(--nimi-text-muted)]">未记录</p>}
          <p className="text-[12px] mt-0.5 text-[var(--nimi-text-muted)]">来自体能测评</p>
        </Surface>
      </div>

      {/* Add-record form — the 添加健康数据 posture form pane, no sidebar */}
      {showForm && (
        <PostureCaptureModal
          child={{ childId: child.childId, birthDate: child.birthDate }}
          onSaved={() => loadData(child.childId)}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Timeline */}
      <h2 className="text-[14px] font-semibold mb-3 mt-2 text-[var(--nimi-text-primary)]">
        {timeline.length > 0 ? `评估记录（${timeline.length} 次）` : ''}
      </h2>
      {timeline.length === 0 && !showForm && (
        <Surface tone="card" elevation="raised" padding="lg" className="rounded-3xl text-center">
          <span className="text-[24px]">🧍</span>
          <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">还没有体态评估记录</p>
          <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">记录脊柱侧弯角度和肩部对称性</p>
        </Surface>
      )}
      <div className="space-y-3">
        {timeline.map((rec) => (
          <Surface key={rec.assessmentId} tone="card" elevation="raised" padding="md" className="rounded-3xl">
            <p className="text-[13px] font-medium mb-2 text-[var(--nimi-text-muted)]">{rec.assessedAt.split('T')[0]}</p>
            <div className="flex flex-wrap gap-3">
              {rec.cobbAngle != null && (() => {
                const level = cobbLevel(rec.cobbAngle);
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[var(--nimi-text-muted)]">Cobb 角</span>
                    <span className="text-[16px] font-bold text-[var(--nimi-text-primary)]">{rec.cobbAngle}°</span>
                    <span className={`text-[12px] px-1.5 py-0.5 rounded-full ${badgeToneClass(level.tone)}`}>{level.label}</span>
                  </div>
                );
              })()}
              {rec.shoulder && (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-[var(--nimi-text-muted)]">肩部</span>
                  <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{SHOULDER_LABELS[rec.shoulder] ?? '未知'}</span>
                </div>
              )}
            </div>
            {rec.notes && <p className="text-[13px] mt-2 text-[var(--nimi-text-muted)]">{rec.notes}</p>}
          </Surface>
        ))}
      </div>
    </ProfileDetailShell>
  );
}
