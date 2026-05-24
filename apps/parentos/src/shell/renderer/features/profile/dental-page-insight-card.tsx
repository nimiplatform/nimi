import { Surface } from '@nimiplatform/kit/ui';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import {
  computeDentalOverviewStates,
  parseDentalToothIds,
} from './dental-page-domain.js';

interface DentalInsightCardProps {
  childName: string;
  ageLabel: string;
  records: DentalRecordRow[];
}

type ChipTone = 'warn' | 'info' | 'ok' | 'alert';

interface Chip {
  label: string;
  tone: ChipTone;
}

const CHIP_CLASSES: Record<ChipTone, { chip: string; dot: string }> = {
  warn: {
    chip: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-[var(--nimi-status-warning)]',
    dot: 'bg-[var(--nimi-status-warning)]',
  },
  info: {
    chip: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_15%,transparent)] text-[var(--nimi-status-info)]',
    dot: 'bg-[var(--nimi-status-info)]',
  },
  ok: {
    chip: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-[var(--nimi-status-success)]',
    dot: 'bg-[var(--nimi-status-success)]',
  },
  alert: {
    chip: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_15%,transparent)] text-[var(--nimi-status-danger)]',
    dot: 'bg-[var(--nimi-status-danger)]',
  },
};

const CN_MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

function isPermanentId(id: string): boolean {
  const n = Number(id);
  return Number.isFinite(n) && ((n >= 11 && n <= 18) || (n >= 21 && n <= 28) || (n >= 31 && n <= 38) || (n >= 41 && n <= 48));
}

export function DentalInsightCard({ childName, ageLabel, records }: DentalInsightCardProps) {
  const stats = useMemo(() => {
    const eruptedToothIds = new Set(
      records.filter((r) => r.eventType === 'eruption').flatMap((r) => parseDentalToothIds(r.toothId)),
    );
    const permanentPresent = [...eruptedToothIds].filter(isPermanentId).length;
    const primaryPresent = eruptedToothIds.size - permanentPresent;
    const cariesCount = records.filter((r) => r.eventType === 'caries').length;

    const states = computeDentalOverviewStates(records);
    let concernPosition: string | null = null;
    for (const [pid, cell] of states.entries()) {
      if (cell.eruption === 'lost_waiting') { concernPosition = pid; break; }
    }
    if (!concernPosition) {
      for (const [pid, cell] of states.entries()) {
        if (cell.health === 'caries') { concernPosition = pid; break; }
      }
    }

    const latestCheckup = records
      .filter((r) => r.eventType === 'checkup' || r.eventType === 'ortho-assessment' || r.eventType === 'cleaning')
      .map((r) => r.eventDate)
      .sort()
      .at(-1);
    const nextCheckDate = (() => {
      const base = latestCheckup ? new Date(latestCheckup) : new Date();
      base.setMonth(base.getMonth() + 6);
      return base;
    })();

    const hasCleaning = records.some((r) => r.eventType === 'cleaning');
    const hasFluoride = records.some((r) => r.eventType === 'fluoride');

    return {
      eruptedCount: eruptedToothIds.size,
      permanentPresent,
      primaryPresent,
      cariesCount,
      concernPosition,
      concernKind:
        concernPosition && states.get(concernPosition)?.health === 'caries' ? 'caries' :
        concernPosition ? 'lost_waiting' : null,
      nextCheckMonth: nextCheckDate.getMonth() + 1,
      hasCleaning,
      hasFluoride,
      totalRecords: records.length,
    } as const;
  }, [records]);

  const chips: Chip[] = [];
  if (stats.concernPosition && stats.concernKind === 'lost_waiting') {
    chips.push({ label: `关注 ${stats.concernPosition} 号牙 · 已脱落待恒牙`, tone: 'warn' });
  } else if (stats.concernPosition && stats.concernKind === 'caries') {
    chips.push({ label: `关注 ${stats.concernPosition} 号牙 · 龋齿`, tone: 'alert' });
  } else if (stats.eruptedCount > 0) {
    chips.push({ label: '整体状态平稳', tone: 'ok' });
  }
  chips.push({ label: `下次检查 · 建议 ${CN_MONTHS[stats.nextCheckMonth - 1]} 月`, tone: 'info' });
  chips.push({
    label: stats.hasCleaning ? '维持扫牙习惯' : stats.hasFluoride ? '保持涂氟节奏' : '建议养成扫牙习惯',
    tone: 'ok',
  });

  const paragraph1: ReactNode = stats.eruptedCount === 0 ? (
    <>尚未记录萌出信息，补充记录后可生成更完整的口腔发育画像。</>
  ) : (
    <>
      {childName} 在 {ageLabel} 时已萌出 <strong className="font-semibold">{stats.eruptedCount} 颗牙</strong>，
      其中恒牙 <strong className="font-semibold">{stats.permanentPresent}</strong> 颗、
      乳牙 <strong className="font-semibold">{stats.primaryPresent}</strong> 颗在位。
    </>
  );

  const paragraph2: ReactNode = stats.cariesCount > 0 ? (
    <>
      当前龋齿 <strong className="font-semibold">{stats.cariesCount}</strong> 处，
      建议<strong className="font-semibold">及时随访治疗</strong>。
    </>
  ) : (
    <>
      龋齿情况为 <strong className="font-semibold">0</strong>，
      口腔整体发育处于 <strong className="font-semibold">正常范围</strong>。
    </>
  );

  return (
    <Surface
      as="section"
      tone="card"
      material="glass-thick"
      elevation="raised"
      padding="lg"
      className="mb-5 relative overflow-hidden rounded-3xl"
    >
      <div className="relative mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex text-[var(--nimi-action-primary-bg)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5z" />
              <path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
            </svg>
          </span>
          <span className="text-[12px] font-semibold tracking-normal text-[var(--nimi-text-primary)]">AI 观察</span>
          <span className="text-[11px] text-[var(--nimi-text-muted)]">
            基于 <span className="font-mono">{stats.totalRecords}</span> 条记录 · {ageLabel}
          </span>
        </div>
      </div>

      <p className="relative mb-1.5 mt-1 text-[14px] leading-7 tracking-normal text-[var(--nimi-text-primary)]">
        {paragraph1}
      </p>
      <p className="relative mb-3.5 mt-0 text-[14px] leading-7 tracking-normal text-[var(--nimi-text-primary)]">
        {paragraph2}
      </p>

      <div className="relative flex flex-wrap gap-2">
        {chips.map((c, i) => {
          const classes = CHIP_CLASSES[c.tone];
          return (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium ${classes.chip}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${classes.dot}`} />
              {c.label}
            </div>
          );
        })}
      </div>
    </Surface>
  );
}
