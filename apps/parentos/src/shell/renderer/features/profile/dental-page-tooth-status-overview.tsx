import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import {
  computeDentalOverviewStates,
  type EruptionState,
  type HealthState,
  TOOTH_NAMES,
} from './dental-page-domain.js';

const ERUPTION_STYLE: Record<EruptionState, { border: string; text: string; label: string }> = {
  unerupted: { border: '#d4cfc3', text: '#94a3b8', label: '未萌出' },
  primary_present: { border: '#10b981', text: '#065f46', label: '乳牙在位' },
  lost_waiting: { border: '#f59e0b', text: '#92400e', label: '已脱落·待恒牙' },
  permanent_erupted: { border: '#2563eb', text: '#1e3a8a', label: '恒牙已长出' },
};

const HEALTH_STYLE: Record<HealthState, { bg: string; text: string; label: string }> = {
  healthy: { bg: '#ffffff', text: '', label: '健康' },
  caries: { bg: '#fecaca', text: '#b91c1c', label: '龋齿' },
  treated: { bg: '#e9d5ff', text: '#6b21a8', label: '已治疗' },
};

const OVERVIEW_UPPER_R = ['18', '17', '16', '55', '54', '53', '52', '51'];
const OVERVIEW_UPPER_L = ['61', '62', '63', '64', '65', '26', '27', '28'];
const OVERVIEW_LOWER_L = ['71', '72', '73', '74', '75', '36', '37', '38'];
const OVERVIEW_LOWER_R = ['48', '47', '46', '85', '84', '83', '82', '81'];

export function ToothStatusOverview({ records }: { records: DentalRecordRow[] }) {
  const states = useMemo(() => computeDentalOverviewStates(records), [records]);
  const counts = useMemo(() => {
    const eruption: Record<EruptionState, number> = {
      unerupted: 0,
      primary_present: 0,
      lost_waiting: 0,
      permanent_erupted: 0,
    };
    const health: Record<HealthState, number> = { healthy: 0, caries: 0, treated: 0 };
    for (const cell of states.values()) {
      eruption[cell.eruption]++;
      health[cell.health]++;
    }
    return { eruption, health };
  }, [states]);

  const renderRow = (positions: string[]) => (
    <div className="flex gap-1">
      {positions.map((positionId) => {
        const cell = states.get(positionId) ?? { eruption: 'unerupted', health: 'healthy', displayId: positionId };
        const eruption = ERUPTION_STYLE[cell.eruption];
        const health = HEALTH_STYLE[cell.health];
        const textColor = health.text || eruption.text;
        const title = `${cell.displayId} ${TOOTH_NAMES[cell.displayId] ?? ''} · ${eruption.label}${cell.health !== 'healthy' ? ` · ${health.label}` : ''}`;
        return (
          <div
            key={positionId}
            title={title}
            className="flex h-8 w-7 items-center justify-center text-[10px] font-bold"
            style={{
              background: health.bg,
              color: textColor,
              border: `2px solid ${eruption.border}`,
              borderRadius: '8px',
              boxSizing: 'border-box',
            }}
          >
            {cell.displayId}
          </div>
        );
      })}
    </div>
  );

  const legendChip = (swatchStyle: CSSProperties, label: string, count: number) => (
    <span key={label} className="flex items-center gap-1 text-[10px]" style={{ color: S.sub }}>
      <span className="h-3 w-3" style={{ borderRadius: 3, ...swatchStyle }} />
      {label} <span className="font-semibold" style={{ color: S.text }}>{count}</span>
    </span>
  );

  return (
    <div className={`${S.radius} mb-5 p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[15px]">🦷</span>
        <p className="text-[13px] font-semibold" style={{ color: S.text }}>牙齿状态总览</p>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-1.5 ${S.radiusSm}`} style={{ background: '#fafaf8' }}>
          <span className="inline-flex shrink-0 items-center gap-1.5 leading-none">
            <span className="text-[9px] font-semibold tracking-[0.12em]" style={{ color: S.sub }}>边框</span>
            <span className="h-3 w-px" style={{ background: S.border }} />
            <span className="text-[11px] font-semibold" style={{ color: S.text }}>萌出</span>
          </span>
          {(['primary_present', 'lost_waiting', 'permanent_erupted', 'unerupted'] as EruptionState[]).map((state) =>
            legendChip(
              { background: '#fff', border: `2px solid ${ERUPTION_STYLE[state].border}`, boxSizing: 'border-box' },
              ERUPTION_STYLE[state].label,
              counts.eruption[state],
            ),
          )}
        </div>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-1.5 ${S.radiusSm}`} style={{ background: '#fafaf8' }}>
          <span className="inline-flex shrink-0 items-center gap-1.5 leading-none">
            <span className="text-[9px] font-semibold tracking-[0.12em]" style={{ color: S.sub }}>填充</span>
            <span className="h-3 w-px" style={{ background: S.border }} />
            <span className="text-[11px] font-semibold" style={{ color: S.text }}>健康</span>
          </span>
          {(['healthy', 'caries', 'treated'] as HealthState[]).map((state) =>
            legendChip(
              { background: HEALTH_STYLE[state].bg, border: state === 'healthy' ? '1px solid #e5e7eb' : 'none' },
              HEALTH_STYLE[state].label,
              counts.health[state],
            ),
          )}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[9px]" style={{ color: S.sub }}>上颌</p>
        <div className="flex items-center gap-1.5">
          <span className="w-4 text-right text-[9px]" style={{ color: S.sub }}>右</span>
          {renderRow(OVERVIEW_UPPER_R)}
          <span className="w-2" />
          {renderRow(OVERVIEW_UPPER_L)}
          <span className="w-4 text-[9px]" style={{ color: S.sub }}>左</span>
        </div>
        <div className="my-1 h-px w-full" style={{ background: S.border }} />
        <div className="flex items-center gap-1.5">
          <span className="w-4 text-right text-[9px]" style={{ color: S.sub }}>右</span>
          {renderRow(OVERVIEW_LOWER_R)}
          <span className="w-2" />
          {renderRow(OVERVIEW_LOWER_L)}
          <span className="w-4 text-[9px]" style={{ color: S.sub }}>左</span>
        </div>
        <p className="text-[9px]" style={{ color: S.sub }}>下颌</p>
      </div>
      <p className="mt-3 text-center text-[10px]" style={{ color: S.sub }}>
        共 32 位：20 颗乳牙位 + 12 颗恒牙磨牙/智齿位 · 鼠标悬停查看牙位详情
      </p>
    </div>
  );
}
