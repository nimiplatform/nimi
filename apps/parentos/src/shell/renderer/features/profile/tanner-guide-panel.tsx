import { useState } from 'react';
import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
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
  color,
  childName,
  ageLabel,
  gender,
}: {
  text: string;
  color: string;
  childName: string;
  ageLabel: string;
  gender: string;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const detail = DETAIL_MAP[text];
  const aiUrl = `/advisor?topic=${encodeURIComponent(text.replace(/\s*\[.*?\]\s*/g, ''))}&desc=${encodeURIComponent(`${childName}（${ageLabel}，${gender === 'female' ? '女孩' : '男孩'}）的发育指导`)}&domain=tanner&record=/profile/tanner`;

  return (
    <div className={`${S.radiusSm} overflow-hidden`} style={{ background: color }}>
      <div className="flex items-start gap-2 p-2.5">
        <span className="text-[12px] mt-1.5 shrink-0" style={{ color: S.sub }}>●</span>
        <p className="text-[13px] leading-relaxed flex-1" style={{ color: S.text }}>{text}</p>
        <div className="flex items-center gap-1 shrink-0">
          {detail ? (
            <button
              onClick={() => setShowDetail(!showDetail)}
              className="text-[12px] px-1.5 py-0.5 rounded transition-colors"
              style={showDetail ? { background: S.accent, color: '#fff' } : { background: 'rgba(0,0,0,0.06)', color: S.sub }}
            >
              {showDetail ? '收起' : '怎么做?'}
            </button>
          ) : null}
          <Link
            to={aiUrl}
            title="向AI顾问咨询"
            className="w-5 h-5 rounded flex items-center justify-center transition-colors hover:bg-[rgba(0,0,0,0.08)]"
            style={{ color: '#BDE0F5' }}
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
            <p className="text-[12px] font-semibold mb-1" style={{ color: S.text }}>具体怎么做：</p>
            {detail.steps.map((step, index) => (
              <p key={index} className="text-[12px] leading-relaxed pl-3 relative" style={{ color: S.sub }}>
                <span className="absolute left-0">{index + 1}.</span> {step}
              </p>
            ))}
          </div>
          {detail.resources ? (
            <div>
              <p className="text-[12px] font-semibold mb-0.5" style={{ color: S.text }}>推荐资源：</p>
              {detail.resources.map((resource, index) => (
                <p key={index} className="text-[12px] leading-relaxed" style={{ color: '#BDE0F5' }}>📖 {resource}</p>
              ))}
            </div>
          ) : null}
          {detail.when ? (
            <p className="text-[12px]" style={{ color: S.sub }}>
              <span className="font-semibold" style={{ color: S.text }}>什么时候做：</span>{detail.when}
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
    <div className={`${S.radius} mt-6 overflow-hidden`} style={{ boxShadow: S.shadow }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-5 py-4 text-left" style={{ background: 'linear-gradient(135deg, #5a7a5a, #7a9a6a)' }}>
        <div>
          <h3 className="text-[16px] font-bold text-white">{latestBG ? '当前阶段发育指导' : '发育指导参考'}</h3>
          <p className="text-[13px] text-white/60 mt-0.5">{guidance.title} · 基于{latestBG ? '最新评估结果' : '青春前期'} · 点击每条建议查看详细指导</p>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded ? (
        <div className="p-5 space-y-4" style={{ background: S.card }}>
          {buildGuidanceSections(guidance).map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[16px]">{section.icon}</span>
                <h4 className="text-[14px] font-semibold" style={{ color: S.text }}>{section.title}</h4>
              </div>
              <div className="space-y-1.5 ml-6">
                {section.items.map((item, index) => (
                  <GuidanceItem
                    key={index}
                    text={item}
                    color={section.color}
                    childName={childName}
                    ageLabel={ageLabel}
                    gender={gender}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="pt-3 border-t space-y-1" style={{ borderColor: S.border }}>
            <p className="text-[12px] font-medium" style={{ color: '#475569' }}>参考文献标注</p>
            <p className="text-[12px]" style={{ color: '#b0b5bc' }}>[A] 中枢性性早熟诊断与治疗专家共识（2022）— 中华儿科杂志 2023;61(1)</p>
            <p className="text-[12px]" style={{ color: '#b0b5bc' }}>[B] 中国居民膳食营养素参考摄入量（2023版）— 中国营养学会</p>
            <p className="text-[12px]" style={{ color: '#b0b5bc' }}>[C] Marshall &amp; Tanner, Arch Dis Child 1969;44:291 (女孩)</p>
            <p className="text-[12px]" style={{ color: '#b0b5bc' }}>[D] Marshall &amp; Tanner, Arch Dis Child 1970;45:13 (男孩)</p>
            <p className="text-[12px] mt-1" style={{ color: '#b0b5bc' }}>以上建议仅供参考，不能替代专业医生的诊断。如有疑虑请咨询儿童内分泌科或青春期门诊。</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
