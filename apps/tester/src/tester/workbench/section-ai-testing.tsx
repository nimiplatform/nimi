import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  SegmentedControl,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  AlertTriangle,
  AudioLines,
  Boxes,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Compass,
  Database,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  TextCursorInput,
  Video,
  type LucideIcon,
} from 'lucide-react';
import {
  testerCapabilities,
  type TesterCapability,
  type TesterCapabilityId,
} from '../tester-capabilities.js';
import type { TesterAIConfigSummary } from '../tester-ai-config.js';
import type { TesterRunHistory, TesterRunHistoryRecord } from '../tester-history.js';
import {
  runTesterCapability,
  type TesterCapabilityRunResult,
  type TesterRuntimeInspection,
} from '../tester-runtime.js';
import {
  openWorldTourWindow,
  resolveWorldTourFixture,
} from '../world-tour/world-tour-shared.js';
import {
  loadTesterPromptDraft,
  saveTesterPromptDraft,
  type TesterPromptDraftStoreStatus,
} from '../tester-preferences.js';

type SectionAITestingProps = {
  activeId: TesterCapabilityId;
  onSelect: (id: TesterCapabilityId) => void;
  capability: TesterCapability;
  onResult: (result: TesterCapabilityRunResult, prompt: string) => void | Promise<void>;
  summary: TesterAIConfigSummary | null;
  history: TesterRunHistory | null;
  lastResult: TesterCapabilityRunResult | null;
  historyError: string | null;
  onOpenKitComponents: () => void;
  verboseConsole: boolean;
  draftPersistence: boolean;
};

type ScenarioPreset = {
  id: string;
  label: string;
  prompt: string;
};

type CapabilityStatus = {
  label: 'ready' | 'blocked' | 'SDK gap' | 'tauri-only' | 'checking';
  tone: 'success' | 'warning' | 'info' | 'neutral';
  detail: string;
};

const capabilityIcons: Record<TesterCapabilityId, LucideIcon> = {
  'text.generate': Sparkles,
  'chat.stream': MessageSquareText,
  'text.embed': TextCursorInput,
  'image.generate': ImageIcon,
  'video.generate': Video,
  'audio.synthesize': AudioLines,
  'audio.transcribe': AudioLines,
  'speech.bundle': AudioLines,
  'world.generate': Compass,
};

const groupOrder: Array<TesterCapability['group']> = ['text', 'media', 'audio', 'world'];
const groupLabels: Record<TesterCapability['group'], string> = {
  text: 'Text & Chat',
  media: 'Media',
  audio: 'Audio',
  world: 'World',
};

const scenarioPresets: Partial<Record<TesterCapabilityId, ScenarioPreset[]>> = {
  'text.generate': [
    {
      id: 'acceptance-note',
      label: 'Acceptance note',
      prompt: 'Write a concise acceptance note for a Runtime-backed Nimi App that uses runtime.ai.text.generate to produce content.',
    },
    {
      id: 'admission-summary',
      label: 'Admission summary',
      prompt: 'Explain what a third-party Nimi App should show when a Runtime SDK method is unavailable.',
    },
  ],
  'chat.stream': [
    {
      id: 'stream-probe',
      label: 'Stream probe',
      prompt: 'Continue this conversation as a Runtime app stream readiness check.',
    },
  ],
  'text.embed': [
    {
      id: 'embedding-sample',
      label: 'Embedding sample',
      prompt: 'Nimi App tester embedding readiness sample.',
    },
  ],
  'image.generate': [
    {
      id: 'ui-preview',
      label: 'UI preview',
      prompt: 'Generate a product-grade UI inspection image for a Nimi App workbench.',
    },
  ],
  'video.generate': [
    {
      id: 'clip-probe',
      label: 'Clip probe',
      prompt: 'Create a short inspection clip for a Nimi App glass UI workflow.',
    },
  ],
  'audio.synthesize': [
    {
      id: 'speech-line',
      label: 'Speech line',
      prompt: 'Synthesize a short Runtime acceptance sentence.',
    },
  ],
  'audio.transcribe': [
    {
      id: 'audio-url',
      label: 'Audio URL',
      prompt: 'https://example.test/sample.wav',
    },
  ],
  'speech.bundle': [
    {
      id: 'voice-catalog',
      label: 'Voice catalog',
      prompt: 'List voices through runtime.media.tts.listVoices.',
    },
  ],
  'world.generate': [
    {
      id: 'fixture-viewer',
      label: 'Viewer fixture',
      prompt: 'Resolve the world-tour fixture and open the standalone viewer.',
    },
  ],
};

