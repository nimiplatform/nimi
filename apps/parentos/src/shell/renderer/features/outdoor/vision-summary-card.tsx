import { Surface } from '@nimiplatform/kit/ui';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMeasurements, type MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { EYE_SET, fmtAge, groupByDate } from '../profile/vision-data.js';

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO);
  const b = new Date(toISO);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

function formatElapsed(days: number): string {
  if (days <= 1) return '今天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.round(days / 30)} 个月前`;
  return `${Math.round(days / 365)} 年前`;
}

/**
 * Compact link-card shown on the outdoor page. Closes the narrative loop:
 * outdoor time feeds into myopia prevention, so the user sees the latest
 * vision exam snapshot and can jump to the full vision record.
 */
export function VisionSummaryCard({ childId }: { childId: string }) {
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);

  useEffect(() => {
    getMeasurements(childId)
      .then(setMeasurements)
      .catch(catchLog('outdoor', 'action:load-vision-measurements-failed'));
  }, [childId]);

  const latestRecord = useMemo(() => {
    const records = groupByDate(measurements.filter((m) => EYE_SET.has(m.typeId)));
    return records[0] ?? null;
  }, [measurements]);

  const todayISO = new Date().toISOString().slice(0, 10);

  if (!latestRecord) {
    return (
      <Surface
        as={Link}
        to="/profile"
        data-testid="outdoor-vision-summary"
        tone="card"
        material="glass-regular"
        elevation="base"
        padding="md"
        interactive
        className="mb-6 block no-underline"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">视力档案</span>
            <span className="text-[12px] text-[var(--nimi-text-muted)]">尚无检查记录</span>
          </div>
          <span className="text-[13px] text-[var(--nimi-text-muted)]">录入 →</span>
        </div>
      </Surface>
    );
  }

  const vr = latestRecord.data.get('vision-right');
  const vl = latestRecord.data.get('vision-left');
  const ar = latestRecord.data.get('axial-length-right');
  const al = latestRecord.data.get('axial-length-left');
  const elapsed = formatElapsed(daysBetween(latestRecord.date, todayISO));

  const hasVision = vr != null || vl != null;
  const hasAxial = ar != null || al != null;

  return (
    <Surface
      as={Link}
      to="/profile"
      data-testid="outdoor-vision-summary"
      tone="card"
      material="glass-regular"
      elevation="base"
      padding="md"
      interactive
      className="mb-6 block no-underline"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">最近一次视力检查</span>
          <span className="text-[12px] text-[var(--nimi-text-muted)]">{latestRecord.date} · {elapsed}</span>
        </div>
        <span className="text-[13px] text-[var(--nimi-text-muted)]">查看档案 →</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {hasVision && (
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] text-[var(--nimi-text-muted)]">裸眼</span>
            <span className="text-[16px] font-bold tabular-nums text-[var(--nimi-text-primary)]">
              R {vr ?? '—'} · L {vl ?? '—'}
            </span>
          </div>
        )}
        {hasAxial && (
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] text-[var(--nimi-text-muted)]">眼轴</span>
            <span className="text-[16px] font-bold tabular-nums text-[var(--nimi-text-primary)]">
              R {ar != null ? `${ar}mm` : '—'} · L {al != null ? `${al}mm` : '—'}
            </span>
          </div>
        )}
        <span className="ml-auto text-[12px] text-[var(--nimi-text-muted)]">{fmtAge(latestRecord.ageMonths)}</span>
      </div>
    </Surface>
  );
}
