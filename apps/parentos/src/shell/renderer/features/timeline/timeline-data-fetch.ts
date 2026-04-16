import * as React from 'react';
import {
  getAllergyRecords,
  getCustomTodos,
  getGrowthReports,
  getJournalEntries,
  getMeasurements,
  getMilestoneRecords,
  getOutdoorGoal,
  getOutdoorRecords,
  getReminderStates,
  getSleepRecords,
  getVaccineRecords,
} from '../../bridge/sqlite-bridge.js';
import { mapReminderStateRow } from '../../engine/reminder-engine.js';
import type { DashData } from './timeline-data-types.js';

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
};

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
    const [rs, ms, vs, mi, jo, sl, al, rp, ct, or, og] = await Promise.allSettled([
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
    ]);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const allReports = rp.status === 'fulfilled' ? rp.value : [];
    const thisMonthReport = allReports.find((report) => report.periodStart >= monthStart) ?? null;
    const vaccineRecords = vs.status === 'fulfilled' ? vs.value : [];

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