function presetsFor(capability: TesterCapability): ScenarioPreset[] {
  return scenarioPresets[capability.id] || [
    {
      id: 'default',
      label: 'Default',
      prompt: capability.summary,
    },
  ];
}

function runtimeMethod(capability: TesterCapability): string {
  const methods: Record<TesterCapabilityId, string> = {
    'text.generate': 'runtime.ai.text.generate',
    'chat.stream': 'runtime.ai.text.stream',
    'text.embed': 'runtime.ai.embedding.generate',
    'image.generate': 'runtime.media.image.generate',
    'video.generate': 'runtime.media.video.generate',
    'audio.synthesize': 'runtime.media.tts.synthesize',
    'audio.transcribe': 'runtime.media.stt.transcribe',
    'speech.bundle': 'runtime.media.tts.listVoices',
    'world.generate': 'tauri.open_world_tour_window',
  };
  return methods[capability.id];
}

function latestRunRecord(history: TesterRunHistory | null): TesterRunHistoryRecord | null {
  if (!history) return null;
  return Object.values(history)
    .flat()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function runRecordFor(history: TesterRunHistory | null, capabilityId: TesterCapabilityId): TesterRunHistoryRecord | null {
  return history?.[capabilityId]?.[0] ?? null;
}

function statusForCapability(
  capability: TesterCapability,
  runtime: TesterRuntimeInspection | null,
  lastResult: TesterCapabilityRunResult | null,
): CapabilityStatus {
  if (capability.execution === 'standalone-tauri') {
    return {
      label: 'tauri-only',
      tone: 'info',
      detail: 'Standalone viewer fixture. It can write a local run record, but it is not a runtime artifact.',
    };
  }
  if (capability.execution === 'typed-unavailable') {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: capability.missingSurface || 'No admitted typed SDK method is available for this capability.',
    };
  }
  if (lastResult?.capabilityId === capability.id && !lastResult.ok && lastResult.reason === 'sdk-surface-missing') {
    return {
      label: 'SDK gap',
      tone: 'warning',
      detail: lastResult.message,
    };
  }
  if (!runtime) {
    return {
      label: 'checking',
      tone: 'neutral',
      detail: 'Runtime inspection has not completed yet.',
    };
  }
  if (runtime.status !== 'ready') {
    return {
      label: 'blocked',
      tone: 'warning',
      detail: runtime.detail,
    };
  }
  return {
    label: 'ready',
    tone: 'success',
    detail: 'Runtime session active and SDK admission surface is available.',
  };
}

function formatTypedOutput(result: TesterCapabilityRunResult & { ok: true }): string {
  const output = result.output;
  if (result.capabilityId === 'world.generate') {
    return JSON.stringify({
      viewerStatus: 'viewer opened',
      fixture: 'tauri-only viewer fixture',
      runtimeResult: false,
      runtimeArtifact: false,
      windowLabel: output.kind === 'artifacts' ? output.jobId : undefined,
    }, null, 2);
  }
  if (output.kind === 'text') {
    return output.text || '(empty body)';
  }
  if (output.kind === 'embedding') {
    return JSON.stringify({
      vectors: output.vectorCount,
      dimensions: output.dimensions,
      sample: output.sample,
      totalTokens: output.totalTokens,
    }, null, 2);
  }
  if (output.kind === 'artifacts') {
    return JSON.stringify({
      jobId: output.jobId,
      jobState: output.jobState,
      artifactCount: output.artifactCount,
      firstArtifact: output.firstArtifact,
    }, null, 2);
  }
  if (output.kind === 'transcript') {
    return output.text || '(empty transcript)';
  }
  return JSON.stringify({
    modelResolved: output.modelResolved,
    voiceCount: output.voiceCount,
    sample: output.sample,
  }, null, 2);
}

