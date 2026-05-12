import * as React from 'react';
import {
  getAllergyRecords,
  getCustomTodos,
  getGrowthReports,
  getJournalEntries,
  getMeasurements,
  getMilestoneRecords,
  getOrthodonticCheckins,
  getOrthodonticDashboard,
  getOutdoorGoal,
  getOutdoorRecords,
  getReminderStates,
  getSleepRecords,
  getVaccineRecords,
  type OrthodonticApplianceRow,
  type OrthodonticCheckinRow,
} from '../../bridge/sqlite-bridge.js';
import { mapReminderStateRow, getLocalToday } from '../../engine/reminder-engine.js';
import type { DashData, OrthoCycleSummary } from './timeline-data-types.js';

const EMPTY: DashData = {
  reminderStates: [],
  measurements: [],
  vaccineRecords: [],
  vaccineCount: 0,
  milestoneRecords: [],
  journalEntries: [],
  sleepRecords: [],
  allergyRecords: [],
  customTodos: [],
  latestMonthlyReport: null,
  outdoorRecords: [],
  outdoorGoalMinutes: null,
  orthoCycle: null,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function deriveOrthoCycle(
  appliance: OrthodonticApplianceRow,
  checkins: OrthodonticCheckinRow[],
  localToday: string,
): OrthoCycleSummary | null {
  if (
    appliance.applianceType !== 'clear-aligner' ||
    appliance.status !== 'active' ||
    !appliance.daysPerAligner ||
    !appliance.totalAligners
  ) {
    return null;
  }
  const alignerChangeCheckins = checkins
    .filter((c) => c.applianceId === appliance.applianceId && c.checkinType === 'aligner-change')
    .sort((a, b) => a.checkinDate.localeCompare(b.checkinDate));
  const latestChange = alignerChangeCheckins[alignerChangeCheckins.length - 1] ?? null;
  const cycleAnchor = latestChange?.checkinDate ?? appliance.startedAt;
  const latestIndex = alignerChangeCheckins.reduce(
    (acc, c) => (c.alignerIndex !== null ? Math.max(acc, c.alignerIndex) : acc),
    0,
  );
  const currentAlignerIndex = Math.max(1, latestIndex);
  const todayMs = Date.UTC(
    Number(localToday.slice(0, 4)),
    Number(localToday.slice(5, 7)) - 1,
    Number(localToday.slice(8, 10)),
  );
  const anchorMs = Date.UTC(
    Number(cycleAnchor.slice(0, 4)),
    Number(cycleAnchor.slice(5, 7)) - 1,
    Number(cycleAnchor.slice(8, 10)),
  );
  const daysSinceAnchor = Math.max(0, Math.round((todayMs - anchorMs) / MS_PER_DAY));
  const daysUntilSwitch = appliance.daysPerAligner - daysSinceAnchor;
  const predictedMs = anchorMs + appliance.daysPerAligner * MS_PER_DAY;
  const predictedDate = new Date(predictedMs).toISOString().slice(0, 10);
  return {
    applianceId: appliance.applianceId,
    daysPerAligner: appliance.daysPerAligner,
    totalAligners: appliance.totalAligners,
    currentAlignerIndex,
    cycleAnchor,
    daysSinceAnchor,
    daysUntilSwitch,
    predictedSwitchDate: predictedDate,
    isFinalAligner: currentAlignerIndex >= appliance.totalAligners,
  };
}

export function useDash(childId: string | null) {
  const [d, setD] = React.useState<DashData>(EMPTY);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    if (!childId) {
      setD(EMPTY);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [rs, ms, vs, mi, jo, sl, al, rp, ct, or, og, od] = await Promise.allSettled([
      getReminderStates(childId),
      getMeasurements(childId),
      getVaccineRecords(childId),
      getMilestoneRecords(childId),
      getJournalEntries(childId, 50),
      getSleepRecords(childId, 14),
      getAllergyRecords(childId),
      getGrowthReports(childId),
      getCustomTodos(childId),
      getOutdoorRecords(childId),
      getOutdoorGoal(childId),
      getOrthodonticDashboard(childId),
    ]);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const allReports = rp.status === 'fulfilled' ? rp.value : [];
    const thisMonthReport = allReports.find((report) => report.periodStart >= monthStart) ?? null;
    const vaccineRecords = vs.status === 'fulfilled' ? vs.value : [];

    // Active clear-aligner cycle summary (calendar-based) for the right-rail
    // progress widget. No active clear-aligner → null and the widget hides.
    let orthoCycle: OrthoCycleSummary | null = null;
    if (od.status === 'fulfilled') {
      const activeAligner = od.value.activeAppliances.find(
        (a) => a.applianceType === 'clear-aligner' && a.status === 'active',
      );
      if (activeAligner) {
        const checkinsResult = await getOrthodonticCheckins({
          applianceId: activeAligner.applianceId,
          limitDays: null,
        }).catch(() => [] as OrthodonticCheckinRow[]);
        orthoCycle = deriveOrthoCycle(activeAligner, checkinsResult, getLocalToday());
      }
    }

    setD({
      reminderStates: rs.status === 'fulfilled' ? rs.value.map(mapReminderStateRow) : [],
      measurements: ms.status === 'fulfilled' ? ms.value : [],
      vaccineRecords,
      vaccineCount: vaccineRecords.length,
      milestoneRecords:
        mi.status === 'fulfilled'
          ? mi.value.map((item) => ({ milestoneId: item.milestoneId, achievedAt: item.achievedAt }))
          : [],
      journalEntries:
        jo.status === 'fulfilled'
          ? jo.value.map((entry) => ({
              entryId: entry.entryId,
              contentType: entry.contentType,
              textContent: entry.textContent,
              recordedAt: entry.recordedAt,
              observationMode: entry.observationMode,
              keepsake: entry.keepsake,
              keepsakeTitle: entry.keepsakeTitle ?? null,
              keepsakeReason: entry.keepsakeReason ?? null,
              dimensionId: entry.dimensionId,
            }))
          : [],
      sleepRecords: sl.status === 'fulfilled' ? sl.value : [],
      allergyRecords:
        al.status === 'fulfilled'
          ? al.value.map((item) => ({
              allergen: item.allergen,
              category: item.category,
              severity: item.severity,
              status: item.status,
              notes: item.notes,
            }))
          : [],
      customTodos: ct.status === 'fulfilled' ? ct.value : [],
      outdoorRecords: or.status === 'fulfilled' ? or.value : [],
      outdoorGoalMinutes: og.status === 'fulfilled' ? og.value : null,
      orthoCycle,
      latestMonthlyReport:
        thisMonthReport
          ? {
              reportId: thisMonthReport.reportId,
              content: thisMonthReport.content,
              periodStart: thisMonthReport.periodStart,
              generatedAt: thisMonthReport.generatedAt,
            }
          : null,
    });
    setLoading(false);
  }, [childId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return { d, loading, reload: load };
}
