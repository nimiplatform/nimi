import { useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import type { StageDesc } from './tanner-page-shared.js';

type TannerStageSelectorProps = {
  stages: StageDesc[];
  value: number;
  onChange: (stage: number) => void;
  label: string;
};

export function TannerStageSelector({
  stages,
  value,
  onChange,
  label,
}: TannerStageSelectorProps) {
  const [expandedStage, setExpandedStage] = useState<number | null>(null);

  return (
    <div className="mb-5">
      <p className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>{label}</p>
      <div className="space-y-1.5">
        {stages.map((stage) => {
          const active = value === stage.stage;
          const expanded = expandedStage === stage.stage;
          return (
            <div
              key={stage.stage}
              className={`${S.radiusSm} overflow-hidden transition-all`}
              style={active
                ? { background: S.accent, color: '#fff', boxShadow: '0 2px 8px rgba(148,165,51,0.25)' }
                : { background: '#f5f3ef', color: S.text }}
            >
              <button onClick={() => onChange(stage.stage)} className="w-full text-left p-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={active ? { background: 'rgba(255,255,255,0.25)', color: '#fff' } : { background: '#e8e5e0', color: S.sub }}
                  >
                    {stage.stage}
                  </div>
                  <span className="text-[12px] font-semibold flex-1">{stage.title}</span>
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedStage(expanded ? null : stage.stage);
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                    style={active ? { background: 'rgba(255,255,255,0.2)', color: '#fff' } : { background: '#e8e5e0', color: S.sub }}
                  >
                    {expanded ? '收起' : '如何判断?'}
                  </span>
                </div>
                <p className="text-[10px] mt-1 ml-8 leading-relaxed" style={{ color: active ? 'rgba(255,255,255,0.8)' : S.sub }}>
                  {stage.desc}
                </p>
              </button>
              {expanded ? (
                <div className="px-3 pb-3 ml-8">
                  <div
                    className={`${S.radiusSm} p-2.5 text-[10px] leading-relaxed`}
                    style={active
                      ? { background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }
                      : { background: '#fff', color: S.text, border: `1px solid ${S.border}` }}
                  >
                    {stage.howToJudge}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
