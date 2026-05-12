import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getOrthodonticAppliances,
  getOrthodonticCases,
  getOrthodonticCheckins,
  getOrthodonticJourney,
  getUnwearIntervals,
  type OrthoClinicalEventType,
  type OrthodonticApplianceRow,
  type OrthodonticApplianceType,
  type OrthodonticCaseRow,
  type OrthodonticCheckinRow,
  type OrthodonticJourney,
  type OrthodonticUnwearIntervalRow,
  type OrthodonticUnwearReason,
} from '../../bridge/sqlite-bridge.js';
import { computeAgeMonths } from '../../app-shell/app-store.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { OrthodonticTreatmentCard } from './orthodontic-treatment-card.js';
import { OrthodonticTeethSelfiesCard } from './orthodontic-teeth-selfies-card.js';
import { OrthodonticPhotoCaptureModal } from './orthodontic-photo-capture-modal.js';
import {
  DetailsStat,
  OrthodonticDetailsSection,
} from './orthodontic-details-section.js';
import { OrthodonticJourneyTimeline } from './orthodontic-journey-timeline.js';
import {
  ApplianceFormModal,
  CaseFormModal,
  EditCaseFormModal,
  OrthoClinicalEventModal,
} from './orthodontic-modals.js';
import { OrthodonticUnwearForm } from './orthodontic-unwear-form.js';
import {
  computeRecentTrends,
  formatHours,
} from './orthodontic-derive.js';
import {
  type OrthodonticQuickTagId,
  quickTagClinicalEventPrefill,
} from './orthodontic-quick-tag-strip.js';

/**
 * Cross-component action requests dispatched by the dental-page toolbar
 * (`+` menu) into this surface. `nonce` is a monotonically-increasing
 * number so re-clicking the same action triggers a new effect even when
 * the kind hasn't changed.
 */
export type OrthodonticActionRequest =
  | { kind: 'add-appliance'; nonce: number }
  | { kind: 'log-clinical-event'; nonce: number };

interface Props {
  childId: string;
  childBirthDate: string;
  ageMonths: number;
  /** Optional toolbar-driven action signal. `null` = no pending request. */
  actionRequest?: OrthodonticActionRequest | null;
  /** Called after this surface has consumed an action request. */
  onActionRequestHandled?: () => void;
}

const APPLIANCE_TYPE_OPTIONS: { value: OrthodonticApplianceType; label: string; minAgeMonths: number }[] = [
  { value: 'twin-block', label: 'Twin-Block 功能矫治器', minAgeMonths: 48 },
  { value: 'expander', label: '扩弓器', minAgeMonths: 48 },
  { value: 'activator', label: '功能性矫治器', minAgeMonths: 48 },
  { value: 'metal-braces', label: '金属固定矫治器', minAgeMonths: 84 },
  { value: 'ceramic-braces', label: '陶瓷固定矫治器', minAgeMonths: 84 },
  { value: 'clear-aligner', label: '隐形牙套', minAgeMonths: 84 },
  { value: 'retainer-fixed', label: '固定保持器', minAgeMonths: 84 },
  { value: 'retainer-removable', label: '活动保持器', minAgeMonths: 84 },
];

interface ClinicalEventPrefill {
  eventType?: OrthoClinicalEventType;
  notes?: string;
}

/**
 * Top-level orthodontic surface. Wave D composition:
 *   WearingHero → TrayProgressCard → NextVisitCard → TeethSelfiesCard →
 *   Details(journey) → Details(recent trends)
 *
 * The legacy Hero / TodayCard / CycleCard / PromptsCard layout was deleted
 * in this wave; the parent surface no longer surfaces "prompts" — actions
 * live where the parent's eye already is (hero quick-tags + next-visit
 * grid + selfies capture button).
 */
