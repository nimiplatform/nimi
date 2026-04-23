import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import {
  computeDentalOverviewStates,
  parseDentalToothIds,
} from './dental-page-domain.js';

const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

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

const CHIP_COLORS: Record<ChipTone, { bg: string; fg: string; dot: string }> = {
  warn:  { bg: 'rgba(245,158,11,0.14)', fg: '#b45309', dot: '#f59e0b' },
  info:  { bg: 'rgba(99,102,241,0.12)', fg: '#4338ca', dot: '#6366f1' },
  ok:    { bg: 'rgba(78,204,163,0.16)', fg: '#053D2C', dot: '#10b981' },
  alert: { bg: 'rgba(236,72,153,0.14)', fg: '#be185d', dot: '#ec4899' },
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
      {childName} 在 {ageLabel} 时已萌出 <strong style={{ fontWeight: 600 }}>{stats.eruptedCount} 颗牙</strong>，
      其中恒牙 <strong style={{ fontWeight: 600 }}>{stats.permanentPresent}</strong> 颗、
      乳牙 <strong style={{ fontWeight: 600 }}>{stats.primaryPresent}</strong> 颗在位。
    </>
  );

  const paragraph2: ReactNode = stats.cariesCount > 0 ? (
    <>
      当前龋齿 <strong style={{ fontWeight: 600 }}>{stats.cariesCount}</strong> 处，
      建议<strong style={{ fontWeight: 600 }}>及时随访治疗</strong>。
    </>
  ) : (
    <>
      龋齿情况为 <strong style={{ fontWeight: 600 }}>0</strong>，
      口腔整体发育处于 <strong style={{ fontWeight: 600 }}>正常范围</strong>。
    </>
  );

  return (
    <section
      className="mb-5"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--nimi-material-glass-thick-bg, rgba(255,255,255,0.70))',
        border: '1px solid var(--nimi-material-glass-thick-border, rgba(226,232,240,0.40))',
        backdropFilter: 'blur(var(--nimi-backdrop-blur-strong, 24px))',
        WebkitBackdropFilter: 'blur(var(--nimi-backdrop-blur-strong, 24px))',
        padding: 22,
        borderRadius: 24,
        boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 14px 40px rgba(15,23,42,0.08)',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -60,
          right: -40,
          width: 240,
          height: 240,
          background: 'radial-gradient(circle, rgba(78,204,163,0.18), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: S.accent, display: 'inline-flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5z" />
              <path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
            </svg>
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: S.text, letterSpacing: '0.01em' }}>AI 观察</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            基于 <span style={{ fontFamily: MONO }}>{stats.totalRecords}</span> 条记录 · {ageLabel}
          </span>
        </div>
      </div>

      <p style={{ position: 'relative', margin: '4px 0 6px', fontSize: 14, lineHeight: 1.75, color: S.text, letterSpacing: '0.005em' }}>
        {paragraph1}
      </p>
      <p style={{ position: 'relative', margin: '0 0 14px', fontSize: 14, lineHeight: 1.75, color: S.text, letterSpacing: '0.005em' }}>
        {paragraph2}
      </p>

      <div style={{ position: 'relative', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {chips.map((c, i) => {
          const colors = CHIP_COLORS[c.tone];
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: 999,
                background: colors.bg,
                color: colors.fg,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: colors.dot, flexShrink: 0 }} />
              {c.label}
            </div>
          );
        })}
      </div>
    </section>
  );
}
