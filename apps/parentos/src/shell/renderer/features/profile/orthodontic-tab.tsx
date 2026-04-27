import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteOrthodonticAppliance,
  deleteOrthodonticCase,
  getOrthodonticAppliances,
  getOrthodonticCases,
  getOrthodonticCheckins,
  insertOrthodonticCheckin,
  updateOrthodonticApplianceStatus,
  updateOrthodonticCase,
  type OrthodonticApplianceRow,
  type OrthodonticApplianceStatus,
  type OrthodonticApplianceType,
  type OrthodonticCaseRow,
  type OrthodonticCheckinRow,
  type OrthodonticCheckinType,
  type WritableOrthodonticCaseType,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import {
  ApplianceFormModal,
  CaseFormModal,
  CASE_TYPE_OPTIONS,
  OrthoClinicalEventModal,
  STAGE_OPTIONS,
} from './orthodontic-tab-forms.js';

const APPLIANCE_TYPE_OPTIONS: { value: OrthodonticApplianceType; label: string; minAgeMonths: number }[] = [
  { value: 'twin-block',          label: 'Twin-Block 功能矫治器',   minAgeMonths: 48 },
  { value: 'expander',            label: '扩弓器',                minAgeMonths: 48 },
  { value: 'activator',           label: '功能性矫治器',            minAgeMonths: 48 },
  { value: 'metal-braces',        label: '金属固定矫治器',          minAgeMonths: 84 },
  { value: 'ceramic-braces',      label: '陶瓷固定矫治器',          minAgeMonths: 84 },
  { value: 'clear-aligner',       label: '隐形牙套',              minAgeMonths: 84 },
  { value: 'retainer-fixed',      label: '固定保持器',              minAgeMonths: 84 },
  { value: 'retainer-removable',  label: '活动保持器',              minAgeMonths: 84 },
];

interface Props {
  childId: string;
  childBirthDate: string;
  ageMonths: number;
}