export function OrthodonticPage({
  childId,
  childBirthDate,
  ageMonths,
  actionRequest,
  onActionRequestHandled,
}: Props) {
  const [cases, setCases] = useState<OrthodonticCaseRow[]>([]);
  const [appliances, setAppliances] = useState<OrthodonticApplianceRow[]>([]);
  const [intervalsByAppliance, setIntervalsByAppliance] = useState<
    Record<string, OrthodonticUnwearIntervalRow[]>
  >({});
  const [checkinsByAppliance, setCheckinsByAppliance] = useState<
    Record<string, OrthodonticCheckinRow[]>
  >({});
  const [journey, setJourney] = useState<OrthodonticJourney | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCaseForm, setShowCaseForm] = useState(false);
  const [showEditCaseForm, setShowEditCaseForm] = useState(false);
  const [showApplianceForm, setShowApplianceForm] = useState(false);
  const [showClinicalEventModal, setShowClinicalEventModal] = useState(false);
  const [clinicalEventPrefill, setClinicalEventPrefill] =
    useState<ClinicalEventPrefill | null>(null);
  const [showBackfillForm, setShowBackfillForm] = useState(false);
  const [backfillDefaultReason, setBackfillDefaultReason] =
    useState<OrthodonticUnwearReason | undefined>(undefined);
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [selfiesReloadKey, setSelfiesReloadKey] = useState(0);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());

  // Re-tick `now` every 60s so open-interval ages and countdowns refresh.
  useEffect(() => {
    const id = window.setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Wave D audit follow-up (W-D-1): the dental-page `+` toolbar menu hands
  // off entry-point intent through `actionRequest`. Consume it here so the
  // corresponding modal opens, then signal back so the parent can clear the
  // slot. The `nonce` on each request guarantees repeat clicks of the same
  // kind still fire the effect.
  useEffect(() => {
    if (!actionRequest) return;
    switch (actionRequest.kind) {
      case 'add-appliance':
        setShowApplianceForm(true);
        break;
      case 'log-clinical-event':
        setClinicalEventPrefill(null);
        setShowClinicalEventModal(true);
        break;
    }
    onActionRequestHandled?.();
  }, [actionRequest, onActionRequestHandled]);

  const reloadCases = useCallback(async () => {
    try {
      const rows = await getOrthodonticCases(childId);
      setCases(rows);
      const nonCompleted = rows.find((c) => c.stage !== 'completed');
      setActiveCaseId(nonCompleted?.caseId ?? null);
    } catch (error) {
      catchLog('ortho', 'action:load-cases-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, [childId]);

  const reloadAppliances = useCallback(async (caseId: string | null) => {
    if (!caseId) {
      setAppliances([]);
      return;
    }
    try {
      setAppliances(await getOrthodonticAppliances(caseId));
    } catch (error) {
      catchLog('ortho', 'action:load-appliances-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const reloadAppliancesContent = useCallback(
    async (rows: OrthodonticApplianceRow[]) => {
      const intervals: Record<string, OrthodonticUnwearIntervalRow[]> = {};
      const checkins: Record<string, OrthodonticCheckinRow[]> = {};
      for (const a of rows) {
        try {
          intervals[a.applianceId] = await getUnwearIntervals({
            applianceId: a.applianceId,
            limit: 200,
          });
        } catch (error) {
          catchLog('ortho', 'action:load-intervals-failed')(error);
        }
        try {
          checkins[a.applianceId] = await getOrthodonticCheckins({
            applianceId: a.applianceId,
            limitDays: 365,
          });
        } catch (error) {
          catchLog('ortho', 'action:load-checkins-failed')(error);
        }
      }
      setIntervalsByAppliance(intervals);
      setCheckinsByAppliance(checkins);
    },
    [],
  );

  const reloadJourney = useCallback(
    async (caseId: string | null) => {
      if (!caseId) {
        setJourney(null);
        return;
      }
      try {
        setJourney(await getOrthodonticJourney({ childId, caseId }));
      } catch (error) {
        catchLog('ortho', 'action:load-journey-failed')(error);
        setErrorMsg(error instanceof Error ? error.message : String(error));
      }
    },
    [childId],
  );

  useEffect(() => {
    setLoading(true);
    reloadCases().finally(() => setLoading(false));
  }, [reloadCases]);

  useEffect(() => {
    void reloadAppliances(activeCaseId);
    void reloadJourney(activeCaseId);
  }, [activeCaseId, reloadAppliances, reloadJourney]);

  useEffect(() => {
    void reloadAppliancesContent(appliances);
  }, [appliances, reloadAppliancesContent]);

  const reloadAll = useCallback(async () => {
    await reloadCases();
    await reloadAppliances(activeCaseId);
    await reloadJourney(activeCaseId);
    setSelfiesReloadKey((k) => k + 1);
  }, [reloadCases, reloadAppliances, reloadJourney, activeCaseId]);

  const activeCase = useMemo(
    () => cases.find((c) => c.caseId === activeCaseId) ?? null,
    [cases, activeCaseId],
  );

  const activeAppliances = useMemo(
    () => appliances.filter((a) => a.status === 'active'),
    [appliances],
  );

  // Primary appliance for hero + tray-progress + capture pin. Prefer
  // clear-aligner > twin-block > activator > retainer-removable > expander >
  // others; this matches the parent's mental priority for daily action.
  const primaryAppliance = useMemo<OrthodonticApplianceRow | null>(() => {
    const order: OrthodonticApplianceType[] = [
      'clear-aligner',
      'twin-block',
      'activator',
      'retainer-removable',
      'expander',
      'metal-braces',
      'ceramic-braces',
      'retainer-fixed',
    ];
    for (const t of order) {
      const found = activeAppliances.find((a) => a.applianceType === t);
      if (found) return found;
    }
    return activeAppliances[0] ?? null;
  }, [activeAppliances]);

  const eligibleApplianceTypes = useMemo(
    () => APPLIANCE_TYPE_OPTIONS.filter((opt) => ageMonths >= opt.minAgeMonths),
    [ageMonths],
  );

  const primaryIntervals = primaryAppliance
    ? intervalsByAppliance[primaryAppliance.applianceId] ?? []
    : [];
  const primaryCheckins = primaryAppliance
    ? checkinsByAppliance[primaryAppliance.applianceId] ?? []
    : [];

  const { monthsElapsed, monthsTotal } = useMemo(() => {
    if (!activeCase) return { monthsElapsed: 0, monthsTotal: null as number | null };
    const startMs = new Date(`${activeCase.startedAt}T00:00:00.000Z`).getTime();
    const daysElapsed = Math.max(0, (new Date(nowIso).getTime() - startMs) / (1000 * 60 * 60 * 24));
    // Use ceil so day 1+ already reads as "第 1 月" — the prior floor() reported
    // "第 0 月" for the entire first 30 days of treatment, which parents read
    // as "data not connected" rather than "we just started".
    const elapsed = daysElapsed > 0 ? Math.max(1, Math.ceil(daysElapsed / 30)) : 0;
    const total = computeCaseMonthsTotal(activeCase, appliances);
    return { monthsElapsed: elapsed, monthsTotal: total };
  }, [activeCase, appliances, nowIso]);

  const { nextReview, daysToReview } = useMemo(() => {
    const dates = appliances
      .filter((a) => a.status === 'active' && a.nextReviewDate)
      .map((a) => a.nextReviewDate as string)
      .sort();
    const next = dates[0] ?? activeCase?.nextReviewDate ?? null;
    if (!next) return { nextReview: null, daysToReview: null };
    const days = Math.round(
      (new Date(`${next}T00:00:00.000Z`).getTime() - new Date(nowIso).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return { nextReview: next, daysToReview: days };
  }, [appliances, activeCase, nowIso]);

  const recentTrends = useMemo(() => {
    if (!primaryAppliance) return null;
    return computeRecentTrends({
      appliance: primaryAppliance,
      intervals: primaryIntervals,
      alignerChangeCheckins: primaryCheckins,
      nowIso,
    });
  }, [primaryAppliance, primaryIntervals, primaryCheckins, nowIso]);

  // ── Modal routing ──

  const handleQuickTag = (id: OrthodonticQuickTagId) => {
    if (id === 'miss') {
      setBackfillDefaultReason('other');
      setShowBackfillForm(true);
      return;
    }
    const notesPrefill = quickTagClinicalEventPrefill(id);
    if (notesPrefill === null) return;
    setClinicalEventPrefill({ eventType: 'ortho-issue', notes: notesPrefill });
    setShowClinicalEventModal(true);
  };

  const handleOpenClinicalEvent = () => {
    setClinicalEventPrefill(null);
    setShowClinicalEventModal(true);
  };

  const handleOpenUnwearBackfill = (defaultReason?: 'other') => {
    setBackfillDefaultReason(defaultReason);
    setShowBackfillForm(true);
  };

  if (loading) {
    return (
      <div className="p-6 text-[14px]" style={{ color: S.sub }}>
        加载中…
      </div>
    );
  }

  // PO-ORTHO-002b: when there is no ongoing (non-completed) case we render
  // the empty-state CTA. Past completed cases live in the journey timeline
  // (and a future "history" surface), not in the active treatment view.
  if (!activeCase) {
    const hasHistory = cases.length > 0;
    return (
      <div className="flex flex-col gap-4">
        <EmptyState onCreate={() => setShowCaseForm(true)} hasHistory={hasHistory} />
        {showCaseForm && (
          <CaseFormModal
            childId={childId}
            onClose={() => setShowCaseForm(false)}
            onSaved={async () => {
              setShowCaseForm(false);
              await reloadAll();
            }}
            onError={setErrorMsg}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && <ErrorBanner msg={errorMsg} onDismiss={() => setErrorMsg(null)} />}

      <OrthodonticTreatmentCard
        caseRow={activeCase}
        primaryAppliance={primaryAppliance}
        intervals={primaryIntervals}
        alignerChangeCheckins={primaryCheckins}
        nextReview={nextReview}
        daysToReview={daysToReview}
        monthsElapsed={monthsElapsed}
        monthsTotal={monthsTotal}
        nowIso={nowIso}
        onEditCase={() => setShowEditCaseForm(true)}
        onEditAppliance={() => setShowApplianceForm(true)}
        onOpenUnwearBackfill={handleOpenUnwearBackfill}
        onQuickTagClick={handleQuickTag}
        onOpenClinicalEvent={handleOpenClinicalEvent}
        onCaseChanged={reloadAll}
        onError={setErrorMsg}
      />

      {activeCase.caseType === 'unknown-legacy' && <UnknownLegacyBanner />}

      {!primaryAppliance && (
        <NoActiveApplianceCard
          canAdd={
            activeCase.caseType !== 'unknown-legacy' && eligibleApplianceTypes.length > 0
          }
          onAdd={() => setShowApplianceForm(true)}
        />
      )}

      {activeCase.caseType !== 'unknown-legacy' && (
        <OrthodonticTeethSelfiesCard
          childId={childId}
          caseId={activeCase.caseId}
          onOpenCapture={() => setShowPhotoCapture(true)}
          reloadKey={selfiesReloadKey}
          onError={setErrorMsg}
        />
      )}

      <OrthodonticDetailsSection
        title="旅程时间轴"
        count={
          journey
            ? `${journey.past.length + journey.future.length} 条`
            : undefined
        }
        hint="按时间回看"
      >
        <OrthodonticJourneyTimeline journey={journey} loading={journey === null} />
      </OrthodonticDetailsSection>

      {recentTrends && (
        <OrthodonticDetailsSection title="近 7 天数据" hint="任务达成率近似">
          <RecentTrendsGrid trends={recentTrends} />
        </OrthodonticDetailsSection>
      )}

      {showCaseForm && (
        <CaseFormModal
          childId={childId}
          onClose={() => setShowCaseForm(false)}
          onSaved={async () => {
            setShowCaseForm(false);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}

      {showEditCaseForm && (
        <EditCaseFormModal
          caseRow={activeCase}
          primaryAppliance={primaryAppliance}
          onClose={() => setShowEditCaseForm(false)}
          onSaved={async () => {
            setShowEditCaseForm(false);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}

      {showApplianceForm && (
        <ApplianceFormModal
          caseId={activeCase.caseId}
          childId={childId}
          childBirthDate={childBirthDate}
          eligibleTypes={eligibleApplianceTypes}
          onClose={() => setShowApplianceForm(false)}
          onSaved={async () => {
            setShowApplianceForm(false);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}

      {showClinicalEventModal && (
        <OrthoClinicalEventModal
          childId={childId}
          childBirthDate={childBirthDate}
          activeAppliances={activeAppliances}
          prefill={clinicalEventPrefill ?? undefined}
          onClose={() => {
            setShowClinicalEventModal(false);
            setClinicalEventPrefill(null);
          }}
          onSaved={async () => {
            setShowClinicalEventModal(false);
            setClinicalEventPrefill(null);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}

      {showBackfillForm && primaryAppliance && (
        <OrthodonticUnwearForm
          appliance={primaryAppliance}
          defaultReason={backfillDefaultReason}
          onClose={() => {
            setShowBackfillForm(false);
            setBackfillDefaultReason(undefined);
          }}
          onSaved={async () => {
            setShowBackfillForm(false);
            setBackfillDefaultReason(undefined);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}

      {showPhotoCapture && activeCase.caseType !== 'unknown-legacy' && (
        <OrthodonticPhotoCaptureModal
          childId={childId}
          caseId={activeCase.caseId}
          appliance={primaryAppliance}
          onClose={() => setShowPhotoCapture(false)}
          onSaved={async () => {
            setShowPhotoCapture(false);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function computeCaseMonthsTotal(
  caseRow: OrthodonticCaseRow,
  appliances: OrthodonticApplianceRow[],
): number | null {
  if (caseRow.plannedEndAt) {
    const ms =
      new Date(`${caseRow.plannedEndAt}T00:00:00.000Z`).getTime() -
      new Date(`${caseRow.startedAt}T00:00:00.000Z`).getTime();
    return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24 * 30)));
  }
  const aligner = appliances.find((a) => a.applianceType === 'clear-aligner');
  if (aligner && aligner.daysPerAligner && aligner.totalAligners) {
    const days = aligner.daysPerAligner * aligner.totalAligners;
    return Math.max(1, Math.round(days / 30));
  }
  return null;
}

function RecentTrendsGrid({ trends }: { trends: ReturnType<typeof computeRecentTrends> }) {
  const cells: { label: string; value: string; sub: string }[] = [
    {
      label: '日均净戴',
      value: formatHours(trends.last7AvgPerDay),
      sub: `近 7 天合计 ${formatHours(trends.last7NetHours)}`,
    },
  ];
  if (trends.cycle) {
    cells.push({
      label: '本副净戴',
      value: formatHours(trends.cycle.netWearHours),
      sub: `目标 ${formatHours(trends.cycle.targetHours)}`,
    });
    cells.push({
      label: '本副提前度',
      value:
        trends.cycle.daysShifted === 0
          ? '按计划'
          : trends.cycle.daysShifted > 0
          ? `推后 ${trends.cycle.daysShifted} 天`
          : `提前 ${-trends.cycle.daysShifted} 天`,
      sub: '下次换套',
    });
  } else if (trends.daysToReview !== null && trends.nextReviewDate !== null) {
    cells.push({
      label: '下次复诊',
      value:
        trends.daysToReview >= 0
          ? `还有 ${trends.daysToReview} 天`
          : `过期 ${-trends.daysToReview} 天`,
      sub: trends.nextReviewDate,
    });
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        gap: 16,
      }}
    >
      {cells.map((c) => (
        <DetailsStat key={c.label} label={c.label} value={c.value} sub={c.sub} />
      ))}
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="p-3 rounded-xl text-[14px] flex items-start justify-between gap-2"
      style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
    >
      <span style={{ wordBreak: 'break-word' }}>{msg}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-[12px] underline shrink-0"
      >
        关闭
      </button>
    </div>
  );
}

function UnknownLegacyBanner() {
  return (
    <div
      className="p-4 rounded-2xl"
      style={{
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.3)',
      }}
    >
      <div className="text-[14px] font-semibold mb-1" style={{ color: '#b45309' }}>
        待确认历史疗程
      </div>
      <p className="text-[13px]" style={{ color: S.sub }}>
        该疗程由历史 ortho-start 记录回补生成。请在「⋯ 菜单 → 删除当前疗程」后新建一个正式疗程，或先把它改归类为正式类型再加装置（PO-ORTHO-002a）。
      </p>
    </div>
  );
}

function EmptyState({ onCreate, hasHistory }: { onCreate: () => void; hasHistory: boolean }) {
  return (
    <div
      className="rounded-[20px] p-8 text-center"
      style={{
        background:
          'linear-gradient(135deg, rgba(167,243,208,0.18) 0%, rgba(191,219,254,0.18) 60%, rgba(221,214,254,0.18) 100%)',
        border: '1px solid rgba(226,232,240,0.7)',
      }}
    >
      <h3 className="text-[18px] font-semibold" style={{ color: S.text, margin: 0 }}>
        {hasHistory ? '当前没有进行中的疗程' : '还没有正畸疗程'}
      </h3>
      <p className="mt-2 text-[14px]" style={{ color: S.sub }}>
        {hasHistory
          ? '上一段疗程已结束。可以新建一段新的疗程，过往记录会保留在口腔记录里。'
          : '新建疗程后，可以记录每副牙套节奏、复诊安排、未戴时段，并自动生成时间轴。'}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
        style={{
          background: S.accent,
          border: 0,
          cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(78,204,163,0.32)',
        }}
      >
        {hasHistory ? '新建一段新的疗程' : '新建正畸疗程'}
      </button>
    </div>
  );
}

function NoActiveApplianceCard({
  canAdd,
  onAdd,
}: {
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}
    >
      <p className="text-[14px]" style={{ color: S.sub, margin: 0 }}>
        当前疗程还没有进行中的装置。添加装置后可以开始记录每日状态。
      </p>
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 text-[14px] font-semibold px-4 py-2 rounded-full"
          style={{ background: S.accent, color: '#fff', border: 0, cursor: 'pointer' }}
        >
          添加装置
        </button>
      )}
    </div>
  );
}

void computeAgeMonths;
