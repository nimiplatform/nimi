import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import {
  computeDentalOverviewStates,
  type EruptionState,
  type HealthState,
  TOOTH_NAMES,
} from './dental-page-domain.js';

type StatusKey = 'unerupted' | 'primary' | 'erupting' | 'permanent' | 'caries' | 'treated';

const STATUS_META: Record<StatusKey, { label: string; dot: string; ring: string; fill: string; fg: string }> = {
  permanent: { label: '恒牙已长出', dot: '#6366f1', ring: 'rgba(99,102,241,0.45)',  fill: 'rgba(99,102,241,0.10)', fg: '#4338ca' },
  primary:   { label: '乳牙在位',   dot: '#38bdf8', ring: 'rgba(56,189,248,0.45)',  fill: 'rgba(56,189,248,0.10)', fg: '#0369a1' },
  erupting:  { label: '已脱落·待恒牙', dot: '#f59e0b', ring: 'rgba(245,158,11,0.55)', fill: 'rgba(245,158,11,0.14)', fg: '#b45309' },
  caries:    { label: '龋齿',      dot: '#ec4899', ring: 'rgba(236,72,153,0.45)',  fill: 'rgba(236,72,153,0.10)', fg: '#be185d' },
  treated:   { label: '已治疗',    dot: '#10b981', ring: 'rgba(16,185,129,0.45)',  fill: 'rgba(16,185,129,0.10)', fg: '#047857' },
  unerupted: { label: '未萌出',    dot: '#cbd5e1', ring: 'rgba(148,163,184,0.35)', fill: 'transparent',            fg: '#94a3b8' },
};

const LEGEND_ORDER: StatusKey[] = ['permanent', 'primary', 'erupting', 'caries', 'treated', 'unerupted'];

const OVERVIEW_UPPER_R = ['18', '17', '16', '55', '54', '53', '52', '51'];
const OVERVIEW_UPPER_L = ['61', '62', '63', '64', '65', '26', '27', '28'];
const OVERVIEW_LOWER_L = ['71', '72', '73', '74', '75', '36', '37', '38'];
const OVERVIEW_LOWER_R = ['48', '47', '46', '85', '84', '83', '82', '81'];

const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

function collapseStatus(eruption: EruptionState, health: HealthState): StatusKey {
  if (health === 'caries') return 'caries';
  if (health === 'treated') return 'treated';
  if (eruption === 'permanent_erupted') return 'permanent';
  if (eruption === 'primary_present') return 'primary';
  if (eruption === 'lost_waiting') return 'erupting';
  return 'unerupted';
}

function isPrimaryPosition(positionId: string): boolean {
  const n = Number(positionId);
  return n >= 51 && n <= 85;
}