export function OrthodonticTab({ childId, childBirthDate, ageMonths }: Props) {
  const [cases, setCases] = useState<OrthodonticCaseRow[]>([]);
  const [appliances, setAppliances] = useState<OrthodonticApplianceRow[]>([]);
  const [checkinsByAppliance, setCheckinsByAppliance] = useState<Record<string, OrthodonticCheckinRow[]>>({});
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCaseForm, setShowCaseForm] = useState(false);
  const [showApplianceForm, setShowApplianceForm] = useState(false);
  const [showClinicalEventModal, setShowClinicalEventModal] = useState(false);

  const activeCase = cases.find((c) => c.caseId === activeCaseId) ?? null;

  const reloadCases = useCallback(async () => {
    try {
      const rows = await getOrthodonticCases(childId);
      setCases(rows);
      if (!rows.find((c) => c.caseId === activeCaseId)) {
        setActiveCaseId(rows[0]?.caseId ?? null);
      }
    } catch (error) {
      catchLog('ortho', 'action:load-cases-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, [childId, activeCaseId]);

  const reloadAppliances = useCallback(async (caseId: string | null) => {
    if (!caseId) { setAppliances([]); return; }
    try {
      const rows = await getOrthodonticAppliances(caseId);
      setAppliances(rows);
    } catch (error) {
      catchLog('ortho', 'action:load-appliances-failed')(error);
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const reloadCheckins = useCallback(async (rows: OrthodonticApplianceRow[]) => {
    const next: Record<string, OrthodonticCheckinRow[]> = {};
    for (const appliance of rows) {
      try {
        next[appliance.applianceId] = await getOrthodonticCheckins({ applianceId: appliance.applianceId, limitDays: 30 });
      } catch (error) {
        catchLog('ortho', 'action:load-checkins-failed')(error);
      }
    }
    setCheckinsByAppliance(next);
  }, []);

  useEffect(() => {
    setLoading(true);
    reloadCases().finally(() => setLoading(false));
  }, [reloadCases]);

  useEffect(() => {
    reloadAppliances(activeCaseId);
  }, [activeCaseId, reloadAppliances]);

  useEffect(() => {
    reloadCheckins(appliances);
  }, [appliances, reloadCheckins]);

  const eligibleApplianceTypes = useMemo(
    () => APPLIANCE_TYPE_OPTIONS.filter((opt) => ageMonths >= opt.minAgeMonths),
    [ageMonths],
  );

  if (loading) {
    return <div className="p-6 text-[14px]" style={{ color: S.sub }}>加载中...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && (
        <div role="alert" className="p-3 rounded-xl text-[14px]"
          style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg(null)} className="ml-2 underline">
            关闭
          </button>
        </div>
      )}

      {/* Case list */}
      <section>
        <header className="flex items-center justify-between mb-3">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: S.text }}>正畸疗程</h3>
          <button
            type="button"
            onClick={() => setShowCaseForm(true)}
            className="text-[14px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: S.accent, padding: '6px 12px', borderRadius: 8, border: 0, cursor: 'pointer' }}
          >
            新建疗程
          </button>
        </header>

        {cases.length === 0 ? (
          <div className="p-5 rounded-2xl text-center text-[14px]"
            style={{ background: S.card, boxShadow: S.shadow, color: S.sub }}>
            还没有正畸疗程记录
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {cases.map((c) => (
              <button
                key={c.caseId}
                type="button"
                onClick={() => setActiveCaseId(c.caseId)}
                className="text-left p-4 rounded-2xl transition-all"
                style={{
                  background: c.caseId === activeCaseId ? 'rgba(78,204,163,0.08)' : S.card,
                  border: c.caseId === activeCaseId ? '1px solid rgba(78,204,163,0.4)' : '1px solid transparent',
                  boxShadow: S.shadow,
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[16px] font-semibold" style={{ color: S.text }}>
                      {caseTypeLabel(c.caseType)} · {stageLabel(c.stage)}
                    </div>
                    <div className="mt-1 text-[13px]" style={{ color: S.sub }}>
                      开始 {c.startedAt}
                      {c.nextReviewDate ? ` · 下次复诊 ${c.nextReviewDate}` : ''}
                      {c.providerInstitution ? ` · ${c.providerInstitution}` : ''}
                    </div>
                  </div>
                  {c.caseType === 'unknown-legacy' && (
                    <span className="text-[12px] px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(245,158,11,0.14)', color: '#b45309' }}>
                      历史数据
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Appliances of active case */}
      {activeCase && (
        <section>
          <header className="flex items-center justify-between mb-3">
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: S.text }}>装置</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`确定删除该疗程？相关装置与打卡会级联删除。`)) {
                    deleteOrthodonticCase(activeCase.caseId)
                      .then(() => reloadCases())
                      .catch((error) => {
                        catchLog('ortho', 'action:delete-case-failed')(error);
                        setErrorMsg(error instanceof Error ? error.message : String(error));
                      });
                  }
                }}
                className="text-[14px]"
                style={{ background: 'transparent', color: '#b91c1c', border: 0, cursor: 'pointer' }}
              >
                删除疗程
              </button>
              {activeCase.caseType !== 'unknown-legacy' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowClinicalEventModal(true)}
                    className="text-[14px] font-semibold"
                    style={{ background: '#eef2f6', color: S.text, padding: '6px 10px', borderRadius: 8, border: 0, cursor: 'pointer' }}
                    title="记录复诊、调整、异常或结束等临床事件（写入口腔时间线）"
                  >
                    记录临床事件
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowApplianceForm(true)}
                    className="text-[14px] font-semibold"
                    style={{ background: '#eef2f6', color: S.text, padding: '6px 10px', borderRadius: 8, border: 0, cursor: 'pointer' }}
                  >
                    添加装置
                  </button>
                </>
              )}
            </div>
          </header>

          {activeCase.caseType === 'unknown-legacy' && (
            <div className="p-4 rounded-2xl mb-3"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div className="text-[14px] font-semibold mb-1" style={{ color: '#b45309' }}>待确认历史疗程</div>
              <p className="text-[14px] mb-2" style={{ color: S.sub }}>
                该疗程由历史 <code>ortho-start</code> 记录回补生成。在您确认类型之前，新装置、打卡与协议提醒都不会启用（PO-ORTHO-002a）。
              </p>
              <ReclassifyLegacyCase
                caseRow={activeCase}
                onSaved={async () => {
                  await reloadCases();
                  await reloadAppliances(activeCase.caseId);
                }}
                onError={setErrorMsg}
              />
            </div>
          )}

          {appliances.length === 0 ? (
            <div className="p-4 rounded-xl text-[14px]"
              style={{ background: S.card, boxShadow: S.shadow, color: S.sub }}>
              该疗程还没有装置
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {appliances.map((appliance) => (
                <ApplianceCard
                  key={appliance.applianceId}
                  appliance={appliance}
                  checkins={checkinsByAppliance[appliance.applianceId] ?? []}
                  childId={childId}
                  caseId={activeCase.caseId}
                  onChanged={async () => {
                    await reloadAppliances(activeCase.caseId);
                    await reloadCases();
                  }}
                  onError={setErrorMsg}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showCaseForm && (
        <CaseFormModal
          childId={childId}
          onClose={() => setShowCaseForm(false)}
          onSaved={async () => {
            setShowCaseForm(false);
            await reloadCases();
          }}
          onError={setErrorMsg}
        />
      )}

      {showClinicalEventModal && activeCase && activeCase.caseType !== 'unknown-legacy' && (
        <OrthoClinicalEventModal
          childId={childId}
          childBirthDate={childBirthDate}
          activeAppliances={appliances.filter((a) => a.status === 'active')}
          onClose={() => setShowClinicalEventModal(false)}
          onSaved={async () => {
            setShowClinicalEventModal(false);
            // The clinical event writes to dental_records; ortho-review /
            // ortho-adjustment also advance the appliance review cycle and the
            // matching PO-ORTHO-REVIEW-* reminder_state. Reload so the case's
            // cached nextReviewDate, the appliance rows, and checkin state all
            // reflect the advance.
            await reloadAppliances(activeCase.caseId);
            await reloadCases();
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
            await reloadAppliances(activeCase.caseId);
            await reloadCases();
          }}
          onError={setErrorMsg}
        />
      )}
    </div>
  );
}

/* ── Appliance card with inline daily checkin ─────────────── */

function ApplianceCard({
  appliance,
  checkins,
  childId,
  caseId,
  onChanged,
  onError,
}: {
  appliance: OrthodonticApplianceRow;
  checkins: OrthodonticCheckinRow[];
  childId: string;
  caseId: string;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [wearHours, setWearHours] = useState<string>('');
  const today = new Date().toISOString().slice(0, 10);
  const todayCheckin = checkins.find((c) => c.checkinDate === today && (c.checkinType === 'wear-daily' || c.checkinType === 'retention-wear'));

  const canDailyCheckin = (appliance.applianceType === 'clear-aligner' || appliance.applianceType === 'retainer-removable' || appliance.applianceType === 'twin-block' || appliance.applianceType === 'activator') && appliance.status === 'active';

  const handleSubmitDaily = async () => {
    const hours = Number(wearHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      onError('请填写 0-24 之间的小时数');
      return;
    }
    try {
      onError(null);
      const checkinType: OrthodonticCheckinType = appliance.applianceType === 'retainer-removable' ? 'retention-wear' : 'wear-daily';
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId,
        caseId,
        applianceId: appliance.applianceId,
        checkinType,
        checkinDate: today,
        actualWearHours: hours,
        prescribedHours: appliance.prescribedHoursPerDay ?? null,
        activationIndex: null,
        alignerIndex: null,
        notes: null,
        now: isoNow(),
      });
      setWearHours('');
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:insert-checkin-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePause = async () => {
    const nextStatus: OrthodonticApplianceStatus = appliance.status === 'paused' ? 'active' : 'paused';
    const reason = nextStatus === 'paused' ? window.prompt('暂停原因：') : null;
    if (nextStatus === 'paused' && !reason) return;
    try {
      await updateOrthodonticApplianceStatus({
        applianceId: appliance.applianceId,
        status: nextStatus,
        pauseReason: reason,
        endedAt: null,
        now: isoNow(),
      });
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:toggle-pause-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const completeAppliance = async () => {
    if (!window.confirm('确认完成该装置？')) return;
    try {
      await updateOrthodonticApplianceStatus({
        applianceId: appliance.applianceId,
        status: 'completed',
        pauseReason: null,
        endedAt: new Date().toISOString().slice(0, 10),
        now: isoNow(),
      });
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:complete-appliance-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const removeAppliance = async () => {
    if (!window.confirm('确定删除该装置？相关打卡会级联删除。')) return;
    try {
      await deleteOrthodonticAppliance(appliance.applianceId);
      await onChanged();
    } catch (error) {
      catchLog('ortho', 'action:delete-appliance-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  /** aligner-change: parent indicates they've switched to the next clear-aligner stage. */
  const handleAlignerChange = async () => {
    const nextIndex = nextAlignerIndexForAppliance(checkins);
    const input = window.prompt(`请输入本次更换后的牙套序号（默认 ${nextIndex}）`, String(nextIndex));
    if (input === null) return;
    const alignerIndex = Number(input.trim());
    if (!Number.isInteger(alignerIndex) || alignerIndex < 1) {
      onError('牙套序号必须为 >= 1 的整数');
      return;
    }
    try {
      onError(null);
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId,
        caseId,
        applianceId: appliance.applianceId,
        checkinType: 'aligner-change',
        checkinDate: today,
        actualWearHours: null,
        prescribedHours: null,
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

  /** expander-activation: parent records one activation turn. */
  const handleExpanderActivation = async () => {
    const nextIndex = appliance.completedActivations + 1;
    if (appliance.prescribedActivations !== null && nextIndex > appliance.prescribedActivations) {
      onError(`扩弓已达到医嘱总次数 ${appliance.prescribedActivations}；停止加力`);
      return;
    }
    if (!window.confirm(`确认记录第 ${nextIndex} 次加力？`)) return;
    try {
      onError(null);
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId,
        caseId,
        applianceId: appliance.applianceId,
        checkinType: 'expander-activation',
        checkinDate: today,
        actualWearHours: null,
        prescribedHours: null,
        activationIndex: nextIndex,
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

  const last7 = checkins.filter((c) => c.checkinType === 'wear-daily' || c.checkinType === 'retention-wear').slice(0, 7);
  const latestAlignerIndex = checkins
    .filter((c) => c.checkinType === 'aligner-change' && typeof c.alignerIndex === 'number')
    .map((c) => c.alignerIndex as number)
    .sort((a, b) => b - a)[0] ?? null;
  const canAlignerChange = appliance.applianceType === 'clear-aligner' && appliance.status === 'active';
  const canExpanderActivation = appliance.applianceType === 'expander' && appliance.status === 'active'
    && (appliance.prescribedActivations === null || appliance.completedActivations < appliance.prescribedActivations);

  return (
    <div className="p-4 rounded-2xl" style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold" style={{ color: S.text }}>
            {applianceTypeLabel(appliance.applianceType)}
            <span className="ml-2 text-[12px] px-2 py-0.5 rounded-full"
              style={{
                background: appliance.status === 'active' ? 'rgba(34,197,94,0.14)' : appliance.status === 'paused' ? 'rgba(245,158,11,0.14)' : 'rgba(148,163,184,0.16)',
                color: appliance.status === 'active' ? '#15803d' : appliance.status === 'paused' ? '#b45309' : '#475569',
              }}>
              {appliance.status === 'active' ? '进行中' : appliance.status === 'paused' ? '已暂停' : '已完成'}
            </span>
          </div>
          <div className="mt-1 text-[13px]" style={{ color: S.sub }}>
            开始 {appliance.startedAt}
            {appliance.prescribedHoursPerDay ? ` · 医嘱 ${appliance.prescribedHoursPerDay} 小时/天` : ''}
            {appliance.nextReviewDate ? ` · 下次复诊 ${appliance.nextReviewDate}` : ''}
            {appliance.applianceType === 'expander' && appliance.prescribedActivations
              ? ` · 已激活 ${appliance.completedActivations}/${appliance.prescribedActivations}`
              : ''}
          </div>
          {appliance.pauseReason && (
            <div className="mt-1 text-[13px]" style={{ color: '#b45309' }}>
              暂停原因：{appliance.pauseReason}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {appliance.status !== 'completed' && (
            <button type="button" onClick={togglePause} className="text-[13px]"
              style={{ background: 'transparent', color: S.sub, border: 0, cursor: 'pointer' }}>
              {appliance.status === 'paused' ? '恢复' : '暂停'}
            </button>
          )}
          {appliance.status !== 'completed' && (
            <button type="button" onClick={completeAppliance} className="text-[13px]"
              style={{ background: 'transparent', color: S.sub, border: 0, cursor: 'pointer' }}>
              完成
            </button>
          )}
          <button type="button" onClick={removeAppliance} className="text-[13px]"
            style={{ background: 'transparent', color: '#b91c1c', border: 0, cursor: 'pointer' }}>
            删除
          </button>
        </div>
      </div>

      {canDailyCheckin && !todayCheckin && (
        <div className="mt-3 flex items-center gap-2 pt-3" style={{ borderTop: '1px solid rgba(226,232,240,0.6)' }}>
          <label className="text-[14px]" style={{ color: S.sub }}>今日佩戴小时数</label>
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={wearHours}
            onChange={(e) => setWearHours(e.target.value)}
            className="text-[14px] px-2 py-1 rounded-md"
            style={{ width: 70, border: '1px solid rgba(226,232,240,0.9)' }}
          />
          <button type="button" onClick={() => void handleSubmitDaily()}
            className="text-[14px] font-semibold text-white"
            style={{ background: S.accent, padding: '4px 10px', borderRadius: 6, border: 0, cursor: 'pointer' }}>
            打卡
          </button>
        </div>
      )}

      {todayCheckin && (
        <div className="mt-3 pt-3 text-[14px]" style={{ borderTop: '1px solid rgba(226,232,240,0.6)', color: S.sub }}>
          今日已打卡 {todayCheckin.actualWearHours} 小时 · {complianceBucketLabel(todayCheckin.complianceBucket)}
        </div>
      )}

      {(canAlignerChange || canExpanderActivation) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: '1px solid rgba(226,232,240,0.6)' }}>
          {canAlignerChange && (
            <>
              {latestAlignerIndex !== null && (
                <span className="text-[13px]" style={{ color: S.sub }}>当前：第 {latestAlignerIndex} 副</span>
              )}
              <button type="button" onClick={() => void handleAlignerChange()}
                className="text-[14px] font-semibold"
                style={{ background: '#eef2f6', color: S.text, padding: '4px 10px', borderRadius: 6, border: 0, cursor: 'pointer' }}>
                更换下一副牙套
              </button>
            </>
          )}
          {canExpanderActivation && (
            <>
              {appliance.prescribedActivations !== null && (
                <span className="text-[13px]" style={{ color: S.sub }}>已激活 {appliance.completedActivations}/{appliance.prescribedActivations}</span>
              )}
              <button type="button" onClick={() => void handleExpanderActivation()}
                className="text-[14px] font-semibold"
                style={{ background: '#eef2f6', color: S.text, padding: '4px 10px', borderRadius: 6, border: 0, cursor: 'pointer' }}>
                记录一次加力
              </button>
            </>
          )}
        </div>
      )}

      {last7.length > 0 && (
        <div className="mt-3 flex items-center gap-1">
          {last7.map((c) => (
            <div
              key={c.checkinId}
              title={`${c.checkinDate}: ${c.actualWearHours}h / ${c.prescribedHours}h`}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: c.complianceBucket === 'done' ? '#22c55e' : c.complianceBucket === 'partial' ? '#f59e0b' : c.complianceBucket === 'missed' ? '#ef4444' : '#cbd5e1',
              }}
            />
          ))}
          <span className="text-[12px] ml-2" style={{ color: S.sub }}>近 7 天达成率近似</span>
        </div>
      )}
    </div>
  );
}

/* ── Case form ───────────────────────────────────────────── */

/* ── Legacy re-classify (PO-ORTHO-002a) ──────────────────── */

function ReclassifyLegacyCase({
  caseRow,
  onSaved,
  onError,
}: {
  caseRow: OrthodonticCaseRow;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [selected, setSelected] = useState<WritableOrthodonticCaseType>('fixed-braces');
  const handleSubmit = async () => {
    try {
      onError(null);
      await updateOrthodonticCase({
        caseId: caseRow.caseId,
        caseType: selected,
        stage: caseRow.stage,
        startedAt: caseRow.startedAt,
        plannedEndAt: caseRow.plannedEndAt,
        actualEndAt: caseRow.actualEndAt,
        primaryIssues: caseRow.primaryIssues,
        providerName: caseRow.providerName,
        providerInstitution: caseRow.providerInstitution,
        notes: caseRow.notes,
        now: isoNow(),
      });
      await onSaved();
    } catch (error) {
      catchLog('ortho', 'action:reclassify-legacy-case-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-[14px]" style={{ color: S.sub }}>重新归类为：</label>
      <select value={selected} onChange={(e) => setSelected(e.target.value as WritableOrthodonticCaseType)}
        className="text-[14px] px-2 py-1 rounded-md"
        style={{ border: '1px solid rgba(226,232,240,0.9)' }}>
        {CASE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button type="button" onClick={() => void handleSubmit()}
        className="text-[14px] font-semibold text-white"
        style={{ background: S.accent, padding: '4px 10px', borderRadius: 6, border: 0, cursor: 'pointer' }}>
        确认归类
      </button>
    </div>
  );
}

/* CaseFormModal, ApplianceFormModal, OrthoClinicalEventModal, Modal,
 * ModalFooter, FieldSelect, FieldInput, FieldTextarea now live in
 * ./orthodontic-tab-forms.tsx so this file stays under the 800-line
 * governance threshold. ORTHO_CLINICAL_EVENT_OPTIONS is also owned there. */

/* ── Labels ──────────────────────────────────────────────── */

function caseTypeLabel(t: string): string {
  return CASE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? (t === 'unknown-legacy' ? '历史疗程' : t);
}

function stageLabel(s: string): string {
  return STAGE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

function applianceTypeLabel(t: string): string {
  return APPLIANCE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function complianceBucketLabel(b: string | null): string {
  switch (b) {
    case 'done':    return '达成';
    case 'partial': return '部分达成';
    case 'missed':  return '缺席';
    default:        return '未计算';
  }
}

/** Next aligner index = max(alignerIndex) + 1 across prior aligner-change checkins. */
function nextAlignerIndexForAppliance(checkins: OrthodonticCheckinRow[]): number {
  const indices = checkins
    .filter((c) => c.checkinType === 'aligner-change' && typeof c.alignerIndex === 'number')
    .map((c) => c.alignerIndex as number);
  if (indices.length === 0) return 1;
  return Math.max(...indices) + 1;
}
