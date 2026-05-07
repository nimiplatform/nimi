import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getOrthodonticAppliances,
  getOrthodonticCases,
  getOrthodonticCheckins,
  getOrthodonticJourney,
  getUnwearIntervals,
  type OrthodonticApplianceRow,
  type OrthodonticApplianceType,
  type OrthodonticCaseRow,
  type OrthodonticCheckinRow,
  type OrthodonticJourney,
  type OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { computeAgeMonths } from '../../app-shell/app-store.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import { OrthodonticHero } from './orthodontic-hero.js';
import { OrthodonticTodayCard } from './orthodontic-today-card.js';
import { OrthodonticCycleCard } from './orthodontic-cycle-card.js';
import { OrthodonticJourneyTimeline } from './orthodontic-journey-timeline.js';
import { OrthodonticPromptsCard } from './orthodontic-prompts-card.js';
import {
  ApplianceFormModal,
  CaseFormModal,
  EditCaseFormModal,
  OrthoClinicalEventModal,
} from './orthodontic-modals.js';
import {
  computeContextualPrompts,
  formatDeterministicAiSummary,
} from './orthodontic-derive.js';

interface Props {
  childId: string;
  childBirthDate: string;
  ageMonths: number;
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

/**
 * Top-level orthodontic surface. Orchestrates data loading, multi-case
 * switching, modal lifecycles, and composition of:
 *   Hero → Today → Cycle (clear-aligner) → Prompts → Journey
 *
 * Replaces the legacy `OrthodonticTab` (deleted in this wave).
 */
export function OrthodonticPage({ childId, childBirthDate, ageMonths }: Props) {
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
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());