function resultKind(result: TesterCapabilityRunResult | null, capability: TesterCapability): string {
  if (!result) return capability.execution === 'standalone-tauri' ? 'viewer idle' : 'no typed result';
  if (!result.ok) {
    if (result.reason === 'runtime-not-ready') return 'Runtime unavailable';
    if (result.reason === 'sdk-surface-missing') return 'SDK method unavailable';
    return result.reason;
  }
  if (capability.id === 'world.generate') return 'Tauri viewer opened';
  return `${result.output.kind} result`;
}

function HeaderSummary({
  runtime,
  history,
  lastResult,
}: {
  runtime: TesterRuntimeInspection | null;
  history: TesterRunHistory | null;
  lastResult: TesterCapabilityRunResult | null;
}) {
  const statuses = testerCapabilities.map((capability) => statusForCapability(capability, runtime, lastResult));
  const ready = statuses.filter((status) => status.label === 'ready').length;
  const blocked = statuses.filter((status) => status.label === 'blocked' || status.label === 'SDK gap').length;
  const lastRun = latestRunRecord(history);

  return (
    <div className="ai-capabilities-header__chips" aria-label="Capability summary">
      <span>total lanes: {testerCapabilities.length}</span>
      <span>ready: {ready}</span>
      <span>blocked: {blocked}</span>
      <span>runtime: {runtime?.mode || 'checking'}</span>
      <span>last run: {lastRun ? lastRun.capabilityId : 'no record'}</span>
    </div>
  );
}

