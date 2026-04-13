import { S } from '../../app-shell/page-style.js';
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
      <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
        <span className="text-[28px]">🌱</span>
        <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有发育评估记录</p>
        <p className="text-[11px] mt-1" style={{ color: S.sub }}>建议青春期开始后每 6-12 个月评估一次</p>
      </div>
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
          <div key={assessment.assessmentId} className={`${S.radius} overflow-hidden`} style={{ boxShadow: S.shadow }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #6a82a8, #86AFDA)' }}>
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-white">{assessment.assessedAt.split('T')[0]}</span>
                <span className="text-[10px] text-white/60">{fmtAge(assessment.ageMonths)}</span>
                {assessment.assessedBy ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white/70">
                    {ASSESSED_BY_LABELS[assessment.assessedBy] ?? assessment.assessedBy}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4" style={{ background: S.card }}>
              <div className={`${S.radiusSm} p-3`} style={{ background: bgChanged ? '#f0fdf4' : '#f8faf9', border: `1px solid ${bgChanged ? '#86efac' : S.border}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: S.accent }}>
                    {assessment.breastOrGenitalStage ?? '-'}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: S.text }}>{isFemale ? 'B期 乳房' : 'G期 生殖器'}</span>
                  {bgChanged ? <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#16a34a' }}>↑ 进展</span> : null}
                </div>
                <p className="text-[10px]" style={{ color: S.sub }}>{bgInfo?.desc.slice(0, 30) ?? ''}...</p>
              </div>
              <div className={`${S.radiusSm} p-3`} style={{ background: phChanged ? '#f0fdf4' : '#f8faf9', border: `1px solid ${phChanged ? '#86efac' : S.border}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: '#86AFDA' }}>
                    {assessment.pubicHairStage ?? '-'}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: S.text }}>PH期 阴毛</span>
                  {phChanged ? <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#16a34a' }}>↑ 进展</span> : null}
                </div>
                <p className="text-[10px]" style={{ color: S.sub }}>{phInfo?.desc.slice(0, 30) ?? ''}...</p>
              </div>
            </div>
            {assessment.notes ? (
              <div className="px-4 pb-3 text-[10px]" style={{ color: S.sub, background: S.card }}>
                备注: {assessment.notes}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
