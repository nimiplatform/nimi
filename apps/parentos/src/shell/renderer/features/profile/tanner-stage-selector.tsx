import '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
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
      <p className="text-[14px] font-semibold mb-2 text-[var(--nimi-text-primary)]">{label}</p>
      <div className="space-y-1.5">
        {stages.map((stage) => {
          const active = value === stage.stage;
          const expanded = expandedStage === stage.stage;
          return (
            <div
              key={stage.stage}
              className={`overflow-hidden rounded-2xl transition-all ${active ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]' : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-primary)]'}`}
            >
              <button onClick={() => onChange(stage.stage)} className="w-full text-left p-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${active ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-text)_25%,transparent)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]'}`}
                  >
                    {stage.stage}
                  </div>
                  <span className="text-[14px] font-semibold flex-1">{stage.title}</span>
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedStage(expanded ? null : stage.stage);
                    }}
                    className={`cursor-pointer rounded px-1.5 py-0.5 text-[12px] transition-colors ${active ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-text)_20%,transparent)] text-[var(--nimi-action-primary-text)]' : 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)]'}`}
                  >
                    {expanded ? '收起' : '如何判断?'}
                  </span>
                </div>
                <p className={`ml-8 mt-1 text-[12px] leading-relaxed ${active ? 'text-[color-mix(in_srgb,var(--nimi-action-primary-text)_80%,transparent)]' : 'text-[var(--nimi-text-muted)]'}`}>
                  {stage.desc}
                </p>
              </button>
              {expanded ? (
                <div className="px-3 pb-3 ml-8">
                  <div
                    className={`rounded-2xl p-2.5 text-[12px] leading-relaxed ${active ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-text)_15%,transparent)] text-[color-mix(in_srgb,var(--nimi-action-primary-text)_90%,transparent)]' : 'border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)]'}`}
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
