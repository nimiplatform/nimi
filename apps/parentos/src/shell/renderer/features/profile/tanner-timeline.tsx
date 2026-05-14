import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { TannerAssessmentRow } from '../../bridge/sqlite-bridge.js';
import type { StageDesc } from './tanner-page-shared.js';
import { ASSESSED_BY_LABELS, PUBIC_HAIR_STAGES, fmtAge } from './tanner-page-shared.js';

type TannerTimelineProps = {
  assessments: TannerAssessmentRow[];
  bgStages: StageDesc[];
  isFemale: boolean;
  showForm: boolean;
};

export function TannerTimeline({
  assessments,
  bgStages,
  isFemale,
  showForm,
}: TannerTimelineProps) {
  if (assessments.length === 0 && !showForm) {
    return (
      <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-8 text-center">
        <span className="text-[24px]">🌱</span>
        <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">还没有发育评估记录</p>
        <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">建议青春期开始后每 6-12 个月评估一次</p>
      </Surface>
    );
  }

  return (
    <div className="space-y-3">
      {assessments.map((assessment, index) => {
        const bgInfo = bgStages.find((stage) => stage.stage === assessment.breastOrGenitalStage);
        const phInfo = PUBIC_HAIR_STAGES.find((stage) => stage.stage === assessment.pubicHairStage);
        const previous = assessments[index + 1];
        const bgChanged = previous && previous.breastOrGenitalStage !== assessment.breastOrGenitalStage;
        const phChanged = previous && previous.pubicHairStage !== assessment.pubicHairStage;

        return (
          <Surface key={assessment.assessmentId} tone="card" material="glass-regular" elevation="raised" padding="none" className="overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between bg-[linear-gradient(135deg,var(--nimi-action-primary-bg),var(--nimi-status-info))] px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-[14px] font-semibold text-white">{assessment.assessedAt.split('T')[0]}</span>
                <span className="text-[12px] text-white/60">{fmtAge(assessment.ageMonths)}</span>
                {assessment.assessedBy ? (
                  <span className="text-[12px] px-2 py-0.5 rounded-full bg-white/20 text-white/70">
                    {ASSESSED_BY_LABELS[assessment.assessedBy] ?? assessment.assessedBy}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 bg-[var(--nimi-surface-card)] p-4">
              <div className={`rounded-2xl border p-3 ${bgChanged ? 'border-[color-mix(in_srgb,var(--nimi-status-success)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,var(--nimi-surface-card))]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-bold bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]">
                    {assessment.breastOrGenitalStage ?? '-'}
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{isFemale ? 'B期 乳房' : 'G期 生殖器'}</span>
                  {bgChanged ? <span className="text-[12px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]">↑ 进展</span> : null}
                </div>
                <p className="text-[12px] text-[var(--nimi-text-muted)]">{bgInfo?.desc.slice(0, 30) ?? ''}...</p>
              </div>
              <div className={`rounded-2xl border p-3 ${phChanged ? 'border-[color-mix(in_srgb,var(--nimi-status-success)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,var(--nimi-surface-card))]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-bold bg-[var(--nimi-status-info)] text-[var(--nimi-action-primary-text)]">
                    {assessment.pubicHairStage ?? '-'}
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">PH期 阴毛</span>
                  {phChanged ? <span className="text-[12px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]">↑ 进展</span> : null}
                </div>
                <p className="text-[12px] text-[var(--nimi-text-muted)]">{phInfo?.desc.slice(0, 30) ?? ''}...</p>
              </div>
            </div>
            {assessment.notes ? (
              <div className="bg-[var(--nimi-surface-card)] px-4 pb-3 text-[12px] text-[var(--nimi-text-muted)]">
                备注: {assessment.notes}
              </div>
            ) : null}
          </Surface>
        );
      })}
    </div>
  );
}
