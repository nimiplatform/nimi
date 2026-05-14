import { Surface } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DETAIL_MAP,
  FEMALE_GUIDANCE,
  MALE_GUIDANCE,
  buildGuidanceSections,
} from './tanner-page-shared.js';

type TannerGuidePanelProps = {
  isFemale: boolean;
  latestBG: number | null;
  latestPH: number | null;
  childName: string;
  ageLabel: string;
  gender: string;
};

function GuidanceItem({
  text,
  toneClassName,
  childName,
  ageLabel,
  gender,
}: {
  text: string;
  toneClassName: string;
  childName: string;
  ageLabel: string;
  gender: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const detail = DETAIL_MAP[text];
  const aiUrl = `/advisor?topic=${encodeURIComponent(text.replace(/\s*\[.*?\]\s*/g, ''))}&desc=${encodeURIComponent(`${childName}（${ageLabel}，${gender === 'female' ? '女孩' : '男孩'}）的发育指导`)}&domain=tanner&record=/profile`;

  return (
    <div className={`overflow-hidden rounded-2xl ${toneClassName}`}>
      <div className="flex items-start gap-2 p-2.5">
        <span className="text-[12px] mt-1.5 shrink-0 text-[var(--nimi-text-muted)]">●</span>
        <p className="text-[13px] leading-relaxed flex-1 text-[var(--nimi-text-primary)]">{text}</p>
        <div className="flex items-center gap-1 shrink-0">
          {detail ? (
            <button
              onClick={() => setShowDetail(!showDetail)}
              className={`rounded px-1.5 py-0.5 text-[12px] transition-colors ${showDetail ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] text-[var(--nimi-text-muted)]'}`}
            >
              {showDetail ? '收起' : '怎么做?'}
            </button>
          ) : null}
          <Link
            to={aiUrl}
            title="向AI顾问咨询"
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--nimi-status-info)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </Link>
        </div>
      </div>
      {showDetail && detail ? (
        <div className="px-7 pb-3 space-y-2">
          <div>
            <p className="text-[12px] font-semibold mb-1 text-[var(--nimi-text-primary)]">具体怎么做：</p>
            {detail.steps.map((step, index) => (
              <p key={index} className="text-[12px] leading-relaxed pl-3 relative text-[var(--nimi-text-muted)]">
                <span className="absolute left-0">{index + 1}.</span> {step}
              </p>
            ))}
          </div>
          {detail.resources ? (
            <div>
              <p className="text-[12px] font-semibold mb-0.5 text-[var(--nimi-text-primary)]">推荐资源：</p>
              {detail.resources.map((resource, index) => (
                <p key={index} className="text-[12px] leading-relaxed text-[var(--nimi-status-info)]">📖 {resource}</p>
              ))}
            </div>
          ) : null}
          {detail.when ? (
            <p className="text-[12px] text-[var(--nimi-text-muted)]">
              <span className="font-semibold text-[var(--nimi-text-primary)]">什么时候做：</span>{detail.when}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TannerGuidePanel({
  isFemale,
  latestBG,
  latestPH,
  childName,
  ageLabel,
  gender,
}: TannerGuidePanelProps) {
  const [expanded, setExpanded] = useState(true);
  const currentStage = Math.max(latestBG ?? 1, latestPH ?? 1);
  const guidanceList = isFemale ? FEMALE_GUIDANCE : MALE_GUIDANCE;
  const guidance = guidanceList.find((item) => item.stage === currentStage) ?? guidanceList[0];

  if (!guidance) {
    return null;
  }

  return (
    <Surface as="section" tone="card" material="glass-regular" elevation="raised" padding="none" className="mt-6 overflow-hidden rounded-3xl">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between bg-[linear-gradient(135deg,var(--nimi-action-primary-bg),var(--nimi-status-success))] px-5 py-4 text-left">
        <div>
          <h3 className="text-[16px] font-bold text-[var(--nimi-action-primary-text)]">{latestBG ? '当前阶段发育指导' : '发育指导参考'}</h3>
          <p className="mt-0.5 text-[13px] text-[color-mix(in_srgb,var(--nimi-action-primary-text)_70%,transparent)]">{guidance.title} · 基于{latestBG ? '最新评估结果' : '青春前期'} · 点击每条建议查看详细指导</p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`text-[color-mix(in_srgb,var(--nimi-action-primary-text)_70%,transparent)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded ? (
        <div className="space-y-4 bg-[var(--nimi-surface-card)] p-5">
          {buildGuidanceSections(guidance).map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[16px]">{section.icon}</span>
                <h4 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">{section.title}</h4>
              </div>
              <div className="space-y-1.5 ml-6">
                {section.items.map((item, index) => (
                  <GuidanceItem
                    key={index}
                    text={item}
                    toneClassName={guidanceSectionToneClassName(section.title)}
                    childName={childName}
                    ageLabel={ageLabel}
                    gender={gender}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-1 border-t border-[var(--nimi-border-subtle)] pt-3">
            <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">参考文献标注</p>
            <p className="text-[12px] text-[var(--nimi-text-muted)]">[A] 中枢性性早熟诊断与治疗专家共识（2022）— 中华儿科杂志 2023;61(1)</p>
            <p className="text-[12px] text-[var(--nimi-text-muted)]">[B] 中国居民膳食营养素参考摄入量（2023版）— 中国营养学会</p>
            <p className="text-[12px] text-[var(--nimi-text-muted)]">[C] Marshall &amp; Tanner, Arch Dis Child 1969;44:291 (女孩)</p>
            <p className="text-[12px] text-[var(--nimi-text-muted)]">[D] Marshall &amp; Tanner, Arch Dis Child 1970;45:13 (男孩)</p>
            <p className="mt-1 text-[12px] text-[var(--nimi-text-muted)]">以上建议仅供参考，不能替代专业医生的诊断。如有疑虑请咨询儿童内分泌科或青春期门诊。</p>
          </div>
        </div>
      ) : null}
    </Surface>
  );
}

function guidanceSectionToneClassName(title: string): string {
  if (title === '身体发育') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))]';
  if (title === '心理引导') return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,var(--nimi-surface-card))]';
  if (title === '营养建议') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))]';
  if (title === '检查建议') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]';
  return 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))]';
}
