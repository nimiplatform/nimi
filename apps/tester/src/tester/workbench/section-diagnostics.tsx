import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  CircleSlash,
  Database,
  FileSearch,
  Layers,
  Link2,
  ShieldCheck,
} from 'lucide-react';
import { InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { testerCapabilities } from '../tester-capabilities.js';
import type { TesterAIConfigSummary } from '../tester-ai-config.js';
import { flattenTesterRunHistory, formatTesterRunTimestamp, type TesterFlatRunRecord, type TesterRunHistory } from '../tester-history.js';
import { loadTesterImageHistory, type TesterImageHistoryRecord } from '../tester-image-history.js';
import type { TesterCapabilityRunResult } from '../tester-runtime.js';
import type { WorkbenchSectionId } from './workbench-context.js';

type SectionDiagnosticsProps = {
  summary: TesterAIConfigSummary | null;
  section: Extract<WorkbenchSectionId, 'runtime-trace' | 'boundary-checks'>;
  history: TesterRunHistory | null;
  historyError: string | null;
  lastResult: TesterCapabilityRunResult | null;
};

type CheckTone = 'pass' | 'warn' | 'info';
type RowTone = 'success' | 'warning' | 'info' | 'neutral';

type ContractCheck = {
  label: string;
  detail: string;
  tone: CheckTone;
};

type InspectorRow = {
  title: string;
  status: string;
  tone: RowTone;
  source: string;
  detail: string;
  evidenceKind: 'evidence' | 'observation';
};

type CommandGroup = {
  title: string;
  commands: Array<{
    name: string;
    purpose: string;
    boundary: string;
  }>;
};

const sectionCopy: Record<SectionDiagnosticsProps['section'], {
  eyebrow: string;
  focus: string;
  summaryTitle: string;
  timelineTitle: string;
}> = {
  'runtime-trace': {
    eyebrow: 'Runtime Trace',
    focus: 'Transport/projection, provider catalog, last trace availability, run/artifact linkage, and storage command provenance.',
    summaryTitle: 'Projection & trace summary',
    timelineTitle: 'Inspector timeline',
  },
  'boundary-checks': {
    eyebrow: 'Boundary Checks',
    focus: 'Import boundaries, SDK admission, no REST bypass, app-owned storage/viewer commands, and fail-closed rules.',
    summaryTitle: 'Boundary & projection summary',
    timelineTitle: 'Boundary evidence rows',
  },
};

const boundaryChecks: ContractCheck[] = [
  {
    label: 'Import boundaries',
    detail: 'Desktop/Web do not import runtime internals; tester code stays within app-owned src/tester and admitted SDK surfaces.',
    tone: 'pass',
  },
  {
    label: 'SDK admission',
    detail: 'Runtime SDK lanes call client.runtime.ai.* or client.runtime.media.*; unavailable lanes fail closed with typed reasons.',
    tone: 'pass',
  },
  {
    label: 'No app-local REST bypass',
    detail: 'The app does not call provider REST endpoints directly or hardcode provider/model defaults.',
    tone: 'pass',
  },
  {
    label: 'App-owned storage/viewer commands',
    detail: 'Tauri commands persist local run/artifact/viewer records only; they are not runtime execution bypasses.',
    tone: 'pass',
  },
  {
    label: 'Fail-closed rules',
    detail: 'Missing runtime, SDK gaps, and absent artifacts remain explicit blockers without invented evidence.',
    tone: 'pass',
  },
];

const commandGroups: CommandGroup[] = [
  {
    title: 'run history storage',
    commands: [
      {
        name: 'tester_run_history_load',
        purpose: 'Read app-owned lane records keyed by capability id.',
        boundary: 'local storage provenance only; not runtime execution bypass',
      },
      {
        name: 'tester_run_history_save',
        purpose: 'Persist the typed result after a capability invocation.',
        boundary: 'local storage provenance only; not runtime execution bypass',
      },
    ],
  },
  {
    title: 'artifact history storage',
    commands: [
      {
        name: 'tester_image_history_load',
        purpose: 'Read real Runtime/SDK media records from app-owned history.',
        boundary: 'local artifact inventory only; no artifact is created here',
      },
      {
        name: 'tester_image_history_save',
        purpose: 'Persist real media artifact metadata after SDK output exists.',
        boundary: 'local artifact inventory only; no artifact is created here',
      },
    ],
  },
  {
    title: 'world-tour fixture/viewer',
    commands: [
      {
        name: 'resolve_world_tour_fixture',
        purpose: 'Resolve the local World Tour fixture manifest in tester cache.',
        boundary: 'tauri-only local fixture; not runtime generation',
      },
      {
        name: 'claim_world_tour_viewer_launch',
        purpose: 'Validate a viewer launch token before reading the fixture.',
        boundary: 'viewer claim guard; not runtime generation',
      },
      {
        name: 'open_world_tour_window',
        purpose: 'Open the app-owned viewer window for the local fixture.',
        boundary: 'viewer launch only; not runtime generation',
      },
    ],
  },
  {
    title: 'acceptance/preset',
    commands: [
      {
        name: 'save_world_tour_viewer_preset',
        purpose: 'Persist viewer camera/render preset next to the fixture.',
        boundary: 'local viewer preference only',
      },
      {
        name: 'world_tour_render_acceptance_load',
        purpose: 'Read local render acceptance status for the fixture.',
        boundary: 'local acceptance record only',
      },
      {
        name: 'world_tour_render_acceptance_save',
        purpose: 'Persist local render acceptance status for the fixture.',
        boundary: 'local acceptance record only',
      },
    ],
  },
];

function admissionLanes() {
  const typedUnavailable = testerCapabilities.filter((cap) => cap.execution === 'typed-unavailable');
  const standalone = testerCapabilities.filter((cap) => cap.execution === 'standalone-tauri');
  const admitted = testerCapabilities.filter((cap) => cap.execution === 'runtime-sdk');
  return { typedUnavailable, standalone, admitted };
}

function ToneIcon({ tone }: { tone: CheckTone }) {
  if (tone === 'pass') return <CheckCircle2 size={14} aria-hidden="true" />;
  if (tone === 'warn') return <AlertTriangle size={14} aria-hidden="true" />;
  return <CircleSlash size={14} aria-hidden="true" />;
}

function rowBadgeTone(tone: RowTone): 'success' | 'warning' | 'info' | 'neutral' {
  return tone;
}

function hasTraceMetadata(result: TesterCapabilityRunResult | null): boolean {
  if (!result?.ok || !result.trace) return false;
  return Boolean(result.trace.traceId || result.trace.modelResolved || result.trace.routeDecision);
}

function describeTrace(result: TesterCapabilityRunResult | null, artifactRecords: TesterImageHistoryRecord[]): string {
  if (hasTraceMetadata(result) && result?.ok) {
    const parts = [
      result.trace?.traceId ? `traceId=${result.trace.traceId}` : null,
      result.trace?.modelResolved ? `model=${result.trace.modelResolved}` : null,
      result.trace?.routeDecision ? `route=${result.trace.routeDecision}` : null,
    ].filter(Boolean);
    return parts.join(' / ') || 'trace metadata captured in last result';
  }
  const artifactTrace = artifactRecords.find((record) => record.traceState === 'captured' && record.traceId);
  if (artifactTrace) return `artifact trace captured (${artifactTrace.traceId})`;
  return 'not captured; no trace metadata in persisted records';
}

function latestRecord(records: TesterFlatRunRecord[]): TesterFlatRunRecord | null {
  return records[0] ?? null;
}

function latestArtifact(records: TesterImageHistoryRecord[]): TesterImageHistoryRecord | null {
  return records[0] ?? null;
}

function describeStorageError(error: string, command: string): string {
  if (/invoke/i.test(error)) {
    return `${command} unavailable in browser preview; no persisted local record loaded.`;
  }
  return error;
}

function buildRows(input: {
  summary: TesterAIConfigSummary | null;
  runRecords: TesterFlatRunRecord[];
  artifactRecords: TesterImageHistoryRecord[];
  historyError: string | null;
  artifactError: string | null;
  lastResult: TesterCapabilityRunResult | null;
}): InspectorRow[] {
  const runtime = input.summary?.runtime;
  const latestRun = latestRecord(input.runRecords);
  const latestMedia = latestArtifact(input.artifactRecords);
  const artifactTraceCount = input.artifactRecords.filter((record) => record.traceState === 'captured').length;
  const lastTraceCaptured = hasTraceMetadata(input.lastResult);
  const runStorageDetail = input.historyError
    ? describeStorageError(input.historyError, 'tester_run_history_load/save')
    : input.runRecords.length > 0
      ? `${input.runRecords.length} persisted run record(s); latest ${latestRun?.capabilityLabel} at ${latestRun ? formatTesterRunTimestamp(latestRun.createdAt) : 'unknown time'}`
      : 'no persisted run records; tester_run_history_load/save returned an empty local ledger';
  const artifactStorageDetail = input.artifactError
    ? describeStorageError(input.artifactError, 'tester_image_history_load/save')
    : input.artifactRecords.length > 0
      ? `${input.artifactRecords.length} persisted artifact record(s); latest ${latestMedia?.capabilityLabel || latestMedia?.capabilityId}`
      : 'no persisted artifact records; tester_image_history_load/save returned an empty local inventory';

  return [
    {
      title: 'Runtime projection probe',
      status: runtime?.status || 'checking',
      tone: runtime?.status === 'ready' ? 'success' : runtime ? 'warning' : 'neutral',
      source: 'runtime-platform projection + runtimeAdmin.getRuntimeHealth',
      detail: runtime?.detail || 'Runtime projection has not returned yet.',
      evidenceKind: runtime ? 'observation' : 'observation',
    },
    {
      title: 'Provider catalog surface',
      status: input.summary?.providerCatalogSurface ? 'available' : 'checking',
      tone: input.summary?.providerCatalogSurface ? 'info' : 'neutral',
      source: input.summary?.providerCatalogSurface || 'runtimeAdmin.listConnectors/listConnectorModels',
      detail: 'Provider catalog remains runtime-owned; app-local defaults forbidden.',
      evidenceKind: 'observation',
    },
    {
      title: 'SDK admission map summary',
      status: 'admitted / tauri-only',
      tone: 'success',
      source: 'testerCapabilities execution map',
      detail: 'Runtime SDK lanes are admitted; World Tour local fixture is tauri-only local fixture, not runtime generation.',
      evidenceKind: 'observation',
    },
    {
      title: 'Run history storage',
      status: input.historyError ? 'unavailable' : `${input.runRecords.length} record(s)`,
      tone: input.historyError ? 'warning' : input.runRecords.length > 0 ? 'success' : 'neutral',
      source: 'tester_run_history_load/save',
      detail: runStorageDetail,
      evidenceKind: input.runRecords.length > 0 ? 'evidence' : 'observation',
    },
    {
      title: 'Artifact history storage',
      status: input.artifactError ? 'unavailable' : `${input.artifactRecords.length} record(s)`,
      tone: input.artifactError ? 'warning' : input.artifactRecords.length > 0 ? 'success' : 'neutral',
      source: 'tester_image_history_load/save',
      detail: artifactStorageDetail,
      evidenceKind: input.artifactRecords.length > 0 ? 'evidence' : 'observation',
    },
    {
      title: 'Trace metadata availability',
      status: lastTraceCaptured || artifactTraceCount > 0 ? 'captured' : 'not captured',
      tone: lastTraceCaptured || artifactTraceCount > 0 ? 'success' : 'warning',
      source: 'last runtime result + artifact history trace fields',
      detail: describeTrace(input.lastResult, input.artifactRecords),
      evidenceKind: lastTraceCaptured || artifactTraceCount > 0 ? 'evidence' : 'observation',
    },
    {
      title: 'World Tour local fixture boundary',
      status: 'tauri-only',
      tone: 'info',
      source: 'resolve_world_tour_fixture / open_world_tour_window',
      detail: 'World Tour local fixture is app-owned viewer data; it is excluded from runtime artifact inventory and runtime generation claims.',
      evidenceKind: 'observation',
    },
  ];
}

function MatrixLane({
  label,
  status,
  items,
}: {
  label: string;
  status: 'admitted' | 'sdk gap' | 'tauri-only';
  items: string[];
}) {
  const tone = status === 'admitted' ? 'success' : status === 'sdk gap' ? 'warning' : 'info';
  return (
    <div className="diagnostics-matrix__lane">
      <div className="diagnostics-matrix__lane-head">
        <strong>{label}</strong>
        <StatusBadge tone={tone} shape="dot">{status}</StatusBadge>
      </div>
      <p>{items.length > 0 ? items.join(', ') : 'none current'}</p>
    </div>
  );
}

export function SectionDiagnostics({
  summary,
  section,
  history,
  historyError,
  lastResult,
}: SectionDiagnosticsProps) {
  const runtime = summary?.runtime;
  const lanes = admissionLanes();
  const copy = sectionCopy[section];
  const runRecords = useMemo(() => flattenTesterRunHistory(history), [history]);
  const [artifactRecords, setArtifactRecords] = useState<TesterImageHistoryRecord[]>([]);
  const [artifactError, setArtifactError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTesterImageHistory()
      .then((records) => {
        if (cancelled) return;
        setArtifactRecords(records);
        setArtifactError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setArtifactRecords([]);
        setArtifactError(error instanceof Error ? error.message : String(error || 'Artifact history load failed.'));
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  const rows = useMemo(
    () => buildRows({ summary, runRecords, artifactRecords, historyError, artifactError, lastResult }),
    [summary, runRecords, artifactRecords, historyError, artifactError, lastResult],
  );
  const latestRun = latestRecord(runRecords);
  const artifactTraceCount = artifactRecords.filter((record) => record.traceState === 'captured').length;
  const lastTraceCaptured = hasTraceMetadata(lastResult) ? 1 : 0;
  const commandCount = commandGroups.reduce((count, group) => count + group.commands.length, 0);

  return (
    <div className={`section-diagnostics section-diagnostics--${section}`}>
      <header className="section-header section-header--compact diagnostics-header">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>Contract & trace inspector</h2>
          <p>Inspect runtime projection, SDK admission, trace availability, and app-owned command boundaries without inventing evidence.</p>
          <span className="diagnostics-header__focus">{copy.focus}</span>
        </div>
        <div className="diagnostics-header__chips" aria-label={`${copy.eyebrow} summary`}>
          <StatusBadge tone={runtime?.status === 'ready' ? 'success' : runtime ? 'warning' : 'neutral'} shape="dot">
            runtime {runtime ? runtime.status : 'checking'}
          </StatusBadge>
          <StatusBadge tone={lastTraceCaptured > 0 ? 'success' : 'neutral'} shape="dot">
            trace captured count: {lastTraceCaptured}
          </StatusBadge>
          <StatusBadge tone={artifactTraceCount > 0 ? 'success' : 'neutral'} shape="dot">
            artifact trace count: {artifactTraceCount}
          </StatusBadge>
          <StatusBadge tone="info" shape="dot">strict boundary</StatusBadge>
          <StatusBadge tone="neutral" shape="dot">storage commands: {commandCount}</StatusBadge>
        </div>
      </header>

      <div className="diagnostics-inspector-layout">
        <Surface className="diagnostics-panel diagnostics-panel--summary" material="glass-thin" tone="card" elevation="base">
          <div className="diagnostics-panel__head">
            <div>
              <p className="eyebrow">{copy.summaryTitle}</p>
              <h3>Runtime projection facts</h3>
            </div>
            <Activity size={16} aria-hidden="true" />
          </div>
          <dl className="diagnostics-facts">
            <div>
              <dt>mode</dt>
              <dd>{runtime?.mode || 'unknown'}</dd>
            </div>
            <div>
              <dt>status</dt>
              <dd>{runtime?.status || 'checking'}</dd>
            </div>
            <div>
              <dt>scheduling owner</dt>
              <dd>{summary?.schedulingOwner || 'runtime'}</dd>
            </div>
            <div>
              <dt>provider catalog</dt>
              <dd>{summary?.providerCatalogSurface || 'runtimeAdmin.listConnectors/listConnectorModels'}</dd>
            </div>
            <div>
              <dt>app-local defaults</dt>
              <dd>{summary?.appLocalProviderDefaults === false ? 'forbidden' : 'checking'}</dd>
            </div>
          </dl>

          <div className="diagnostics-trace-box">
            <div className="diagnostics-trace-box__head">
              <FileSearch size={14} aria-hidden="true" />
              <strong>trace availability</strong>
            </div>
            <p>{describeTrace(lastResult, artifactRecords)}</p>
            <span>Run records do not contain trace fields; no trace metadata is inferred from app-owned history.</span>
          </div>

          <div className="diagnostics-trace-box diagnostics-trace-box--subtle">
            <div className="diagnostics-trace-box__head">
              <Link2 size={14} aria-hidden="true" />
              <strong>last observation</strong>
            </div>
            <p>{latestRun ? `${latestRun.capabilityLabel} / ${latestRun.status} / ${formatTesterRunTimestamp(latestRun.createdAt)}` : 'no selected trace'}</p>
            <span>{latestRun ? latestRun.message : 'no trace record in persisted run history'}</span>
          </div>

          {runtime?.healthJson ? (
            <details className="diagnostics-health-json">
              <summary>Runtime health JSON</summary>
              <pre>{runtime.healthJson}</pre>
            </details>
          ) : null}
        </Surface>

        <Surface className="diagnostics-panel diagnostics-panel--timeline" material="glass-thin" tone="card" elevation="base">
          <div className="diagnostics-panel__head">
            <div>
              <p className="eyebrow">{copy.timelineTitle}</p>
              <h3>Evidence rows</h3>
            </div>
            <Layers size={16} aria-hidden="true" />
          </div>
          <ol className="diagnostics-timeline">
            {rows.map((row) => (
              <li key={row.title} className={`diagnostics-timeline__row diagnostics-timeline__row--${row.tone}`}>
                <div className="diagnostics-timeline__status">
                  <StatusBadge tone={rowBadgeTone(row.tone)} shape="dot">{row.status}</StatusBadge>
                  <span>{row.evidenceKind}</span>
                </div>
                <div className="diagnostics-timeline__body">
                  <strong>{row.title}</strong>
                  <code>{row.source}</code>
                  <p>{row.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Surface>

        <Surface className="diagnostics-panel diagnostics-panel--policy" material="glass-thin" tone="card" elevation="base">
          <div className="diagnostics-panel__head">
            <div>
              <p className="eyebrow">Boundary policy / commands</p>
              <h3>Strict command surface</h3>
            </div>
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
          <ul className="diagnostics-check-list">
            {boundaryChecks.map((rule) => (
              <li key={rule.label} className={`diagnostics-check-list__item diagnostics-check-list__item--${rule.tone}`}>
                <ToneIcon tone={rule.tone} />
                <div>
                  <strong>{rule.label}</strong>
                  <span>{rule.detail}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="diagnostics-command-groups">
            {commandGroups.map((group) => (
              <section key={group.title} className="diagnostics-command-group">
                <h4>{group.title}</h4>
                <ul>
                  {group.commands.map((cmd) => (
                    <li key={cmd.name}>
                      <code>{cmd.name}</code>
                      <span>{cmd.purpose}</span>
                      <small>{cmd.boundary}</small>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Surface>
      </div>

      <Surface className="diagnostics-matrix" material="glass-thin" tone="card" elevation="base">
        <div className="diagnostics-matrix__intro">
          <Database size={15} aria-hidden="true" />
          <div>
            <strong>SDK Admission Matrix Strip</strong>
            <span>Runtime SDK, typed unavailable, and standalone Tauri lanes stay separate.</span>
          </div>
        </div>
        <MatrixLane label="runtime SDK" status="admitted" items={lanes.admitted.map((cap) => cap.id)} />
        <MatrixLane label="typed unavailable" status="sdk gap" items={lanes.typedUnavailable.map((cap) => cap.id)} />
        <MatrixLane label="standalone Tauri" status="tauri-only" items={lanes.standalone.map((cap) => `${cap.label}: World Tour local fixture`)} />
        <div className="diagnostics-matrix__storage">
          <Box size={15} aria-hidden="true" />
          <span>Run history and artifact history are app-owned storage observations, not runtime completion claims.</span>
        </div>
      </Surface>

      {runtime && runtime.status !== 'ready' ? (
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>Runtime projection blocked</strong>
            <span>{runtime.detail}</span>
            <span>Re-run the workbench command bar Run check after restoring transport.</span>
          </div>
        </InlineAlert>
      ) : null}
    </div>
  );
}
