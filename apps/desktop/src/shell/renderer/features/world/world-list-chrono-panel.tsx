import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldComputedTime, WorldListItem } from './world-list-model';

function resolveProjectedWorldDate(
  time: WorldComputedTime,
  anchorNowMs: number,
  nowMs: number,
): Date | null {
  if (!time.currentWorldTime) {
    return null;
  }
  const anchor = new Date(time.currentWorldTime);
  if (Number.isNaN(anchor.getTime())) {
    return null;
  }
  if (time.isPaused) {
    return anchor;
  }
  const elapsedClientMs = Math.max(0, nowMs - anchorNowMs);
  return new Date(anchor.getTime() + elapsedClientMs * Math.max(0.0001, time.flowRatio));
}

function formatProjectedWorldDate(worldDate: Date | null): string {
  if (!worldDate || Number.isNaN(worldDate.getTime())) {
    return 'N/A';
  }
  return `${worldDate.getUTCFullYear()}-${String(worldDate.getUTCMonth() + 1).padStart(2, '0')}-${String(worldDate.getUTCDate()).padStart(2, '0')} ${String(worldDate.getUTCHours()).padStart(2, '0')}:${String(worldDate.getUTCMinutes()).padStart(2, '0')}:${String(worldDate.getUTCSeconds()).padStart(2, '0')}`;
}

type WorldChronoPanelState = {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  flowRatio: number;
  compactDateLabel: string;
  progress: number;
};

function resolveWorldChronoPanelState(
  world: WorldListItem,
  anchorNowMs: number,
  nowMs: number,
): WorldChronoPanelState | null {
  const flowRatio = Math.max(0.0001, world.computed.time.flowRatio);
  const worldDate = resolveProjectedWorldDate(world.computed.time, anchorNowMs, nowMs);
  if (!worldDate) {
    return null;
  }
  const hour = worldDate.getUTCHours();
  const minute = worldDate.getUTCMinutes();
  const second = worldDate.getUTCSeconds();
  const millisecond = worldDate.getUTCMilliseconds();

  return {
    hour,
    minute,
    second,
    millisecond,
    flowRatio,
    compactDateLabel: world.computed.time.currentLabel || formatProjectedWorldDate(worldDate),
    progress: Math.max(8, Math.min(100, (Math.log10(flowRatio + 1) / Math.log10(1000 + 1)) * 100)),
  };
}

export function WorldChronoPanel({ world, compact = false }: { world: WorldListItem; compact?: boolean }) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anchorNowMsRef = useRef(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 80);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const chrono = resolveWorldChronoPanelState(world, anchorNowMsRef.current, nowMs);
  if (!chrono) {
    return null;
  }

  const flowPulse = (chrono.millisecond / 999) * 48;
  const flowWidth = Math.min(100, Math.max(18, chrono.progress * 0.42 + flowPulse));

  return (
    <div
      className={`${compact ? 'min-w-[150px] max-w-[180px] px-3 py-2.5' : 'min-w-[300px] max-w-[340px] px-6 py-5'} rounded-[16px] text-white`}
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        boxShadow: 'none',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className={`${compact ? 'text-[7px]' : 'text-[10px]'} uppercase tracking-[0.2em] text-[#56D3B2]/85`}>
          {t('World.syncTicker')}
        </span>
        <span
          className={`text-right ${compact ? 'text-[10px]' : 'text-[13px]'} font-medium tracking-[0.08em] text-white/92`}
          style={{ textShadow: '1.5px 0 rgba(255,0,255,0.55), -1px 0 rgba(86,211,178,0.8)' }}
        >
          {chrono.compactDateLabel}
        </span>
      </div>

      <div className={`${compact ? 'mt-1.5' : 'mt-3'} flex items-end text-white`}>
        <div className={`font-mono ${compact ? 'text-[18px]' : 'text-[38px]'} font-black leading-none tracking-[-0.04em]`}>
          {String(chrono.hour).padStart(2, '0')}:{String(chrono.minute).padStart(2, '0')}
        </div>
        <div className={`${compact ? 'ml-1.5' : 'ml-3'} flex flex-col pb-0.5`}>
          <span className={`${compact ? 'text-[11px]' : 'text-lg'} leading-none text-[#56D3B2]`}>:{String(chrono.second).padStart(2, '0')}</span>
          <span className={`${compact ? 'mt-0.5 text-[8px]' : 'mt-1 text-[11px]'} font-mono leading-none text-fuchsia-300/80`}>
            {String(chrono.millisecond).padStart(3, '0')}
          </span>
        </div>
      </div>

      <div className={`${compact ? 'mt-2' : 'mt-4'}`}>
        <span className={`mb-1.5 block ${compact ? 'text-[7px]' : 'text-[9px]'} uppercase tracking-[0.16em] text-[#8EF0D8]`}>
          {t('World.chronoFlow', { value: chrono.flowRatio.toFixed(1) })}
        </span>
        <div className="relative h-[2px] overflow-hidden bg-white/10">
          <div
            className="absolute inset-y-0 left-0 bg-[#56D3B2] shadow-[0_0_10px_rgba(86,211,178,0.9)]"
            style={{ width: `${flowWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
}