  // Re-tick `now` every 60s so open-interval ages and countdowns refresh.
  useEffect(() => {
    const id = window.setInterval(() => setNowIso(new Date().toISOString()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const reloadCases = useCallback(async () => {
    try {
      const rows = await getOrthodonticCases(childId);
      setCases(rows);
      // PO-ORTHO-002b: at most one non-completed case per child. Pick that
      // single non-completed case as the active surface; if there is none
      // (only completed cases or no cases at all), the page renders the
      // empty state so the parent can start a new course.
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
  }, [reloadCases, reloadAppliances, reloadJourney, activeCaseId]);

  const activeCase = useMemo(
    () => cases.find((c) => c.caseId === activeCaseId) ?? null,
    [cases, activeCaseId],
  );

  const activeAppliances = useMemo(
    () => appliances.filter((a) => a.status === 'active'),
    [appliances],
  );

  // Primary appliance for Today + Cycle. If multiple actives exist, prefer
  // clear-aligner > twin-block > activator > retainer-removable > expander >
  // others; this matches the parent's mental priority for daily action.
  const primaryAppliance = useMemo(() => {
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

  const prompts = useMemo(() => {
    if (!activeCase) return [];
    return computeContextualPrompts({
      caseRow: activeCase,
      appliances: activeAppliances,
      intervalsByAppliance,
      checkinsByAppliance,
      journey,
      nowIso,
    });
  }, [activeCase, activeAppliances, intervalsByAppliance, checkinsByAppliance, journey, nowIso]);

  const aiSummary = useMemo(() => {
    if (!primaryAppliance) return [] as string[];
    return formatDeterministicAiSummary({
      appliance: primaryAppliance,
      intervals: intervalsByAppliance[primaryAppliance.applianceId] ?? [],
      alignerChangeCheckins: checkinsByAppliance[primaryAppliance.applianceId] ?? [],
      nowIso,
    });
  }, [primaryAppliance, intervalsByAppliance, checkinsByAppliance, nowIso]);

  if (loading) {
    return (
      <div className="p-6 text-[14px]" style={{ color: S.sub }}>
        加载中…
      </div>
    );
  }

  // PO-ORTHO-002b: when there is no ongoing (non-completed) case we render the
  // empty-state CTA. Past completed cases live in the journey timeline (and a
  // future "history" surface), not in the active treatment view.
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
      {errorMsg && (
        <div role="alert" className="p-3 rounded-xl text-[14px] flex items-start justify-between gap-2"
          style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          <span style={{ wordBreak: 'break-word' }}>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-[12px] underline shrink-0">
            关闭
          </button>
        </div>
      )}

      {activeCase && (
        <OrthodonticHero
          caseRow={activeCase}
          appliances={appliances}
          intervalsByAppliance={intervalsByAppliance}
          nowIso={nowIso}
          onCaseChanged={reloadAll}
          onError={setErrorMsg}
          onEditCase={() => setShowEditCaseForm(true)}
        />
      )}

      {activeCase && activeCase.caseType === 'unknown-legacy' && (
        <div className="p-4 rounded-2xl"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div className="text-[14px] font-semibold mb-1" style={{ color: '#b45309' }}>待确认历史疗程</div>
          <p className="text-[13px]" style={{ color: S.sub }}>
            该疗程由历史 ortho-start 记录回补生成。请在「⋯ 菜单 → 删除当前疗程」后新建一个正式疗程，或先把它改归类为正式类型再加装置（PO-ORTHO-002a）。
          </p>
        </div>
      )}

      {primaryAppliance ? (
        <>
          <OrthodonticTodayCard
            appliance={primaryAppliance}
            intervals={intervalsByAppliance[primaryAppliance.applianceId] ?? []}
            nowIso={nowIso}
            onChanged={reloadAll}
            onError={setErrorMsg}
          />
          {primaryAppliance.applianceType === 'clear-aligner' && (
            <OrthodonticCycleCard
              appliance={primaryAppliance}
              intervals={intervalsByAppliance[primaryAppliance.applianceId] ?? []}
              alignerChangeCheckins={checkinsByAppliance[primaryAppliance.applianceId] ?? []}
              nowIso={nowIso}
              onChanged={reloadAll}
              onError={setErrorMsg}
            />
          )}
        </>
      ) : (
        <NoActiveApplianceCard
          canAdd={
            activeCase !== null && activeCase.caseType !== 'unknown-legacy' && eligibleApplianceTypes.length > 0
          }
          onAdd={() => setShowApplianceForm(true)}
        />
      )}

      <OrthodonticPromptsCard
        prompts={prompts}
        onPromptClick={(prompt) => {
          if (prompt.kind === 'recent-review-undocumented' || prompt.kind === 'record-anomaly') {
            setShowClinicalEventModal(true);
          }
          // record-aligner-switch and close-open-unwear are handled in their own
          // anchored components; click here is a no-op (the parent already sees
          // the affordance on the Today/Cycle card).
        }}
      />

      {aiSummary.length > 0 && (
        <div className="rounded-2xl px-5 py-4"
          style={{
            background: 'rgba(248,250,252,0.7)',
            border: '1px solid rgba(226,232,240,0.7)',
          }}>
          <p className="text-[12px] uppercase tracking-[0.08em]" style={{ color: S.sub }}>
            最近趋势（近似）
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {aiSummary.map((line) => (
              <li key={line} className="text-[13px]" style={{ color: S.text }}>
                · {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <OrthodonticJourneyTimeline journey={journey} loading={journey === null} />

      {/* Footer management actions for the current case. */}
      {activeCase && activeCase.caseType !== 'unknown-legacy' && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <button type="button" onClick={() => setShowApplianceForm(true)}
            className="text-[13px] font-medium px-3 py-1.5 rounded-full"
            style={{ background: '#eef2f6', color: S.text, border: 0, cursor: 'pointer' }}>
            添加装置
          </button>
          <button type="button" onClick={() => setShowClinicalEventModal(true)}
            className="text-[13px] font-medium px-3 py-1.5 rounded-full"
            style={{ background: '#eef2f6', color: S.text, border: 0, cursor: 'pointer' }}>
            记录临床事件
          </button>
        </div>
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

      {showEditCaseForm && activeCase && (
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

      {showApplianceForm && activeCase && (
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

      {showClinicalEventModal && activeCase && (
        <OrthoClinicalEventModal
          childId={childId}
          childBirthDate={childBirthDate}
          activeAppliances={activeAppliances}
          onClose={() => setShowClinicalEventModal(false)}
          onSaved={async () => {
            setShowClinicalEventModal(false);
            await reloadAll();
          }}
          onError={setErrorMsg}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate, hasHistory }: { onCreate: () => void; hasHistory: boolean }) {
  return (
    <div className="rounded-[20px] p-8 text-center"
      style={{
        background:
          'linear-gradient(135deg, rgba(167,243,208,0.18) 0%, rgba(191,219,254,0.18) 60%, rgba(221,214,254,0.18) 100%)',
        border: '1px solid rgba(226,232,240,0.7)',
      }}>
      <h3 className="text-[18px] font-semibold" style={{ color: S.text, margin: 0 }}>
        {hasHistory ? '当前没有进行中的疗程' : '还没有正畸疗程'}
      </h3>
      <p className="mt-2 text-[14px]" style={{ color: S.sub }}>
        {hasHistory
          ? '上一段疗程已结束。可以新建一段新的疗程，过往记录会保留在口腔记录里。'
          : '新建疗程后，可以记录每副牙套节奏、复诊安排、未戴时段，并自动生成时间轴。'}
      </p>
      <button type="button" onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[14px] font-semibold text-white"
        style={{ background: S.accent, border: 0, cursor: 'pointer', boxShadow: '0 6px 18px rgba(78,204,163,0.32)' }}>
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
    <div className="rounded-2xl p-6"
      style={{ background: '#ffffff', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' }}>
      <p className="text-[14px]" style={{ color: S.sub, margin: 0 }}>
        当前疗程还没有进行中的装置。添加装置后可以开始记录每日状态。
      </p>
      {canAdd && (
        <button type="button" onClick={onAdd}
          className="mt-3 text-[14px] font-semibold px-4 py-2 rounded-full"
          style={{ background: S.accent, color: '#fff', border: 0, cursor: 'pointer' }}>
          添加装置
        </button>
      )}
    </div>
  );
}

// Suppress unused-import warning for `computeAgeMonths` (re-exported style).
void computeAgeMonths;
