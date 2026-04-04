import { useEffect, useState } from 'react';
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
    return <div className="p-8 text-gray-500">Add a child profile to unlock reports.</div>;
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
    <div className="flex h-full bg-white">
      <aside className="flex w-72 flex-col gap-4 border-r border-gray-200 bg-gray-50 p-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="mt-1 text-sm text-gray-600">
            Structured local reports only. No free-form AI explanation is used for needs-review domains.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div>
            <label htmlFor="report-type" className="block text-sm font-medium text-gray-700">
              Report format
            </label>
            <select
              id="report-type"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as GrowthReportType)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              {reportTypeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {reportTypeOptions.find((option) => option.id === reportType)?.detail}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generateState === 'saving'}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generateState === 'saving' ? 'Generating structured report...' : 'Generate structured report'}
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Saved reports</p>
          <div className="space-y-2 overflow-auto">
            {reports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
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
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selectedReportId === report.reportId
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">{title}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {report.reportType} · {report.periodStart.slice(0, 10)} to {report.periodEnd.slice(0, 10)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8">
        {errorMessage && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {!selectedReport ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-gray-500">
            Generate the first structured report to populate this workspace.
          </div>
        ) : parsedError || !parsedContent ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {parsedError}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                {parsedContent.reportType}
              </p>
              <h2 className="mt-2 text-3xl font-bold text-gray-900">{parsedContent.title}</h2>
              <p className="mt-2 text-sm text-gray-600">{parsedContent.subtitle}</p>
              <p className="mt-4 text-sm text-amber-700">{parsedContent.safetyNote}</p>
            </header>

            <section className="grid gap-4 md:grid-cols-5">
              {parsedContent.metrics.map((metric) => (
                <div key={metric.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{metric.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{metric.value}</div>
                  {metric.detail && <div className="mt-1 text-xs text-gray-500">{metric.detail}</div>}
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Overview</h3>
              <ul className="mt-4 space-y-3 text-sm text-gray-700">
                {parsedContent.overview.map((item) => (
                  <li key={item} className="rounded-xl bg-gray-50 px-4 py-3">
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            {parsedContent.trendSignals.length > 0 && (
              <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">Trend signals</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {parsedContent.trendSignals.map((signal) => (
                    <div key={signal.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h4 className="text-sm font-semibold text-slate-900">{signal.title}</h4>
                      <p className="mt-2 text-sm text-slate-700">{signal.summary}</p>
                      <ul className="mt-3 space-y-2 text-xs text-slate-600">
                        {signal.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      <p className="mt-3 text-xs text-slate-500">
                        Sources: {signal.sources.join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="grid gap-4 md:grid-cols-2">
              {parsedContent.sections.map((section) => (
                <div key={section.id} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-gray-900">{section.title}</h3>
                  <ul className="mt-4 space-y-3 text-sm text-gray-700">
                    {section.items.map((item) => (
                      <li key={item} className="rounded-xl bg-gray-50 px-4 py-3">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Sources</h3>
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
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
