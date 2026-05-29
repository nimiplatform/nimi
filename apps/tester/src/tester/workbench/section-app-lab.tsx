import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  IconButton,
  SegmentedControl,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/kit/ui';
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronsLeftRight,
  CircleDot,
  Clipboard,
  Compass,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Mic,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
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
import type { TesterRunHistory } from '../tester-history.js';
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
import { AppLabAIConfigPanel } from './app-lab-ai-config-panel.js';

type SectionAppLabProps = {
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

type RecipeCard = {
  title: string;
  detail: string;
  primitives: string[];
  icon: LucideIcon;
};

const capabilityIcons: Record<TesterCapabilityId, LucideIcon> = {
  'text.generate': Sparkles,
  'chat.stream': MessageSquareText,
  'text.embed': TextCursorInput,
  'image.generate': ImageIcon,
  'video.generate': Video,
  'audio.synthesize': AudioLines,
  'audio.transcribe': Mic,
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
      id: 'spec-summary',
      label: 'Spec summary',
      prompt: 'Summarise the fail-closed contract for a third-party Nimi App when a Runtime SDK method is unavailable.',
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
      prompt: 'List voices via runtime.media.tts.listVoices.',
    },
  ],
  'world.generate': [
    {
      id: 'fixture-probe',
      label: 'Fixture probe',
      prompt: 'Resolve the world-tour fixture and open the standalone viewer.',
    },
  ],
};

const recipeCards: RecipeCard[] = [
  {
    title: 'Prompt input',
    detail: 'Multiline prompt editor with label and helper.',
    primitives: ['TextareaField', 'HelperText', 'FieldShell'],
    icon: FileText,
  },
  {
    title: 'Result surface',
    detail: 'Render text output with copy and formatting.',
    primitives: ['Surface', 'Markdown', 'CopyButton'],
    icon: Copy,
  },
  {
    title: 'Loading state',
    detail: 'Show progress while runtime generates.',
    primitives: ['StatusBadge', 'Spinner', 'Surface'],
    icon: Loader2,
  },
  {
    title: 'SDK method unavailable',
    detail: 'Explain blocker and suggest next steps.',
    primitives: ['Alert', 'Link', 'StatusBadge'],
    icon: AlertTriangle,
  },
  {
    title: 'Evidence action',
    detail: 'Capture available request, result, and trace.',
    primitives: ['ActionMenu', 'Button', 'EvidenceBadge'],
    icon: Clipboard,
  },
];

const appLabCapabilities = testerCapabilities.filter((capability) => capability.id !== 'speech.bundle');

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

function statusForCapability(
  capability: TesterCapability,
  runtime: TesterRuntimeInspection | null,
  lastResult: TesterCapabilityRunResult | null,
): { tone: 'success' | 'warning' | 'info' | 'neutral'; label: string } {
  if (capability.execution === 'standalone-tauri') return { tone: 'info', label: 'tauri only' };
  if (capability.execution === 'typed-unavailable') return { tone: 'warning', label: 'SDK gap' };
  if (lastResult?.capabilityId === capability.id && !lastResult.ok && lastResult.reason === 'sdk-surface-missing') {
    return { tone: 'warning', label: 'SDK gap' };
  }
  if (!runtime) return { tone: 'neutral', label: 'checking' };
  if (runtime.status !== 'ready') return { tone: 'warning', label: 'blocked' };
  return { tone: 'success', label: 'ready' };
}

function admissionFor(
  capability: TesterCapability,
  runtime: TesterRuntimeInspection | null,
  currentResult: TesterCapabilityRunResult | null,
) {
  const status = statusForCapability(capability, runtime, currentResult);
  if (status.label === 'ready') {
    return { ...status, detail: 'Runtime session active · SDK admission passed · No blockers' };
  }
  if (status.label === 'SDK gap') {
    return { ...status, detail: currentResult && !currentResult.ok ? currentResult.message : capability.missingSurface || 'SDK method unavailable for this lane.' };
  }
  if (status.label === 'tauri only') {
    return { ...status, detail: 'Tauri-only fixture: opens viewer, does not produce a runtime result or artifact.' };
  }
  return { ...status, detail: runtime?.detail || 'Waiting for Runtime readiness inspection.' };
}

function formatTypedOutput(result: TesterCapabilityRunResult & { ok: true }): string {
  const output = result.output;
  if (result.capabilityId === 'world.generate') {
    return JSON.stringify({
      viewerStatus: 'viewer opened',
      fixture: 'tauri-only fixture',
      runtimeResult: false,
      runtimeArtifact: false,
      windowLabel: output.kind === 'artifacts' ? output.jobId : undefined,
    }, null, 2);
  }
  if (output.kind === 'text') return output.text || '(empty body)';
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
  if (output.kind === 'transcript') return output.text || '(empty transcript)';
  return JSON.stringify({
    modelResolved: output.modelResolved,
    voiceCount: output.voiceCount,
    sample: output.sample,
  }, null, 2);
}