function CapabilityRegistry({
  activeId,
  runtime,
  history,
  lastResult,
  onSelect,
}: {
  activeId: TesterCapabilityId;
  runtime: TesterRuntimeInspection | null;
  history: TesterRunHistory | null;
  lastResult: TesterCapabilityRunResult | null;
  onSelect: (id: TesterCapabilityId) => void;
}) {
  return (
    <Surface className="ai-capability-registry" material="glass-thin" tone="panel" elevation="base">
      <header className="ai-panel-head">
        <div>
          <p className="eyebrow">Capability Matrix</p>
          <h3>Runtime and SDK registry</h3>
        </div>
        <StatusBadge tone="neutral" shape="dot">{testerCapabilities.length} lanes</StatusBadge>
      </header>
      <div className="ai-capability-registry__groups" role="list" aria-label="AI capability registry">
        {groupOrder.map((group) => {
          const capabilities = testerCapabilities.filter((item) => item.group === group);
          if (!capabilities.length) return null;
          return (
            <section key={group} className="ai-capability-registry__group" aria-label={groupLabels[group]}>
              <p>{groupLabels[group]}</p>
              <div className="ai-capability-registry__rows">
                {capabilities.map((item) => {
                  const Icon = capabilityIcons[item.id];
                  const active = activeId === item.id;
                  const status = statusForCapability(item, runtime, lastResult);
                  const record = runRecordFor(history, item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={active ? 'ai-capability-row ai-capability-row--active' : 'ai-capability-row'}
                      onClick={() => onSelect(item.id)}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="ai-capability-row__icon" aria-hidden="true">
                        <Icon size={15} />
                      </span>
                      <span className="ai-capability-row__main">
                        <strong>{item.label}</strong>
                        <code>{runtimeMethod(item)}</code>
                      </span>
                      <span className="ai-capability-row__state">
                        <StatusBadge tone={status.tone} shape="dot">{status.label}</StatusBadge>
                        <small>{record ? `${record.status} · ${record.createdAt}` : 'no local record'}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Surface>
  );
}

function ResultPanel({
  result,
  running,
  capability,
  verboseConsole,
}: {
  result: TesterCapabilityRunResult | null;
  running: boolean;
  capability: TesterCapability;
  verboseConsole: boolean;
}) {
  if (running) {
    return (
      <div className="ai-result ai-result--pending">
        <div className="ai-result__line">
          <Loader2 size={14} aria-hidden="true" />
          <span>{capability.execution === 'standalone-tauri' ? 'opening viewer fixture' : 'calling Runtime SDK'}</span>
        </div>
        <p>{capability.execution === 'standalone-tauri' ? 'Waiting for the app-owned Tauri command.' : 'Waiting for the runtime-backed SDK call to return.'}</p>
        {verboseConsole ? <p className="ai-result__diagnostic">Verbose console: {capability.execution === 'standalone-tauri' ? 'local viewer command pending.' : `${runtimeMethod(capability)} pending.`}</p> : null}
      </div>
    );
  }
  if (!result) {
    return (
      <div className="ai-result ai-result--idle">
        <div className="ai-result__line">
          <CircleDot size={14} aria-hidden="true" />
          <span>{capability.execution === 'standalone-tauri' ? 'viewer idle' : 'idle · no typed result yet'}</span>
        </div>
        <p>{capability.execution === 'standalone-tauri' ? 'Open the viewer to create a local run record. No runtime artifact is implied.' : 'Run with Runtime to collect a typed result or a fail-closed blocker.'}</p>
        {verboseConsole ? <p className="ai-result__diagnostic">Verbose console: no current-session result for {capability.id}.</p> : null}
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="ai-result ai-result--blocked">
        <div className="ai-result__line">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{resultKind(result, capability)}</span>
        </div>
        <p>{result.message}</p>
        <p>{result.actionHint}</p>
        {verboseConsole ? <p className="ai-result__diagnostic">Verbose console: fail-closed reason {result.reason}; no runtime/provider setting was changed.</p> : null}
      </div>
    );
  }
  return (
    <div className="ai-result ai-result--ready">
      <div className="ai-result__line">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>{resultKind(result, capability)}</span>
      </div>
      <p>{result.message}</p>
      <pre>{formatTypedOutput(result)}</pre>
      {verboseConsole ? (
        <p className="ai-result__diagnostic">
          Verbose console: capability {result.capabilityId}; trace metadata {result.trace ? 'available' : 'not returned'}.
        </p>
      ) : null}
    </div>
  );
}

function CapabilityDetail({
  capability,
  runtime,
  lastResult,
  onResult,
  verboseConsole,
  draftPersistence,
}: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  lastResult: TesterCapabilityRunResult | null;
  onResult: (result: TesterCapabilityRunResult, prompt: string) => void | Promise<void>;
  verboseConsole: boolean;
  draftPersistence: boolean;
}) {
  const presets = useMemo(() => presetsFor(capability), [capability]);
  const [scenarioId, setScenarioId] = useState(presets[0].id);
  const [prompt, setPrompt] = useState(presets[0].prompt);
  const [draftStatus, setDraftStatus] = useState<TesterPromptDraftStoreStatus>(() => (
    loadTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: presets[0].id,
    }, draftPersistence).status
  ));
  const [running, setRunning] = useState(false);
  const currentResult = lastResult?.capabilityId === capability.id ? lastResult : null;
  const admission = statusForCapability(capability, runtime, currentResult);
  const isWorldTour = capability.execution === 'standalone-tauri';

  function loadPromptFor(nextScenarioId: string, presetPrompt: string) {
    const draft = loadTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: nextScenarioId,
    }, draftPersistence);
    setDraftStatus(draft.status);
    setPrompt(draft.prompt ?? presetPrompt);
  }

  function updatePrompt(nextPrompt: string, nextScenarioId = scenarioId) {
    setPrompt(nextPrompt);
    const saved = saveTesterPromptDraft({
      surfaceId: 'ai-capabilities',
      capabilityId: capability.id,
      scenarioId: nextScenarioId,
    }, nextPrompt, draftPersistence);
    setDraftStatus(saved.status);
  }

  useEffect(() => {
    setScenarioId(presets[0].id);
    loadPromptFor(presets[0].id, presets[0].prompt);
  }, [capability.id, draftPersistence, presets]);

  function selectScenario(nextId: string) {
    const preset = presets.find((item) => item.id === nextId);
    if (!preset) return;
    setScenarioId(nextId);
    loadPromptFor(nextId, preset.prompt);
  }

  async function run() {
    setRunning(true);
    try {
      if (isWorldTour) {
        const fixture = await resolveWorldTourFixture({});
        const opened = await openWorldTourWindow({ manifestPath: fixture.manifestPath });
        await onResult({
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: `Viewer opened for a Tauri-only local fixture (${fixture.manifestPath}); local fixture record only, with no runtime generation or runtime artifact.`,
          output: {
            kind: 'text',
            text: `Local fixture viewer opened (${opened.windowLabel}). This is not a runtime result or runtime artifact.`,
            finishReason: 'viewer-opened',
            streamed: false,
          },
        }, prompt);
      } else {
        const result = await runTesterCapability({ capabilityId: capability.id, prompt, scenarioId });
        await onResult(result, prompt);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <Surface className="ai-capability-detail" material="glass-thin" tone="panel" elevation="base">
      <header className="ai-capability-detail__head">
        <div>
          <p className="eyebrow">Selected capability</p>
          <h2>{capability.label}</h2>
          <code>{runtimeMethod(capability)}</code>
        </div>
        <StatusBadge tone={admission.tone} shape="dot">{admission.label}</StatusBadge>
      </header>

      <div className="ai-capability-detail__panels">
        <section className="ai-detail-panel ai-detail-panel--admission" aria-label="Admission">
          <div className="ai-detail-panel__title">
            <ShieldCheck size={15} aria-hidden="true" />
            <strong>Admission</strong>
          </div>
          <StatusBadge tone={admission.tone} shape="dot">{admission.label}</StatusBadge>
          <p>{admission.detail}</p>
          <small>{isWorldTour ? 'Viewer fixture only; runtime artifact proof is not claimed.' : 'Third-party app path must use the admitted SDK surface.'}</small>
        </section>

        <section className="ai-detail-panel ai-detail-panel--request" aria-label="Request">
          <div className="ai-detail-panel__title">
            <FileText size={15} aria-hidden="true" />
            <strong>Request</strong>
          </div>
          <SegmentedControl
            items={presets.map((preset) => ({ value: preset.id, label: preset.label }))}
            value={scenarioId}
            onValueChange={selectScenario}
            ariaLabel="Scenario"
            size="sm"
          />
          <TextareaField
            rows={5}
            wrap="soft"
            aria-label={`${capability.label} request`}
            value={prompt}
            onChange={(event) => updatePrompt(event.currentTarget.value)}
          />
          <small>drafts: {draftPersistence ? draftStatus.state : 'off'}</small>
        </section>

        <section className="ai-detail-panel ai-detail-panel--run" aria-label="Run">
          <div className="ai-detail-panel__title">
            <Route size={15} aria-hidden="true" />
            <strong>Run</strong>
          </div>
          <p>{isWorldTour ? 'Open the Tauri fixture viewer and record only the local app-owned run.' : 'Invoke the runtime-backed SDK method. Blockers are returned as typed unavailable results.'}</p>
          <div className="ai-detail-panel__actions">
            <Button
              type="button"
              tone="primary"
              leadingIcon={<Play size={14} />}
              loading={running}
              disabled={running || (!prompt.trim() && !isWorldTour)}
              onClick={run}
            >
              {isWorldTour ? 'Open Viewer' : 'Run with Runtime'}
            </Button>
            <Button
              type="button"
              tone="secondary"
              leadingIcon={<RefreshCw size={14} />}
              onClick={() => {
                setScenarioId(presets[0].id);
                updatePrompt(presets[0].prompt, presets[0].id);
              }}
            >
              Reset request
            </Button>
          </div>
          <small>{admission.label === 'blocked' || admission.label === 'SDK gap' ? 'Fail-closed if invoked; no fabricated success is generated.' : 'Result is persisted through the local run history callback.'}</small>
        </section>

        <section className="ai-detail-panel ai-detail-panel--result" aria-label="Result">
          <div className="ai-detail-panel__title">
            <Database size={15} aria-hidden="true" />
            <strong>Result</strong>
          </div>
          <ResultPanel result={currentResult} running={running} capability={capability} verboseConsole={verboseConsole} />
        </section>
      </div>
    </Surface>
  );
}

function BoundaryEvidencePanel({
  capability,
  runtime,
  summary,
  history,
  result,
  historyError,
}: {
  capability: TesterCapability;
  runtime: TesterRuntimeInspection | null;
  summary: TesterAIConfigSummary | null;
  history: TesterRunHistory | null;
  result: TesterCapabilityRunResult | null;
  historyError: string | null;
}) {
  const record = runRecordFor(history, capability.id);
  const isWorldTour = capability.execution === 'standalone-tauri';
  const artifactCount = result?.ok && result.output.kind === 'artifacts' && !isWorldTour ? result.output.artifactCount : 0;
  const hasTrace = Boolean(result?.ok && result.trace);
  const rows = [
    {
      label: 'SDK surface',
      value: isWorldTour ? 'app-owned Tauri command' : runtimeMethod(capability),
      detail: capability.surface,
      tone: isWorldTour ? 'info' : 'success',
      icon: Boxes,
    },
    {
      label: 'Scheduling owner',
      value: summary?.schedulingOwner || 'runtime',
      detail: isWorldTour ? 'Viewer launch is app-owned; provider scheduling is not involved.' : 'Provider selection stays in Runtime.',
      tone: 'success',
      icon: Route,
    },
    {
      label: 'App-local defaults',
      value: summary?.appLocalProviderDefaults === false ? 'forbidden' : 'unknown',
      detail: 'No app-local provider defaults or direct REST bypass.',
      tone: summary?.appLocalProviderDefaults === false ? 'success' : 'neutral',
      icon: ShieldCheck,
    },
    {
      label: 'Local run record',
      value: record ? record.status : 'no record',
      detail: record ? `${record.capabilityId} · ${record.createdAt}` : historyError || 'Run this capability first.',
      tone: record ? 'info' : 'neutral',
      icon: ClipboardList,
    },
    {
      label: 'Runtime result',
      value: result ? (result.ok ? (isWorldTour ? 'not invoked' : 'returned') : 'blocked') : 'idle',
      detail: result ? (isWorldTour ? 'Viewer fixture result only.' : result.message) : 'No result for the active capability.',
      tone: result ? (result.ok && !isWorldTour ? 'success' : 'warning') : 'neutral',
      icon: CircleDot,
    },
    {
      label: 'Artifact / trace',
      value: artifactCount > 0 || hasTrace ? 'partial evidence' : 'not available',
      detail: artifactCount > 0 ? `${artifactCount} real artifact(s). Trace: ${hasTrace ? 'available' : 'not captured'}` : `Trace: ${hasTrace ? 'available' : 'not captured'}; no real runtime artifact claimed.`,
      tone: artifactCount > 0 || hasTrace ? 'success' : 'neutral',
      icon: Database,
    },
  ] as const;

  return (
    <Surface className="ai-boundary-panel" material="glass-thin" tone="panel" elevation="base">
      <header className="ai-panel-head">
        <div>
          <p className="eyebrow">Boundary & Evidence</p>
          <h3>Capability contract</h3>
        </div>
        <StatusBadge tone={runtime?.status === 'ready' ? 'success' : runtime ? 'warning' : 'neutral'} shape="dot">
          {runtime?.status === 'ready' ? 'runtime active' : runtime ? 'runtime unavailable' : 'checking'}
        </StatusBadge>
      </header>
      <div className="ai-boundary-panel__rows">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <article className="ai-boundary-row" key={row.label}>
              <span className={`ai-boundary-row__icon ai-boundary-row__icon--${row.tone}`} aria-hidden="true">
                <Icon size={14} />
              </span>
              <div>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <p>{row.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </Surface>
  );
}

function DiagnosticsStrip({
  summary,
  runtime,
  historyError,
  lastResult,
}: {
  summary: TesterAIConfigSummary | null;
  runtime: TesterRuntimeInspection | null;
  historyError: string | null;
  lastResult: TesterCapabilityRunResult | null;
}) {
  const sdkGaps = testerCapabilities.filter((capability) => capability.execution === 'typed-unavailable').length
    + (lastResult && !lastResult.ok && lastResult.reason === 'sdk-surface-missing' ? 1 : 0);
  const rows = [
    {
      label: 'Provider catalog',
      value: summary ? 'loaded' : 'checking',
      detail: summary?.providerCatalogSurface || 'runtimeAdmin.listConnectors/listConnectorModels',
      tone: summary ? 'success' : 'neutral',
    },
    {
      label: 'SDK gaps',
      value: sdkGaps > 0 ? `${sdkGaps} observed` : 'none observed',
      detail: 'Typed gaps remain fail-closed.',
      tone: sdkGaps > 0 ? 'warning' : 'success',
    },
    {
      label: 'History persistence',
      value: historyError ? 'unavailable' : 'available',
      detail: historyError || 'tester_run_history_save / load',
      tone: historyError ? 'warning' : 'success',
    },
    {
      label: 'Strict boundary',
      value: 'active',
      detail: runtime?.status === 'ready' ? 'Runtime SDK only; REST bypass: no.' : 'Runtime unavailable; app remains fail-closed.',
      tone: 'success',
    },
  ] as const;

  return (
    <div className="ai-diagnostics-strip" aria-label="Capability diagnostics">
      {rows.map((row) => (
        <Surface className="ai-diagnostic-chip" material="glass-thin" tone="card" elevation="base" key={row.label}>
          <StatusBadge tone={row.tone} shape="dot">{row.value}</StatusBadge>
          <strong>{row.label}</strong>
          <span>{row.detail}</span>
        </Surface>
      ))}
    </div>
  );
}

export function SectionAITesting({
  activeId,
  onSelect,
  capability,
  onResult,
  summary,
  history,
  lastResult,
  historyError,
  verboseConsole,
  draftPersistence,
}: SectionAITestingProps) {
  const runtime = summary?.runtime ?? null;
  const currentResult = lastResult?.capabilityId === capability.id ? lastResult : null;

  return (
    <div className="section-ai-testing" data-testid="nimi-tester-section-ai-testing">
      <header className="ai-capabilities-header">
        <div>
          <p className="eyebrow">AI Capabilities</p>
          <h1>Runtime-backed capability inspector</h1>
          <p>Inspect SDK admission, run one lane, and keep fail-closed evidence visible.</p>
        </div>
        <HeaderSummary runtime={runtime} history={history} lastResult={lastResult} />
      </header>

      <div className="ai-capabilities-layout">
        <div className="ai-capabilities-layout__main">
          <CapabilityRegistry
            activeId={activeId}
            runtime={runtime}
            history={history}
            lastResult={lastResult}
            onSelect={onSelect}
          />
          <CapabilityDetail
            capability={capability}
            runtime={runtime}
            lastResult={lastResult}
            onResult={onResult}
            verboseConsole={verboseConsole}
            draftPersistence={draftPersistence}
          />
        </div>
        <BoundaryEvidencePanel
          capability={capability}
          runtime={runtime}
          summary={summary}
          history={history}
          result={currentResult}
          historyError={historyError}
        />
      </div>

      <DiagnosticsStrip
        summary={summary}
        runtime={runtime}
        historyError={historyError}
        lastResult={lastResult}
      />
    </div>
  );
}
