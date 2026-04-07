import { useEffect, useState } from 'react';
import { S } from '../../app-shell/page-style.js';
import { useAppStore } from '../../app-shell/app-store.js';
import {
  getGrowthReports,
  getJournalEntries,
  getMeasurements,
  getMilestoneRecords,
  getReminderStates,
  getVaccineRecords,
  insertGrowthReport,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import {
  buildStructuredGrowthReport,
  parseStructuredGrowthReportContent,
  type GrowthReportType,
} from './structured-report.js';

type PersistedReport = Awaited<ReturnType<typeof getGrowthReports>>[number];
type GenerateState = 'idle' | 'saving' | 'error';

const reportTypeOptions: Array<{ id: GrowthReportType; label: string; detail: string }> = [
  { id: 'monthly', label: 'Monthly report', detail: 'Calendar month to date' },
  { id: 'quarterly', label: 'Quarterly report', detail: 'Calendar quarter to date' },
  { id: 'quarterly-letter', label: 'Quarterly letter', detail: 'Same data, more parent-facing framing' },
];

export default function ReportsPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [reports, setReports] = useState<PersistedReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportType, setReportType] = useState<GrowthReportType>('quarterly-letter');
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!child) {
      setReports([]);
      setSelectedReportId(null);
      return;
    }

    const effectChild = child;
    let cancelled = false;

    async function loadReports() {
      try {
        const rows = await getGrowthReports(effectChild.childId);
        if (cancelled) return;
        setReports(rows);
        setSelectedReportId((current) => current ?? rows[0]?.reportId ?? null);
      } catch {
        if (cancelled) return;
        setErrorMessage('Failed to load reports from local storage.');
      }
    }

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [child]);

  if (!child) {
    return <div className="p-8" style={{ color: S.sub }}>Add a child profile to unlock reports.</div>;
  }

  const activeChild = child;
  const selectedReport = reports.find((item) => item.reportId === selectedReportId) ?? reports[0] ?? null;

  let parsedContent = null;
  let parsedError = null;
  if (selectedReport) {
    try {
      parsedContent = parseStructuredGrowthReportContent(selectedReport.content);
    } catch {
      parsedError = 'Stored report content is invalid and cannot be rendered.';
    }
  }

  async function loadReportsForChild(nextSelectedReportId?: string) {
    const rows = await getGrowthReports(activeChild.childId);
    setReports(rows);
    setSelectedReportId(nextSelectedReportId ?? rows[0]?.reportId ?? null);
  }

  const handleGenerate = async () => {
    setGenerateState('saving');
    setErrorMessage(null);

    try {
      const now = isoNow();
      const [measurements, milestones, vaccines, journalEntries, reminderStates] = await Promise.all([
        getMeasurements(activeChild.childId),
        getMilestoneRecords(activeChild.childId),
        getVaccineRecords(activeChild.childId),
        getJournalEntries(activeChild.childId, 200),
        getReminderStates(activeChild.childId),
      ]);

      const report = buildStructuredGrowthReport({
        child: activeChild,
        reportType,
        now,
        measurements,
        milestones,
        vaccines,
        journalEntries,
        reminderStates,
      });

      const reportId = ulid();
      await insertGrowthReport({
        reportId,
        childId: activeChild.childId,
        reportType: report.reportType,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        ageMonthsStart: report.ageMonthsStart,
        ageMonthsEnd: report.ageMonthsEnd,
        content: JSON.stringify(report.content),
        generatedAt: now,
        now,
      });

      await loadReportsForChild(reportId);
      setGenerateState('idle');
    } catch {
      setGenerateState('error');
      setErrorMessage('Failed to generate and store a structured local report.');
    }
  };

  return (
    <div className="flex h-full" style={{ background: S.bg, minHeight: '100%' }}>
      <aside className="flex w-72 flex-col gap-4 p-4" style={{ borderRight: `1px solid ${S.border}`, background: S.bg }}>
        <div>
          <h1 className="text-xl font-bold mb-6" style={{ color: S.text }}>成长报告</h1>
          <p className="mt-1 text-sm" style={{ color: S.sub }}>
            Structured local reports only. No free-form AI explanation is used for needs-review domains.
          </p>
        </div>

        <div className={`space-y-3 ${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div>
            <label htmlFor="report-type" className="block text-sm font-medium" style={{ color: S.text }}>
              Report format
            </label>
            <select
              id="report-type"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as GrowthReportType)}
              className={`mt-1 w-full ${S.radiusSm} px-3 py-2 text-sm`}
              style={{ border: `1px solid ${S.border}`, background: S.card }}
            >
              {reportTypeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: S.sub }}>
              {reportTypeOptions.find((option) => option.id === reportType)?.detail}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generateState === 'saving'}
            className={`w-full ${S.radiusSm} px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60`}
            style={{ background: S.accent }}
          >
            {generateState === 'saving' ? 'Generating structured report...' : 'Generate structured report'}
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: S.sub }}>Saved reports</p>
          <div className="space-y-2 overflow-auto">
            {reports.length === 0 ? (
              <div className={`${S.radius} p-4 text-sm`} style={{ border: `1px dashed ${S.border}`, background: S.card, color: S.sub }}>
                No saved reports yet.
              </div>
            ) : (
              reports.map((report) => {
                let title = `${report.reportType} report`;
                try {
                  title = parseStructuredGrowthReportContent(report.content).title;
                } catch {
                  // Fail closed in the main panel; keep history visible.
                }

                return (
                  <button
                    type="button"
                    key={report.reportId}
                    onClick={() => setSelectedReportId(report.reportId)}
                    className={`w-full ${S.radius} p-3 text-left transition-colors`}
                    style={{
                      border: `1px solid ${selectedReportId === report.reportId ? S.accent : S.border}`,
                      background: selectedReportId === report.reportId ? '#e8eccc' : S.card,
                    }}
                  >
                    <div className="text-sm font-medium" style={{ color: S.text }}>{title}</div>
                    <div className="mt-1 text-xs" style={{ color: S.sub }}>
                      {report.reportType} · {report.periodStart.slice(0, 10)} to {report.periodEnd.slice(0, 10)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8" style={{ background: S.bg }}>
        {errorMessage && (
          <div className={`mb-4 ${S.radius} px-4 py-3 text-sm`} style={{ border: '1px solid #fed7d7', background: '#fff5f5', color: '#c53030' }}>
            {errorMessage}
          </div>
        )}

        {!selectedReport ? (
          <div className={`${S.radius} p-10 text-center`} style={{ border: `1px dashed ${S.border}`, color: S.sub }}>
            Generate the first structured report to populate this workspace.
          </div>
        ) : parsedError || !parsedContent ? (
          <div className={`${S.radius} p-6 text-sm`} style={{ border: '1px solid #fed7d7', background: '#fff5f5', color: '#c53030' }}>
            {parsedError}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            <header className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: S.accent }}>
                {parsedContent.reportType}
              </p>
              <h2 className="mt-2 text-3xl font-bold" style={{ color: S.text }}>{parsedContent.title}</h2>
              <p className="mt-2 text-sm" style={{ color: S.sub }}>{parsedContent.subtitle}</p>
              <p className="mt-4 text-sm text-amber-700">{parsedContent.safetyNote}</p>
            </header>

            <section className="grid gap-4 md:grid-cols-5">
              {parsedContent.metrics.map((metric) => (
                <div key={metric.id} className={`${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
                  <div className="text-xs uppercase tracking-wide" style={{ color: S.sub }}>{metric.label}</div>
                  <div className="mt-2 text-2xl font-semibold" style={{ color: S.text }}>{metric.value}</div>
                  {metric.detail && <div className="mt-1 text-xs" style={{ color: S.sub }}>{metric.detail}</div>}
                </div>
              ))}
            </section>

            <section className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
              <h3 className="text-lg font-semibold" style={{ color: S.text }}>Overview</h3>
              <ul className="mt-4 space-y-3 text-sm" style={{ color: S.text }}>
                {parsedContent.overview.map((item) => (
                  <li key={item} className={`${S.radiusSm} px-4 py-3`} style={{ background: S.bg }}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            {parsedContent.trendSignals.length > 0 && (
              <section className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
                <h3 className="text-lg font-semibold" style={{ color: S.text }}>Trend signals</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {parsedContent.trendSignals.map((signal) => (
                    <div key={signal.id} className={`${S.radius} p-4`} style={{ background: S.bg, border: `1px solid ${S.border}` }}>
                      <h4 className="text-sm font-semibold" style={{ color: S.text }}>{signal.title}</h4>
                      <p className="mt-2 text-sm" style={{ color: S.text }}>{signal.summary}</p>
                      <ul className="mt-3 space-y-2 text-xs" style={{ color: S.sub }}>
                        {signal.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      <p className="mt-3 text-xs" style={{ color: S.sub }}>
                        Sources: {signal.sources.join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="grid gap-4 md:grid-cols-2">
              {parsedContent.sections.map((section) => (
                <div key={section.id} className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
                  <h3 className="text-lg font-semibold" style={{ color: S.text }}>{section.title}</h3>
                  <ul className="mt-4 space-y-3 text-sm" style={{ color: S.text }}>
                    {section.items.map((item) => (
                      <li key={item} className={`${S.radiusSm} px-4 py-3`} style={{ background: S.bg }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section className={`${S.radius} p-6`} style={{ background: S.card, boxShadow: S.shadow }}>
              <h3 className="text-lg font-semibold" style={{ color: S.text }}>Sources</h3>
              <ul className="mt-4 space-y-2 text-sm" style={{ color: S.text }}>
                {parsedContent.sources.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
