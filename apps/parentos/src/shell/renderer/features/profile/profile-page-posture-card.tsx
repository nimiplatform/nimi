import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, PersonStanding } from 'lucide-react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { getPostureAssessments, type PostureAssessmentRow } from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';

/**
 * Posture console card. Posture is a retained-owner stateful domain
 * (profile-contract.md#PO-PROF-019): its records live in `posture_assessments`,
 * not the PO-HREC `health_record_events` snapshot, so it is rendered as its
 * own card rather than a `HEALTH_METRIC_GROUPS` snapshot group.
 */
export function ProfilePostureCard({ childId }: { childId: string }) {
  const [assessments, setAssessments] = useState<PostureAssessmentRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPostureAssessments(childId)
      .then((rows) => {
        if (!cancelled) setAssessments(rows);
      })
      .catch(catchLog('profile', 'action:load-posture-card-failed'));
    return () => {
      cancelled = true;
    };
  }, [childId]);

  const count = assessments.length;
  const latest = assessments[0]?.assessedAt ?? null;

  return (
    <Surface
      as="section"
      material="glass-regular"
      padding="none"
      tone="card"
      className="overflow-hidden rounded-2xl shadow-[var(--nimi-elevation-base)]"
    >
      <Link
        to="/profile/posture"
        className="block w-full px-5 py-5 transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]">
            <PersonStanding size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-normal text-[var(--nimi-text-primary)]">
                体态档案
              </h3>
              <span className="text-[12px] font-medium text-[var(--nimi-text-muted)]">
                {count > 0 ? `${count} 次评估` : '未记录'}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px] text-[var(--nimi-text-muted)]">
              {latest
                ? `最近评估 ${latest.split('T')[0]}`
                : '脊柱、肩部、骨盆与下肢对齐评估'}
            </p>
          </div>
          <ChevronRight size={18} className="text-[var(--nimi-text-muted)]" />
        </div>
      </Link>
    </Surface>
  );
}
