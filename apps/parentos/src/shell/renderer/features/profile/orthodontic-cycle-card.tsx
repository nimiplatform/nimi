import { useMemo } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import {
  insertOrthodonticCheckin,
  type OrthodonticApplianceRow,
  type OrthodonticCheckinRow,
  type OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { computeCycleProgress, formatHours } from './orthodontic-derive.js';

interface Props {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  alignerChangeCheckins: OrthodonticCheckinRow[];
  nowIso: string;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}

/**
 * Per-cycle progress card (clear-aligner only). Shows:
 *  - Big "第 N / 共 M 副" + circular progress (净戴 / 目标小时数)
 *  - Predicted switch date with shifted-days callout
 *  - "换下一副" main action (disabled when totalAligners reached)
 *
 * Other removable types render their cycle metric in the Today card; this
 * component is mounted only for clear-aligner appliances.
 */
export function OrthodonticCycleCard({
  appliance,
  intervals,
  alignerChangeCheckins,
  nowIso,
  onChanged,
  onError,
}: Props) {
  const cycle = useMemo(
    () =>
      computeCycleProgress({
        appliance,
        intervals,
        alignerChangeCheckins,
        nowIso,
      }),
    [appliance, intervals, alignerChangeCheckins, nowIso],
  );

  const total = appliance.totalAligners;
  const canSwitch =
    appliance.status === 'active' &&
    (total === null || cycle.currentAlignerIndex < total);

  const handleSwitch = async () => {
    const nextIndex = cycle.currentAlignerIndex + 1;
    if (total !== null && nextIndex > total) {
      onError(`已达到处方总副数 ${total}；无法继续更换`);
      return;
    }
    const input = window.prompt(
      `请输入本次更换后的牙套序号（默认 ${nextIndex}）`,
      String(nextIndex),
    );
    if (input === null) return;
    const alignerIndex = Number(input.trim());
    if (!Number.isInteger(alignerIndex) || alignerIndex < 1) {
      onError('牙套序号必须为大于等于 1 的整数');
      return;
    }
    if (total !== null && alignerIndex > total) {
      onError(`牙套序号不能超过处方总副数 ${total}`);
      return;
    }
    onError(null);
    try {
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId: appliance.childId,
        caseId: appliance.caseId,
        applianceId: appliance.applianceId,
        checkinType: 'aligner-change',
        checkinDate: nowIso.slice(0, 10),
        activationIndex: null,
        alignerIndex,
        notes: null,
        now: isoNow(),
      });
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:aligner-change-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const ratioPct = Math.min(100, Math.round(cycle.cycleProgressRatio * 100));
  const switchDateLabel = cycle.predictedSwitchDate.slice(0, 10);
  const shiftedLabel = (() => {
    if (cycle.daysShifted > 0) return `推后 ${cycle.daysShifted} 天`;
    if (cycle.daysShifted < 0) return `提前 ${-cycle.daysShifted} 天`;
    return '按计划';
  })();

  return (
    <Surface
      as="section"
      material="solid"
      padding="none"
      tone="card"
      className="rounded-[20px] p-6"
      style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}
    >
      <p className="text-[12px] uppercase tracking-[0.08em]" style={{ color: S.sub }}>
        本副节奏
      </p>
      <div className="mt-2 flex items-center gap-6 flex-wrap">
        <ProgressRing ratio={cycle.cycleProgressRatio} label={`${ratioPct}%`} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[20px] font-semibold" style={{ color: S.text }}>
            第 {cycle.currentAlignerIndex}
            {total !== null ? ` / 共 ${total} 副` : ''}
          </h3>
          <p className="mt-1.5 text-[14px]" style={{ color: S.sub }}>
            本副已净戴 <strong style={{ color: S.text }}>{formatHours(cycle.cycleNetWearHours)}</strong> /
            共 {formatHours(cycle.cycleTargetHours)}
          </p>
          {cycle.cycleGapHours > 0 && (
            <p className="mt-1 text-[13px]" style={{ color: S.sub }}>
              本副累计未戴 {formatHours(cycle.cycleGapHours)}
            </p>
          )}
          <p className="mt-2 text-[13px]" style={{ color: S.sub }}>
            下次换套预计 <strong style={{ color: S.text }}>{switchDateLabel}</strong>（{shiftedLabel}）
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSwitch()}
          disabled={!canSwitch}
          className="text-[14px] font-semibold px-4 py-2 rounded-full"
          style={{
            background: canSwitch ? '#eef2f6' : '#f1f5f9',
            color: canSwitch ? S.text : '#94a3b8',
            border: '1px solid rgba(226,232,240,0.9)',
            cursor: canSwitch ? 'pointer' : 'not-allowed',
          }}
        >
          换下一副
        </button>
      </div>
    </Surface>
  );
}

interface RingProps {
  ratio: number;
  label: string;
}

function ProgressRing({ ratio, label }: RingProps) {
  const size = 84;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, ratio));
  const dashOffset = circumference * (1 - clamped);
  return (
    <div style={{ position: 'relative', width: size, height: size }} aria-label={`本副进度 ${label}`}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(226,232,240,0.7)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#nimi-cycle-gradient)"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <defs>
          <linearGradient id="nimi-cycle-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4ECCA3" />
            <stop offset="100%" stopColor="#818CF8" />
          </linearGradient>
        </defs>
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-[14px] font-semibold"
        style={{ color: S.text }}
      >
        {label}
      </div>
    </div>
  );
}
