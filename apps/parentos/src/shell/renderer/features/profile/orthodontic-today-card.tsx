import { useMemo, useState } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import {
  closeUnwearInterval,
  insertOrthodonticCheckin,
  type OrthodonticApplianceRow,
  type OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import {
  applianceSupportsWearGap,
  applianceTypeLabel,
  computeOpenIntervalState,
  formatHours,
} from './orthodontic-derive.js';
import { OrthodonticUnwearForm } from './orthodontic-unwear-form.js';

interface Props {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  nowIso: string;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}

/**
 * Today card — the parent's "what's the state right now" surface for the
 * active appliance. Branches by appliance type:
 *
 *  - Removable wear-gap (clear-aligner / twin-block / activator / retainer-removable):
 *    state badge + main action ("开始未戴" / "戴回去") + secondary "补记一次".
 *  - expander: "已加力 N/M 次" + main "记录一次加力".
 *  - Fixed (metal/ceramic-braces / retainer-fixed): static card with next review.
 */
export function OrthodonticTodayCard({
  appliance,
  intervals,
  nowIso,
  onChanged,
  onError,
}: Props) {
  if (applianceSupportsWearGap(appliance.applianceType)) {
    return (
      <RemovableTodayCard
        appliance={appliance}
        intervals={intervals}
        nowIso={nowIso}
        onChanged={onChanged}
        onError={onError}
      />
    );
  }
  if (appliance.applianceType === 'expander') {
    return (
      <ExpanderTodayCard appliance={appliance} onChanged={onChanged} onError={onError} />
    );
  }
  return <FixedTodayCard appliance={appliance} />;
}

function RemovableTodayCard({
  appliance,
  intervals,
  nowIso,
  onChanged,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  nowIso: string;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [showBackfillForm, setShowBackfillForm] = useState(false);

  const openState = useMemo(
    () => computeOpenIntervalState(intervals, nowIso),
    [intervals, nowIso],
  );

  const handleResume = async () => {
    if (!openState.intervalId) return;
    onError(null);
    try {
      await closeUnwearInterval({
        intervalId: openState.intervalId,
        endAt: nowIso,
        now: isoNow(),
      });
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:close-unwear-interval-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const isOpen = openState.hasOpen;
  const statusLabel = isOpen ? '未戴中' : '正在佩戴';
  const statusColor = isOpen ? '#b45309' : '#15803d';
  const statusBg = isOpen ? 'rgba(245,158,11,0.14)' : 'rgba(34,197,94,0.14)';
  const ageText = isOpen ? `已 ${formatHours(openState.ageHours)}` : null;

  return (
    <>
      <Surface
        as="section"
        material="solid"
        padding="none"
        tone="card"
        className="rounded-[20px] p-6"
        style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}
      >
        <p className="text-[12px] uppercase tracking-[0.08em]" style={{ color: S.sub, letterSpacing: '0.08em' }}>
          {applianceTypeLabel(appliance.applianceType)} · 此刻
        </p>
        <div className="mt-2 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-baseline gap-3">
              <span
                className="inline-flex items-center justify-center rounded-full px-5 py-2 text-[15px]"
                style={{
                  background: statusBg,
                  color: statusColor,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  minWidth: 124,
                }}
              >
                {statusLabel}
              </span>
              {ageText && (
                <span className="text-[14px]" style={{ color: S.sub }}>
                  {ageText}
                </span>
              )}
            </div>
            {appliance.prescribedHoursPerDay && (
              <p className="mt-2.5 text-[13px]" style={{ color: S.sub }}>
                医嘱每日佩戴 {appliance.prescribedHoursPerDay} 小时（PO-ORTHO-008 任务达成率近似）
              </p>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-2 min-w-[180px]">
            {isOpen ? (
              <button
                type="button"
                onClick={() => void handleResume()}
                className="text-[14px] font-semibold text-white px-5 py-2.5 rounded-full transition-transform hover:-translate-y-0.5"
                style={{ background: S.accent, border: 0, cursor: 'pointer', boxShadow: '0 6px 18px rgba(78,204,163,0.3)' }}
              >
                已戴回 · 关闭这一段
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowOpenForm(true)}
                className="text-[14px] font-semibold text-white px-5 py-2.5 rounded-full transition-transform hover:-translate-y-0.5"
                style={{ background: S.accent, border: 0, cursor: 'pointer', boxShadow: '0 6px 18px rgba(78,204,163,0.3)' }}
              >
                现在脱下
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowBackfillForm(true)}
              className="text-[13px] px-4 py-2 rounded-full"
              style={{
                background: 'rgba(241,245,249,0.9)',
                color: S.text,
                border: '1px solid rgba(226,232,240,0.9)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              补记一次未戴时段
            </button>
          </div>
        </div>
      </Surface>
      {showOpenForm && (
        <OrthodonticUnwearForm
          appliance={appliance}
          openOnly
          onClose={() => setShowOpenForm(false)}
          onSaved={async () => {
            setShowOpenForm(false);
            await onChanged();
          }}
          onError={onError}
        />
      )}
      {showBackfillForm && (
        <OrthodonticUnwearForm
          appliance={appliance}
          onClose={() => setShowBackfillForm(false)}
          onSaved={async () => {
            setShowBackfillForm(false);
            await onChanged();
          }}
          onError={onError}
        />
      )}
    </>
  );
}

function ExpanderTodayCard({
  appliance,
  onChanged,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const remaining =
    appliance.prescribedActivations !== null
      ? Math.max(0, appliance.prescribedActivations - appliance.completedActivations)
      : null;
  const canActivate =
    appliance.status === 'active' &&
    (appliance.prescribedActivations === null ||
      appliance.completedActivations < appliance.prescribedActivations);

  const handleActivate = async () => {
    const next = appliance.completedActivations + 1;
    if (!window.confirm(`确认记录第 ${next} 次加力？`)) return;
    onError(null);
    try {
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId: appliance.childId,
        caseId: appliance.caseId,
        applianceId: appliance.applianceId,
        checkinType: 'expander-activation',
        checkinDate: nowYmd(),
        activationIndex: next,
        alignerIndex: null,
        notes: null,
        now: isoNow(),
      });
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:expander-activation-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

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
        扩弓器 · 此刻
      </p>
      <div className="mt-2 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[20px] font-semibold" style={{ color: S.text }}>
            已加力 {appliance.completedActivations}
            {appliance.prescribedActivations !== null
              ? ` / 共 ${appliance.prescribedActivations}`
              : ''}{' '}
            次
          </h3>
          {remaining !== null && (
            <p className="mt-1.5 text-[14px]" style={{ color: S.sub }}>
              {remaining > 0 ? `还需加力 ${remaining} 次` : '医嘱总次数已完成'}
            </p>
          )}
          {appliance.nextReviewDate && (
            <p className="mt-1 text-[13px]" style={{ color: S.sub }}>
              下次复诊 {appliance.nextReviewDate}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleActivate()}
          disabled={!canActivate}
          className="text-[14px] font-semibold text-white px-5 py-2.5 rounded-full transition-transform hover:-translate-y-0.5"
          style={{
            background: canActivate ? S.accent : '#cbd5e1',
            border: 0,
            cursor: canActivate ? 'pointer' : 'not-allowed',
            boxShadow: canActivate ? '0 6px 18px rgba(78,204,163,0.3)' : 'none',
          }}
        >
          记录一次加力
        </button>
      </div>
    </Surface>
  );
}

function FixedTodayCard({ appliance }: { appliance: OrthodonticApplianceRow }) {
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
        {applianceTypeLabel(appliance.applianceType)} · 此刻
      </p>
      <h3 className="mt-2 text-[18px] font-semibold" style={{ color: S.text }}>
        固定装置 · 无每日操作
      </h3>
      {appliance.nextReviewDate && (
        <p className="mt-1.5 text-[14px]" style={{ color: S.sub }}>
          下次复诊 {appliance.nextReviewDate}
        </p>
      )}
      <p className="mt-2 text-[13px]" style={{ color: S.sub }}>
        如有不适、脱落或状态变化，建议在「记录临床事件」里补一笔。
      </p>
    </Surface>
  );
}

function nowYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