function CapabilityRail({
  activeId,
  runtime,
  lastResult,
  onSelect,
}: {
  activeId: TesterCapabilityId;
  runtime: TesterRuntimeInspection | null;
  lastResult: TesterCapabilityRunResult | null;
  onSelect: (id: TesterCapabilityId) => void;
}) {
  const grouped = groupOrder
    .map((group) => ({
      group,
      capabilities: appLabCapabilities.filter((item) => item.group === group),
    }))
    .filter((bucket) => bucket.capabilities.length > 0);

  return (
    <Surface className="app-lab-rail" material="glass-thin" tone="panel" elevation="base">
      <div className="app-lab-panel-head app-lab-panel-head--rail">
        <span className="app-lab-step">1</span>
        <div>
          <p className="eyebrow">Capability Rail</p>
        </div>
      </div>
      <nav className="app-lab-rail__groups" aria-label="App Lab capabilities">
        {grouped.map((bucket) => (
          <div key={bucket.group} className="app-lab-rail__group">
            <p className="app-lab-rail__group-title">{groupLabels[bucket.group]}</p>
            <ul>
              {bucket.capabilities.map((capability) => {
                const Icon = capabilityIcons[capability.id];
                const active = activeId === capability.id;
                const status = statusForCapability(capability, runtime, lastResult);
                return (
                  <li key={capability.id}>
                    <button
                      type="button"
                      className={active ? 'app-lab-rail__item app-lab-rail__item--active' : 'app-lab-rail__item'}
                      onClick={() => onSelect(capability.id)}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="app-lab-rail__icon" aria-hidden="true">
                        <Icon size={14} />
                      </span>
                      <span className="app-lab-rail__label">{capability.label}</span>
                      <span className="app-lab-rail__status">
                        <StatusBadge tone={status.tone} shape="dot">{status.label}</StatusBadge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
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
  const isWorldTour = capability.id === 'world.generate';
  if (running) {
    return (
      <div className="app-lab-result app-lab-result--pending">
        <div className="app-lab-result__line">
          <Loader2 size={14} aria-hidden="true" />
          <span>{isWorldTour ? 'opening tauri-only viewer...' : 'running against Runtime...'}</span>
        </div>
        <p>{isWorldTour ? 'Waiting for the app-owned Tauri command to return.' : 'Waiting for the Runtime SDK call to return.'}</p>
        {verboseConsole ? <p className="app-lab-result__diagnostic">Verbose console: {isWorldTour ? 'Tauri fixture launch pending.' : `${runtimeMethod(capability)} invocation pending.`}</p> : null}
      </div>
    );
  }
  if (!result) {
    return (
      <div className="app-lab-result app-lab-result--idle">
        <div className="app-lab-result__line">
          <CircleDot size={14} aria-hidden="true" />
          <span>{isWorldTour ? 'idle - waiting for viewer open.' : 'idle - waiting for your first runtime run.'}</span>
        </div>
        <p>{isWorldTour ? 'Open the fixture viewer to record a local run; this is not runtime artifact proof.' : 'Run a capability to see result, console output, and evidence.'}</p>
        {verboseConsole ? <p className="app-lab-result__diagnostic">Verbose console: no local result has been recorded for {capability.id} in this session.</p> : null}
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="app-lab-result app-lab-result--blocked">
        <div className="app-lab-result__line">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{result.reason}</span>
        </div>
        <p>{result.message}</p>
        <p>{result.actionHint}</p>
        {verboseConsole ? <p className="app-lab-result__diagnostic">Verbose console: fail-closed reason {result.reason}; no success payload was fabricated.</p> : null}
      </div>
    );
  }
  return (
    <div className="app-lab-result app-lab-result--ready">
      <div className="app-lab-result__line">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>{result.message}</span>
      </div>
      <pre>{formatTypedOutput(result)}</pre>
      {verboseConsole ? (
        <p className="app-lab-result__diagnostic">
          Verbose console: capability {result.capabilityId}; trace metadata {result.trace ? 'available' : 'not returned'}.
        </p>
      ) : null}
    </div>
  );
}

function CapabilityLab({
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
      surfaceId: 'app-lab',
      capabilityId: capability.id,
      scenarioId: presets[0].id,
    }, draftPersistence).status
  ));
  const [running, setRunning] = useState(false);
  const currentResult = lastResult?.capabilityId === capability.id ? lastResult : null;
  const admission = admissionFor(capability, runtime, currentResult);
  const currentPreset = presets.find((item) => item.id === scenarioId) ?? presets[0];

  function loadPromptFor(nextScenarioId: string, presetPrompt: string) {
    const draft = loadTesterPromptDraft({
      surfaceId: 'app-lab',
      capabilityId: capability.id,
      scenarioId: nextScenarioId,
    }, draftPersistence);
    setDraftStatus(draft.status);
    setPrompt(draft.prompt ?? presetPrompt);
  }

  function updatePrompt(nextPrompt: string, nextScenarioId = scenarioId) {
    setPrompt(nextPrompt);
    const saved = saveTesterPromptDraft({
      surfaceId: 'app-lab',
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
      if (capability.id === 'world.generate') {
        const fixture = await resolveWorldTourFixture({});
        const opened = await openWorldTourWindow({ manifestPath: fixture.manifestPath });
        await onResult({
          ok: true,
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          message: `Viewer opened for a Tauri-only fixture (${fixture.manifestPath}); no runtime generation or artifact was produced.`,
          output: {
            kind: 'artifacts',
            jobId: opened.windowLabel,
            jobState: 'window-opened',
            artifactCount: 0,
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
    <Surface className="app-lab-capability" material="glass-thin" tone="panel" elevation="base" data-testid="nimi-tester-app-lab-capability">
      <header className="app-lab-capability__head">
        <div>
          <div className="app-lab-panel-head">
            <span className="app-lab-step">2</span>
            <p className="eyebrow">AI Capability Lab</p>
          </div>
          <h2>{capability.label}</h2>
          <code className="app-lab-method">{runtimeMethod(capability)}</code>
        </div>
        <StatusBadge tone={admission.tone} shape="dot">{admission.label === 'ready' ? 'Ready to run' : admission.label}</StatusBadge>
      </header>

      <section className="app-lab-capability__scenario" aria-label="Scenario">
        <p className="app-lab-field-label">Scenario</p>
        <SegmentedControl
          items={presets.map((preset) => ({ value: preset.id, label: preset.label }))}
          value={scenarioId}
          onValueChange={selectScenario}
          ariaLabel="Scenario"
          size="sm"
        />
      </section>

      <section className="app-lab-capability__request" aria-label="Request">
        <p className="app-lab-field-label">Request</p>
        <TextareaField
          rows={5}
          wrap="soft"
          aria-label={`${capability.label} request`}
          value={prompt}
          onChange={(event) => updatePrompt(event.currentTarget.value)}
        />
        <div className="app-lab-request-meta" aria-label="Request options">
          <span>single-shot</span>
          <span>max tokens: 1024</span>
          <span>temperature: 0.3</span>
          <span>drafts: {draftPersistence ? draftStatus.state : 'off'}</span>
        </div>
      </section>

      <section className={`app-lab-admission app-lab-admission--${admission.tone}`} aria-label="Admission">
        <div>
          <StatusBadge tone={admission.tone} shape="dot">{admission.label}</StatusBadge>
          <span>{admission.detail}</span>
        </div>
        <ArrowRight size={14} aria-hidden="true" />
      </section>

      <section className="app-lab-action" aria-label="Action">
        <Button
          type="button"
          tone="primary"
          leadingIcon={<Play size={14} />}
          loading={running}
          disabled={running || (!prompt.trim() && capability.id !== 'world.generate')}
          onClick={run}
        >
          {capability.execution === 'standalone-tauri' ? 'Open Viewer' : 'Run with Runtime'}
        </Button>
        <Button type="button" tone="secondary" leadingIcon={<RefreshCw size={14} />} onClick={() => updatePrompt(currentPreset.prompt)}>
          Refresh
        </Button>
        <IconButton aria-label="Capability settings" tone="ghost" icon={<SlidersHorizontal size={15} />} />
      </section>

      <section className="app-lab-result-shell" aria-label="Run result">
        <div className="app-lab-result-shell__head">
          <strong>Run result</strong>
          <div>
            <IconButton aria-label="Expand result" size="sm" tone="ghost" icon={<ChevronsLeftRight size={14} />} />
            <IconButton aria-label="Copy result" size="sm" tone="ghost" icon={<Copy size={14} />} />
          </div>
        </div>
        <ResultPanel result={currentResult} running={running} capability={capability} verboseConsole={verboseConsole} />
      </section>
    </Surface>
  );
}

function RecipeCompanion({ onOpen }: { onOpen: () => void }) {
  return (
    <Surface className="app-lab-recipes" material="glass-thin" tone="panel" elevation="base">
      <div className="app-lab-recipes__head">
        <div className="app-lab-panel-head">
          <span className="app-lab-step">3</span>
          <div>
            <p className="eyebrow">UI Recipe Companion</p>
            <p>Build the UI for this capability with Nimi Kit.</p>
          </div>
        </div>
      </div>
      <button type="button" className="app-lab-kit-hint" onClick={onOpen}>
        <ShieldCheck size={15} aria-hidden="true" />
        <span>Reviewed kit public surface</span>
        <ArrowRight size={14} aria-hidden="true" />
      </button>
      <div className="app-lab-recipe-list">
        {recipeCards.map((recipe) => {
          const Icon = recipe.icon;
          return (
            <article className="app-lab-recipe-card" key={recipe.title}>
              <div className="app-lab-recipe-card__icon" aria-hidden="true">
                <Icon size={16} />
              </div>
              <div className="app-lab-recipe-card__body">
                <div className="app-lab-recipe-card__title">
                  <strong>{recipe.title}</strong>
                  <IconButton aria-label={`${recipe.title} recipe details`} size="sm" tone="ghost" icon={<ChevronsLeftRight size={14} />} />
                </div>
                <p>{recipe.detail}</p>
                <ul>
                  {recipe.primitives.map((primitive) => (
                    <li key={primitive}>{primitive}</li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
      <Button type="button" tone="secondary" trailingIcon={<ArrowRight size={14} />} onClick={onOpen}>
        Open recipe browser
      </Button>
    </Surface>
  );
}

function ReadinessInspector({
  summary,
  history,
  historyError,
}: {
  summary: TesterAIConfigSummary | null;
  history: TesterRunHistory | null;
  historyError: string | null;
}) {
  const runtime = summary?.runtime ?? null;
  const sdkGaps = appLabCapabilities.filter((capability) => capability.execution === 'typed-unavailable').length;
  const admitted = appLabCapabilities.filter((capability) => capability.execution === 'runtime-sdk').length;
  const lastRun = latestRunRecord(history);
  const rows = [
    {
      title: 'Runtime session',
      tone: runtime?.status === 'ready' ? 'success' : runtime ? 'warning' : 'neutral',
      status: runtime?.status === 'ready' ? 'Active' : runtime ? 'Unavailable' : 'Checking',
      details: [runtime?.mode || 'dev-standalone', runtime?.detail || 'Waiting for Runtime inspection.'],
    },
    {
      title: 'Provider catalog',
      tone: summary ? 'success' : 'neutral',
      status: summary ? 'Loaded' : 'Checking',
      details: [summary?.providerCatalogSurface || 'runtimeAdmin.listConnectors/listConnectorModels', 'Scheduling owner: runtime'],
    },
    {
      title: 'SDK gaps',
      tone: sdkGaps > 0 ? 'warning' : 'success',
      status: sdkGaps > 0 ? `${sdkGaps} gaps` : 'No typed gaps',
      details: [`Admitted lanes: ${admitted} / ${appLabCapabilities.length}`, historyError ? `History: ${historyError}` : 'Typed unavailable lanes remain fail-closed.'],
    },
    {
      title: 'Evidence capture',
      tone: lastRun ? 'info' : 'neutral',
      status: lastRun ? 'Local record' : 'No record',
      details: [lastRun ? `App-owned run: ${lastRun.capabilityId}` : 'No local run record yet', lastRun ? lastRun.createdAt : 'Run a capability first.'],
    },
    {
      title: 'App boundary',
      tone: 'success',
      status: 'Strict',
      details: ['Policy: Strict boundary', 'Mode: fail-closed · REST bypass: No'],
    },
  ] as const;

  return (
    <aside className="app-lab-inspector" aria-label="Readiness Inspector">
      <div className="app-lab-inspector__head">
        <strong>Readiness Inspector</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      <div className="app-lab-inspector__cards">
        {rows.map((row) => (
          <Surface key={row.title} className="app-lab-inspector-card" material="glass-thin" tone="card" elevation="base">
            <div className="app-lab-inspector-card__head">
              <span className={`app-lab-inspector-card__icon app-lab-inspector-card__icon--${row.tone}`}>
                <CircleDot size={13} />
              </span>
              <strong>{row.title}</strong>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
            <StatusBadge tone={row.tone} shape="dot">{row.status}</StatusBadge>
            {row.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </Surface>
        ))}
      </div>
    </aside>
  );
}

function latestRunRecord(history: TesterRunHistory | null) {
  if (!history) return null;
  return Object.values(history)
    .flat()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function EvidenceTimeline({
  result,
  history,
  capability,
}: {
  result: TesterCapabilityRunResult | null;
  history: TesterRunHistory | null;
  capability: TesterCapability;
}) {
  const localRecord = history?.[capability.id]?.[0] ?? null;
  const isWorldTour = result?.capabilityId === 'world.generate';
  const artifactCount = result?.ok && result.output.kind === 'artifacts' && !isWorldTour ? result.output.artifactCount : 0;
  const hasTrace = Boolean(result?.ok && result.trace);
  const traceDetail = result?.ok && result.trace
    ? result.trace.traceId || result.trace.modelResolved || 'Trace metadata'
    : 'Not captured by this run';
  const items = [
    {
      title: 'Local run record',
      status: localRecord ? 'Recorded' : 'No record',
      detail: localRecord ? `app-owned history: ${localRecord.capabilityId}` : 'Run capability first',
      tone: localRecord ? 'info' : 'neutral',
    },
    {
      title: 'Runtime result',
      status: result ? (result.ok ? (isWorldTour ? 'Viewer opened' : 'Returned') : 'Blocked') : 'Waiting',
      detail: result ? (isWorldTour ? 'Tauri-only fixture; Runtime not invoked' : result.message) : 'No Runtime result yet',
      tone: result ? (result.ok ? (isWorldTour ? 'info' : 'success') : 'warning') : 'neutral',
    },
    {
      title: 'Artifact',
      status: artifactCount > 0 ? 'Captured' : isWorldTour ? 'Not runtime artifact' : 'No artifact yet',
      detail: artifactCount > 0 ? `${artifactCount} real artifact(s)` : isWorldTour ? 'Viewer fixture only; no artifact captured' : 'No real artifact captured',
      tone: artifactCount > 0 ? 'success' : isWorldTour ? 'info' : 'neutral',
    },
    {
      title: 'Boundary',
      status: result ? (result.ok ? (isWorldTour ? 'Strict active' : 'Observed') : 'Fail-closed') : 'Strict active',
      detail: result ? (isWorldTour ? 'App-owned Tauri command observed' : 'Runtime/SDK boundary observed') : 'Strict policy active',
      tone: result ? (result.ok ? 'success' : 'warning') : 'success',
    },
    {
      title: 'Trace',
      status: hasTrace ? 'Available' : 'Not captured',
      detail: traceDetail,
      tone: hasTrace ? 'success' : 'neutral',
    },
  ] as const;

  return (
    <Surface className="app-lab-timeline" material="glass-thin" tone="panel" elevation="base" aria-label="Evidence timeline">
      <div className="app-lab-timeline__head">
        <div>
          <strong>Evidence timeline</strong>
          <p>Separates local run records from runtime results, real artifacts, boundary observation, and traces.</p>
        </div>
        <Button type="button" tone="secondary" size="sm" trailingIcon={<ArrowRight size={13} />}>
          View all runs
        </Button>
      </div>
      <ol className="app-lab-timeline__rail">
        {items.map((item) => (
          <li key={item.title} className={`app-lab-timeline__item app-lab-timeline__item--${item.tone}`}>
            <span className="app-lab-timeline__node" aria-hidden="true" />
            <strong>{item.title}</strong>
            <span>{item.status}</span>
            <p>{item.detail}</p>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

export function SectionAppLab({
  activeId,
  onSelect,
  capability,
  onResult,
  summary,
  history,
  lastResult,
  historyError,
  onOpenKitComponents,
  verboseConsole,
  draftPersistence,
}: SectionAppLabProps) {
  const runtime = summary?.runtime ?? null;
  return (
    <div className="section-app-lab" data-testid="nimi-tester-section-app-lab">
      <div className="app-lab-main">
        <header className="app-lab-title">
          <div>
            <h1>App Lab</h1>
            <p>Build, run, and capture evidence for a runtime-backed Nimi App.</p>
          </div>
        </header>
        <AppLabAIConfigPanel runtime={runtime} />
        <div className="app-lab-workspace">
          <CapabilityRail
            activeId={activeId}
            runtime={runtime}
            lastResult={lastResult}
            onSelect={onSelect}
          />
          <CapabilityLab
            capability={capability}
            runtime={runtime}
            lastResult={lastResult}
            onResult={onResult}
            verboseConsole={verboseConsole}
            draftPersistence={draftPersistence}
          />
          <RecipeCompanion onOpen={onOpenKitComponents} />
        </div>
        <EvidenceTimeline
          result={lastResult?.capabilityId === capability.id ? lastResult : null}
          history={history}
          capability={capability}
        />
      </div>
      <ReadinessInspector summary={summary} history={history} historyError={historyError} />
    </div>
  );
}