export function ToothStatusOverview({ records }: { records: DentalRecordRow[] }) {
  const states = useMemo(() => computeDentalOverviewStates(records), [records]);
  const [hovered, setHovered] = useState<string | null>(null);

  const statusByPosition = useMemo(() => {
    const map = new Map<string, { status: StatusKey; displayId: string }>();
    for (const [positionId, cell] of states.entries()) {
      map.set(positionId, { status: collapseStatus(cell.eruption, cell.health), displayId: cell.displayId });
    }
    return map;
  }, [states]);

  const counts = useMemo(() => {
    const base: Record<StatusKey, number> = {
      permanent: 0, primary: 0, erupting: 0, caries: 0, treated: 0, unerupted: 0,
    };
    for (const { status } of statusByPosition.values()) base[status]++;
    return base;
  }, [statusByPosition]);

  const hoverInfo = (() => {
    if (!hovered) return null;
    const entry = statusByPosition.get(hovered);
    if (!entry) return null;
    const meta = STATUS_META[entry.status];
    const name = TOOTH_NAMES[entry.displayId] ?? '';
    return { displayId: entry.displayId, label: meta.label, color: meta.dot, name };
  })();

  const renderTooth = (positionId: string) => {
    const entry = statusByPosition.get(positionId) ?? { status: 'unerupted' as StatusKey, displayId: positionId };
    const meta = STATUS_META[entry.status];
    const isHovered = hovered === positionId;
    const isPrimary = isPrimaryPosition(positionId);
    const title = `${entry.displayId}${TOOTH_NAMES[entry.displayId] ? ` ${TOOTH_NAMES[entry.displayId]}` : ''} · ${meta.label}`;
    const cellStyle: CSSProperties = {
      position: 'relative',
      width: '100%',
      aspectRatio: '34 / 40',
      borderRadius: 9,
      border: `1.5px solid ${meta.ring}`,
      background: isHovered ? '#ffffff' : meta.fill || '#ffffff',
      color: meta.fg,
      fontFamily: MONO,
      fontSize: 11,
      fontWeight: 600,
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer',
      boxShadow: isHovered
        ? '0 4px 12px rgba(15,23,42,0.10)'
        : entry.status === 'unerupted'
          ? 'none'
          : '0 1px 2px rgba(15,23,42,0.04)',
      transition: 'all 160ms',
      outline: isHovered ? `2px solid ${S.accent}` : 'none',
      outlineOffset: 2,
    };
    return (
      <button
        key={positionId}
        type="button"
        title={title}
        onMouseEnter={() => setHovered(positionId)}
        onMouseLeave={() => setHovered((cur) => (cur === positionId ? null : cur))}
        onFocus={() => setHovered(positionId)}
        onBlur={() => setHovered((cur) => (cur === positionId ? null : cur))}
        style={cellStyle}
      >
        <span style={{ opacity: entry.status === 'unerupted' ? 0.55 : 1 }}>{entry.displayId}</span>
        {isPrimary && entry.status !== 'unerupted' && (
          <span
            style={{
              position: 'absolute',
              top: 3,
              right: 4,
              width: 4,
              height: 4,
              borderRadius: 999,
              background: meta.dot,
            }}
          />
        )}
      </button>
    );
  };

  const renderRow = (leftIds: string[], rightIds: string[]) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: '#94a3b8', width: 12, textAlign: 'center', flexShrink: 0 }}>右</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 4, flex: 1, minWidth: 0 }}>
        {leftIds.map(renderTooth)}
      </div>
      <div style={{ width: 10, height: 1, background: 'var(--nimi-border-subtle, rgba(226,232,240,0.9))', flexShrink: 0 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 4, flex: 1, minWidth: 0 }}>
        {rightIds.map(renderTooth)}
      </div>
      <span style={{ fontSize: 11, color: '#94a3b8', width: 12, textAlign: 'center', flexShrink: 0 }}>左</span>
    </div>
  );

  return (
    <section
      className="mb-5"
      style={{
        background: S.card,
        padding: 20,
        borderRadius: 24,
        boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 10px 28px rgba(15,23,42,0.06)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(78,204,163,0.16)',
              color: '#053D2C',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3c-3 0-5 1.5-6 1.5S4 3.8 3.5 5.5C3 7.2 3.7 10 4.5 12c.4 1 .5 2 .7 3.5.2 1.4.4 3 .9 4.2.4 1 1 1.3 1.5 1.3.8 0 1-1 1.2-2.2.2-1.2.4-2.8.9-3.2.3-.3 2.3-.3 2.6 0 .5.4.7 2 .9 3.2.2 1.2.4 2.2 1.2 2.2.5 0 1.1-.3 1.5-1.3.5-1.2.7-2.8.9-4.2.2-1.5.3-2.5.7-3.5.8-2 1.5-4.8 1-6.5-.5-1.7-1.5-1-2.5-1S15 3 12 3z" />
            </svg>
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: S.text }}>牙齿状态总览</h3>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', fontFamily: MONO }}>
          共 32 位 · 20 乳牙 + 12 恒牙
        </div>
      </div>

      <div style={{ padding: '0 0 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            上颌 · Upper
          </div>
          {renderRow(OVERVIEW_UPPER_R, OVERVIEW_UPPER_L)}
          <div
            style={{
              height: 1,
              background: 'linear-gradient(to right, transparent, rgba(226,232,240,0.9) 20%, rgba(226,232,240,0.9) 80%, transparent)',
              margin: '4px 0',
            }}
          />
          {renderRow(OVERVIEW_LOWER_R, OVERVIEW_LOWER_L)}
          <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            下颌 · Lower
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 4,
          paddingTop: 16,
          borderTop: '1px solid var(--nimi-border-subtle, rgba(226,232,240,0.9))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {LEGEND_ORDER.map((key) => {
            const meta = STATUS_META[key];
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#334155' }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: meta.dot,
                    boxShadow: `0 0 0 2px ${meta.fill || 'rgba(148,163,184,0.15)'}`,
                  }}
                />
                <span>{meta.label}</span>
                <span style={{ color: '#94a3b8', fontFamily: MONO }}>{counts[key]}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', minHeight: 16 }}>
          {hoverInfo ? (
            <span>
              <span style={{ fontFamily: MONO, color: hoverInfo.color, fontWeight: 600 }}>#{hoverInfo.displayId}</span>
              {hoverInfo.name && <span style={{ color: '#475569' }}> · {hoverInfo.name}</span>}
              <span> · {hoverInfo.label}</span>
            </span>
          ) : (
            <span style={{ color: '#94a3b8' }}>鼠标悬停查看牙位详情</span>
          )}
        </div>
      </div>
    </section>
  );
}
