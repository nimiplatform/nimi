import { Surface } from '@nimiplatform/nimi-kit/ui';
import { useMemo, useState } from 'react';
import type { DentalRecordRow } from '../../bridge/sqlite-bridge.js';
import {
  computeDentalOverviewStates,
  type EruptionState,
  type HealthState,
  TOOTH_NAMES,
} from './dental-page-domain.js';

type StatusKey = 'primary' | 'permanent' | 'lost' | 'caries' | 'treated';

const STATUS_META: Record<StatusKey, { label: string; dotClass: string; cellClass: string; textClass: string }> = {
  permanent: {
    label: '恒牙',
    dotClass: 'bg-[var(--nimi-status-info)] ring-[color-mix(in_srgb,var(--nimi-status-info)_18%,transparent)]',
    cellClass: 'border-[color-mix(in_srgb,var(--nimi-status-info)_42%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]',
    textClass: 'text-[var(--nimi-status-info)]',
  },
  primary: {
    label: '乳牙',
    dotClass: 'bg-[var(--nimi-action-primary-bg)] ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]',
    cellClass: 'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_42%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]',
    textClass: 'text-[var(--nimi-action-primary-bg)]',
  },
  lost: {
    label: '已脱落',
    dotClass: 'bg-[var(--nimi-text-muted)] ring-[color-mix(in_srgb,var(--nimi-text-muted)_18%,transparent)]',
    cellClass: 'border-[color-mix(in_srgb,var(--nimi-text-muted)_36%,var(--nimi-border-subtle))] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]',
    textClass: 'text-[var(--nimi-text-muted)]',
  },
  caries: {
    label: '龋齿',
    dotClass: 'bg-[var(--nimi-status-danger)] ring-[color-mix(in_srgb,var(--nimi-status-danger)_18%,transparent)]',
    cellClass: 'border-[color-mix(in_srgb,var(--nimi-status-danger)_36%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-danger)]',
    textClass: 'text-[var(--nimi-status-danger)]',
  },
  treated: {
    label: '已治疗',
    dotClass: 'bg-[var(--nimi-status-success)] ring-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)]',
    cellClass: 'border-[color-mix(in_srgb,var(--nimi-status-success)_36%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]',
    textClass: 'text-[var(--nimi-status-success)]',
  },
};

const LEGEND_ORDER: StatusKey[] = ['permanent', 'primary', 'lost', 'caries', 'treated'];

const OVERVIEW_UPPER_R = ['18', '17', '16', '55', '54', '53', '52', '51'];
const OVERVIEW_UPPER_L = ['61', '62', '63', '64', '65', '26', '27', '28'];
const OVERVIEW_LOWER_L = ['71', '72', '73', '74', '75', '36', '37', '38'];
const OVERVIEW_LOWER_R = ['48', '47', '46', '85', '84', '83', '82', '81'];

const MONO_CLASS = 'font-mono';

function isPrimaryPosition(positionId: string): boolean {
  const n = Number(positionId);
  return n >= 51 && n <= 85;
}

interface CellInfo {
  status: StatusKey;
  isPresent: boolean;
}

function collapseStatus(
  positionId: string,
  eruption: EruptionState,
  health: HealthState,
): CellInfo {
  if (health === 'caries') return { status: 'caries', isPresent: true };
  if (health === 'treated') return { status: 'treated', isPresent: true };
  if (eruption === 'lost_waiting') return { status: 'lost', isPresent: false };
  if (eruption === 'permanent_erupted') return { status: 'permanent', isPresent: true };
  if (eruption === 'primary_present') return { status: 'primary', isPresent: true };
  // Unerupted: color by slot type so the chart conveys 乳牙位/恒牙位 at a glance.
  return { status: isPrimaryPosition(positionId) ? 'primary' : 'permanent', isPresent: false };
}

export function ToothStatusOverview({ records }: { records: DentalRecordRow[] }) {
  const states = useMemo(() => computeDentalOverviewStates(records), [records]);
  const [hovered, setHovered] = useState<string | null>(null);

  const statusByPosition = useMemo(() => {
    const map = new Map<string, { status: StatusKey; displayId: string; isPresent: boolean }>();
    for (const [positionId, cell] of states.entries()) {
      const info = collapseStatus(positionId, cell.eruption, cell.health);
      map.set(positionId, { status: info.status, displayId: cell.displayId, isPresent: info.isPresent });
    }
    return map;
  }, [states]);

  const counts = useMemo(() => {
    const base: Record<StatusKey, number> = {
      permanent: 0, primary: 0, lost: 0, caries: 0, treated: 0,
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
    const showsTypeOnly = entry.status === 'primary' || entry.status === 'permanent';
    const label = showsTypeOnly
      ? `${meta.label}${entry.isPresent ? '·已长出' : '·未萌出'}`
      : meta.label;
    return { displayId: entry.displayId, label, textClass: meta.textClass, name };
  })();

  const renderTooth = (positionId: string) => {
    const fallbackStatus: StatusKey = isPrimaryPosition(positionId) ? 'primary' : 'permanent';
    const entry = statusByPosition.get(positionId)
      ?? { status: fallbackStatus, displayId: positionId, isPresent: false };
    const meta = STATUS_META[entry.status];
    const isHovered = hovered === positionId;
    const isFaded =
      !entry.isPresent && (entry.status === 'primary' || entry.status === 'permanent');
    const stateLabel =
      entry.status === 'primary' || entry.status === 'permanent'
        ? `${meta.label}${entry.isPresent ? '·已长出' : '·未萌出'}`
        : meta.label;
    const title = `${entry.displayId}${TOOTH_NAMES[entry.displayId] ? ` ${TOOTH_NAMES[entry.displayId]}` : ''} · ${stateLabel}`;
    return (
      <button
        key={positionId}
        type="button"
        title={title}
        onMouseEnter={() => setHovered(positionId)}
        onMouseLeave={() => setHovered((cur) => (cur === positionId ? null : cur))}
        onFocus={() => setHovered(positionId)}
        onBlur={() => setHovered((cur) => (cur === positionId ? null : cur))}
        className={`relative grid w-full cursor-pointer place-items-center rounded-lg border-[1.5px] font-semibold transition-all duration-150 ${MONO_CLASS} ${meta.cellClass} ${isFaded && !isHovered ? 'opacity-40' : 'opacity-100'} ${isHovered ? 'bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)] outline outline-2 outline-offset-2 outline-[var(--nimi-action-primary-bg)]' : ''}`}
        style={{ aspectRatio: '34 / 40', fontSize: 11 }}
      >
        <span>{entry.displayId}</span>
      </button>
    );
  };

  const renderRow = (leftIds: string[], rightIds: string[]) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="w-3 shrink-0 text-center text-[11px] text-[var(--nimi-text-muted)]">右</span>
      <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
        {leftIds.map(renderTooth)}
      </div>
      <div className="h-px w-2.5 shrink-0 bg-[var(--nimi-border-subtle)]" />
      <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
        {rightIds.map(renderTooth)}
      </div>
      <span className="w-3 shrink-0 text-center text-[11px] text-[var(--nimi-text-muted)]">左</span>
    </div>
  );

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mb-5 overflow-hidden rounded-3xl">
      <div className="mb-[18px] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-7 w-7 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3c-3 0-5 1.5-6 1.5S4 3.8 3.5 5.5C3 7.2 3.7 10 4.5 12c.4 1 .5 2 .7 3.5.2 1.4.4 3 .9 4.2.4 1 1 1.3 1.5 1.3.8 0 1-1 1.2-2.2.2-1.2.4-2.8.9-3.2.3-.3 2.3-.3 2.6 0 .5.4.7 2 .9 3.2.2 1.2.4 2.2 1.2 2.2.5 0 1.1-.3 1.5-1.3.5-1.2.7-2.8.9-4.2.2-1.5.3-2.5.7-3.5.8-2 1.5-4.8 1-6.5-.5-1.7-1.5-1-2.5-1S15 3 12 3z" />
            </svg>
          </div>
          <h3 className="m-0 text-[15px] font-semibold text-[var(--nimi-text-primary)]">牙齿状态总览</h3>
          <div className="group relative inline-block">
            <span
              className="inline-flex h-4 w-4 cursor-help items-center justify-center text-[var(--nimi-text-muted)]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </span>
            <div
              className="pointer-events-none absolute left-0 top-6 z-50 w-[280px] rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-3.5 text-[11px] leading-relaxed text-[var(--nimi-text-secondary)] opacity-0 shadow-[var(--nimi-elevation-floating)] transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
            >
              <p className="m-0 mb-1.5 text-[12px] font-semibold text-[var(--nimi-text-primary)]">FDI 牙位编号</p>
              <p className="m-0 text-[var(--nimi-text-secondary)]">
                <span className="font-medium text-[var(--nimi-status-info)]">恒牙 11–48</span>：四象限各 8 颗恒牙（1/2/3/4 系）。
              </p>
              <p className="m-0 mt-1 text-[var(--nimi-text-secondary)]">
                <span className="font-medium text-[var(--nimi-action-primary-bg)]">乳牙 51–85</span>：四象限各 5 颗乳牙（5/6/7/8 系）。
              </p>
              <p className="m-0 mt-1.5 text-[10px] text-[var(--nimi-text-muted)]">
                同一牙位：乳牙更替后该格会切换为对应恒牙编号（例如 53 → 13）。
              </p>
            </div>
          </div>
        </div>
        <div className={`text-[11px] text-[var(--nimi-text-muted)] ${MONO_CLASS}`}>
          共 32 位 · 20 乳牙 + 12 恒牙
        </div>
      </div>

      <div className="pb-4">
        <div className="flex flex-col gap-2.5">
          <div className="text-center text-[10px] uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
            上颌 · Upper
          </div>
          {renderRow(OVERVIEW_UPPER_R, OVERVIEW_UPPER_L)}
          <div
            className="my-1 h-px bg-[linear-gradient(to_right,transparent,var(--nimi-border-subtle)_20%,var(--nimi-border-subtle)_80%,transparent)]"
          />
          {renderRow(OVERVIEW_LOWER_R, OVERVIEW_LOWER_L)}
          <div className="text-center text-[10px] uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
            下颌 · Lower
          </div>
        </div>
      </div>

      <div
        className="mt-1 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--nimi-border-subtle)] pt-4"
      >
        <div className="flex flex-wrap gap-3.5">
          {LEGEND_ORDER.map((key) => {
            const meta = STATUS_META[key];
            return (
              <div key={key} className="flex items-center gap-1.5 text-[11px] text-[var(--nimi-text-secondary)]">
                <span
                  className={`h-2 w-2 rounded-full ring-2 ${meta.dotClass}`}
                />
                <span>{meta.label}</span>
                <span className={`text-[var(--nimi-text-muted)] ${MONO_CLASS}`}>{counts[key]}</span>
              </div>
            );
          })}
        </div>
        <div className="min-h-4 text-[11px] text-[var(--nimi-text-muted)]">
          {hoverInfo ? (
            <span>
              <span className={`${MONO_CLASS} font-semibold ${hoverInfo.textClass}`}>#{hoverInfo.displayId}</span>
              {hoverInfo.name && <span className="text-[var(--nimi-text-muted)]"> · {hoverInfo.name}</span>}
              <span> · {hoverInfo.label}</span>
            </span>
          ) : (
            <span className="text-[var(--nimi-text-muted)]">鼠标悬停查看牙位详情</span>
          )}
        </div>
      </div>
    </Surface>
  );
}
