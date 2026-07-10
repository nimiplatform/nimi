import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_CENTER_SECTION_LABELS } from '../sections.js';
import { isAgentCenterAvatarPreviewReady } from '../appearance-preview-readiness.js';
import { isAgentCenterState, resolveAgentCenterState } from '../state.js';
import type {
  AgentCenterAdvancedCopy,
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceCopy,
  AgentCenterAppearanceProjection,
  AgentCenterBehaviorCopy,
  AgentCenterChromeCopy,
  AgentCenterCopy,
  AgentCenterIdentityProjection,
  AgentCenterModelCopy,
  AgentCenterOverviewCopy,
  AgentCenterProgressCopy,
  AgentCenterProps,
  AgentCenterRuntimeAdapter,
  AgentCenterRuntimeSnapshot,
  AgentCenterSectionId,
  AgentCenterState,
  AgentCenterStateInput,
} from '../types.js';
import { AgentCenterAppearanceSection } from './AgentCenterAppearanceSection.js';
import { AgentCenterBehaviorSection } from './AgentCenterBehaviorSection.js';
import { AgentCenterCognitionSection } from './AgentCenterCognitionSection.js';
import { AgentCenterModelSection } from './AgentCenterModelSection.js';
import {
  AgentButton,
  Card,
  ChecklistItem,
  Kv,
  KvGrid,
  ProgressHero,
  SECTION_ICONS,
  SectionHeader,
  SectionShell,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';

function checklistTone(done: boolean, attention: boolean) {
  if (done) {
    return 'done';
  }
  return attention ? 'attn' : 'todo';
}

function agentCenterSetupProgress(state: AgentCenterState) {
  const requiredModelReady = state.capabilities
    .filter((capability) => capability.required)
    .every((capability) => capability.readinessState === 'ready');
  const checklistDone = [
    isAgentCenterAvatarPreviewReady(state.appearance),
    requiredModelReady,
    state.autonomy.enabled === true,
    state.cognition.memoryState !== 'unavailable',
    state.runtimeStatus === 'ready',
  ].filter(Boolean).length;
  const total = 5;
  return {
    done: checklistDone,
    total,
    remaining: Math.max(0, total - checklistDone),
    requiredModelReady,
  };
}

const DEFAULT_CHROME_COPY: Required<AgentCenterChromeCopy> = {
  title: 'Agent Center',
  eyebrow: 'Agent Center',
  closeLabel: 'Close Agent Center',
  navLabel: 'Agent Center sections',
  textReadyLabel: 'Runtime text turns ready',
  avatarFallback: 'A',
  projectionLoadFailed: 'Runtime Agent Center projection load failed.',
};

const DEFAULT_PROGRESS_COPY: Required<AgentCenterProgressCopy> = {
  configLabel: 'Config',
};

const DEFAULT_OVERVIEW_COPY: Required<AgentCenterOverviewCopy> = {
  readyTitle: 'Runtime local agent ready',
  attentionTitle: 'Configuration needs attention',
  checklistTitle: 'Configuration checklist',
  appearanceReadyDescription: 'Runtime appearance projection admitted.',
  appearancePendingDescription: 'Avatar and appearance admission are pending.',
  modelReadyDescription: 'Required Runtime Agent AI Config intents are ready.',
  modelPendingDescription: 'Required text and embedding routes need Runtime config.',
  behaviorReadyDescriptionPrefix: 'Autonomy is enabled.',
  behaviorReadyEnabledFallback: 'enabled',
  behaviorOffDescription: 'Autonomy is available as Runtime-owned configuration.',
  cognitionFallbackDescription: 'Runtime memory and lifecycle projection.',
  readyPill: 'Ready',
  needsSetupPill: 'Needs setup',
  enabledPill: 'Enabled',
  offPill: 'Off',
  projectedPill: 'Projected',
  readOnlyPill: 'Read-only',
};

const DEFAULT_ADVANCED_COPY: Required<AgentCenterAdvancedCopy> = {
  title: AGENT_CENTER_SECTION_LABELS.advanced,
  descriptionRuntimeProjection: 'runtime-projection',
  descriptionUnavailable: 'unavailable',
  configRevisionLabel: 'Config revision',
  runtimeTurnLabel: 'Runtime turn',
  runtimeStreamLabel: 'Runtime stream',
  runtimeErrorLabel: 'Runtime error',
  unavailableValue: 'unavailable',
  notProjectedValue: 'not projected',
  noneValue: 'none',
};

function resolveSectionLabels(copy: AgentCenterCopy | undefined): Record<AgentCenterSectionId, string> {
  return {
    ...AGENT_CENTER_SECTION_LABELS,
    ...(copy?.sectionLabels || {}),
  };
}

function resolveChromeCopy(copy: AgentCenterCopy | undefined): Required<AgentCenterChromeCopy> {
  return {
    ...DEFAULT_CHROME_COPY,
    ...(copy?.chrome || {}),
  };
}

function resolveProgressCopy(copy: AgentCenterCopy | undefined): Required<AgentCenterProgressCopy> {
  return {
    ...DEFAULT_PROGRESS_COPY,
    ...(copy?.progress || {}),
  };
}

function resolveOverviewCopy(copy: AgentCenterCopy | undefined): Required<AgentCenterOverviewCopy> {
  return {
    ...DEFAULT_OVERVIEW_COPY,
    ...(copy?.overview || {}),
  };
}

function resolveAdvancedCopy(copy: AgentCenterCopy | undefined): Required<AgentCenterAdvancedCopy> {
  return {
    ...DEFAULT_ADVANCED_COPY,
    ...(copy?.advanced || {}),
  };
}

function AgentCenterOverview({
  copy,
  progressCopy,
  sectionLabels,
  state,
  onSectionSelect,
}: {
  readonly copy: Required<AgentCenterOverviewCopy>;
  readonly progressCopy: Required<AgentCenterProgressCopy>;
  readonly sectionLabels: Record<AgentCenterSectionId, string>;
  readonly state: AgentCenterState;
  readonly onSectionSelect: (section: AgentCenterSectionId) => void;
}) {
  const setup = agentCenterSetupProgress(state);
  const appearanceReady = isAgentCenterAvatarPreviewReady(state.appearance);
  const behaviorReady = state.autonomy.enabled === true;
  const cognitionReady = state.cognition.memoryState !== 'unavailable';
  const checklist = [
    {
      section: 'appearance' as const,
      done: appearanceReady,
      attention: !appearanceReady,
      title: sectionLabels.appearance,
      description: appearanceReady ? copy.appearanceReadyDescription : copy.appearancePendingDescription,
      pill: appearanceReady ? copy.readyPill : copy.needsSetupPill,
    },
    {
      section: 'model' as const,
      done: setup.requiredModelReady,
      attention: !setup.requiredModelReady,
      title: sectionLabels.model,
      description: setup.requiredModelReady ? copy.modelReadyDescription : copy.modelPendingDescription,
      pill: setup.requiredModelReady ? copy.readyPill : copy.needsSetupPill,
    },
    {
      section: 'behavior' as const,
      done: behaviorReady,
      attention: false,
      title: sectionLabels.behavior,
      description: behaviorReady ? copy.behaviorReadyDescriptionPrefix : copy.behaviorOffDescription,
      pill: behaviorReady ? copy.enabledPill : copy.offPill,
    },
    {
      section: 'cognition' as const,
      done: cognitionReady,
      attention: false,
      title: sectionLabels.cognition,
      description: copy.cognitionFallbackDescription,
      pill: cognitionReady ? copy.projectedPill : copy.readOnlyPill,
    },
  ];
  return (
    <SectionShell labelledBy="agent-center-overview-title">
      <h2 className="sr-only" id="agent-center-overview-title">{sectionLabels.overview}</h2>
      <ProgressHero
        configLabel={progressCopy.configLabel}
        setupDone={setup.done}
        setupTotal={setup.total}
        title={setup.remaining === 0 ? copy.readyTitle : copy.attentionTitle}
      />
      <div>
        <h3 className="mb-2 mt-1 text-[13px] font-semibold text-slate-950">{copy.checklistTitle}</h3>
        <Card>
          {checklist.map((item, index) => (
            <ChecklistItem
              description={item.description}
              index={index + 1}
              key={item.section}
              onClick={() => onSectionSelect(item.section)}
              pill={{
                label: item.pill,
                tone: item.done ? 'ready' : item.attention ? 'warn' : 'muted',
              }}
              status={checklistTone(item.done, item.attention)}
              title={item.title}
            />
          ))}
        </Card>
      </div>
    </SectionShell>
  );
}

function AgentCenterAdvanced({
  copy,
  state,
}: {
  readonly copy: Required<AgentCenterAdvancedCopy>;
  readonly state: AgentCenterState;
}) {
  return (
    <SectionShell labelledBy="agent-center-advanced-title">
      <SectionHeader
        description={state.diagnostics.source === 'runtime-projection'
          ? copy.descriptionRuntimeProjection
          : copy.descriptionUnavailable}
        id="agent-center-advanced-title"
        title={copy.title}
      />
      <Card>
        <KvGrid>
          <Kv label={copy.configRevisionLabel} value={state.diagnostics.configRevision ?? copy.unavailableValue} />
          <Kv label={copy.runtimeTurnLabel} value={state.diagnostics.runtimeTurnId || copy.notProjectedValue} mono />
          <Kv label={copy.runtimeStreamLabel} value={state.diagnostics.runtimeStreamId || copy.notProjectedValue} mono />
          <Kv label={copy.runtimeErrorLabel} value={state.diagnostics.runtimeError || copy.noneValue} muted={!state.diagnostics.runtimeError} />
        </KvGrid>
      </Card>
    </SectionShell>
  );
}

function renderSection(
  section: AgentCenterSectionId,
  state: AgentCenterState,
  runtimeAdapter: AgentCenterRuntimeAdapter | null | undefined,
  appearanceAdapter: AgentCenterAppearanceAdapter | null | undefined,
  appearanceCopy: AgentCenterAppearanceCopy | undefined,
  behaviorCopy: AgentCenterBehaviorCopy | undefined,
  modelCopy: AgentCenterModelCopy | undefined,
  advancedCopy: Required<AgentCenterAdvancedCopy>,
  overviewCopy: Required<AgentCenterOverviewCopy>,
  progressCopy: Required<AgentCenterProgressCopy>,
  sectionLabels: Record<AgentCenterSectionId, string>,
) {
  switch (section) {
    case 'model':
      return <AgentCenterModelSection copy={modelCopy} runtimeAdapter={runtimeAdapter} state={state} />;
    case 'behavior':
      return <AgentCenterBehaviorSection copy={behaviorCopy} runtimeAdapter={runtimeAdapter} state={state} />;
    case 'cognition':
      return <AgentCenterCognitionSection state={state} />;
    case 'appearance':
      return <AgentCenterAppearanceSection appearanceAdapter={appearanceAdapter} copy={appearanceCopy} state={state} />;
    case 'advanced':
      return <AgentCenterAdvanced copy={advancedCopy} state={state} />;
    default:
      return (
        <AgentCenterOverview
          copy={overviewCopy}
          onSectionSelect={() => undefined}
          progressCopy={progressCopy}
          sectionLabels={sectionLabels}
          state={state}
        />
      );
  }
}

function normalizeLoadError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message.trim() : '';
    const reasonCode = typeof record.reasonCode === 'string' ? record.reasonCode.trim() : '';
    const actionHint = typeof record.actionHint === 'string' ? record.actionHint.trim() : '';
    const detail = [message, reasonCode, actionHint].filter(Boolean).join(' ');
    if (detail) {
      return detail;
    }
  }
  return fallback;
}

function agentCenterAvatarFallback(identity: AgentCenterIdentityProjection): string {
  const explicit = identity.avatarFallback?.trim();
  if (explicit) {
    return explicit.slice(0, 2);
  }
  const displayName = identity.displayName.trim();
  return (displayName.charAt(0) || 'A').toUpperCase();
}

function hasSuppliedRuntimeProjection(state: AgentCenterProps['state']): boolean {
  if (isAgentCenterState(state)) {
    return true;
  }
  return Object.prototype.hasOwnProperty.call(state, 'agentAIConfig')
    || Object.prototype.hasOwnProperty.call(state, 'readiness')
    || Object.prototype.hasOwnProperty.call(state, 'inspect')
    || Object.prototype.hasOwnProperty.call(state, 'memory')
    || Boolean(state.runtimeError);
}

function hasSuppliedAppearanceProjection(state: AgentCenterProps['state']): boolean {
  if (isAgentCenterState(state)) {
    return true;
  }
  return Boolean((state as AgentCenterStateInput).appearance);
}

function AgentCenterChromeHeader(props: {
  readonly copy: Required<AgentCenterChromeCopy>;
  readonly identity?: AgentCenterIdentityProjection | null;
  readonly state: AgentCenterState;
  readonly onClose?: (() => void) | undefined;
}) {
  if (props.identity?.displayName.trim()) {
    const identity = props.identity;
    const fallback = agentCenterAvatarFallback(identity);
    return (
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[18px] border border-emerald-300/70 bg-emerald-500/15 text-lg font-semibold text-emerald-950 shadow-[0_0_0_3px_rgba(168,85,247,0.22)]">
            {identity.avatarUrl ? (
              <img
                alt=""
                className="h-full w-full object-cover"
                src={identity.avatarUrl}
              />
            ) : fallback}
          </span>
          <div className="min-w-0 pt-1">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {props.copy.eyebrow}
            </span>
            <h1 className="m-0 truncate text-[16px] font-semibold leading-[1.25] text-slate-950">
              {identity.displayName}
            </h1>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {identity.localAgentRef ? (
                <small
                  className="max-w-[260px] truncate font-mono text-[11.5px] leading-[1.35] text-slate-500"
                  title={identity.localAgentRef}
                >
                  {identity.localAgentRef}
                </small>
              ) : null}
              {identity.badgeLabel ? (
                <em className="inline-flex max-w-full shrink-0 rounded-full border border-violet-300/60 bg-violet-500/10 px-2 py-px text-[10.5px] font-semibold not-italic text-violet-700">
                  {identity.badgeLabel}
                </em>
              ) : null}
            </div>
          </div>
        </div>
        {props.onClose ? (
          <AgentButton ariaLabel={props.copy.closeLabel} className="h-9 w-9 px-0 shadow-[0_8px_18px_rgba(15,23,42,0.08)]" onClick={props.onClose} variant="default">
            <X aria-hidden="true" className="h-4 w-4" />
          </AgentButton>
        ) : null}
      </header>
    );
  }
  return (
    <header className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[20px] font-semibold leading-[1.2] text-slate-950">{props.copy.title}</h1>
        <p className={cnAgentCenter(
          'm-0 mt-1.5 text-[13px] leading-[1.45]',
          props.state.statusTone === 'ready' && 'text-emerald-700',
          props.state.statusTone === 'attention' && 'text-amber-700',
          props.state.statusTone === 'failed' && 'text-red-700',
          props.state.statusTone === 'loading' && 'text-sky-700',
          props.state.statusTone === 'disabled' && 'text-slate-500',
        )}>
          {props.state.baseTextReady ? props.copy.textReadyLabel : props.state.baseTextDisabledReason}
        </p>
      </div>
      {props.onClose ? (
        <AgentButton ariaLabel={props.copy.closeLabel} className="h-9 w-9 px-0" onClick={props.onClose} variant="default">
          <X aria-hidden="true" className="h-4 w-4" />
        </AgentButton>
      ) : null}
    </header>
  );
}

export function AgentCenter(props: AgentCenterProps) {
  const [loadedSnapshot, setLoadedSnapshot] = useState<AgentCenterRuntimeSnapshot | null>(null);
  const [loadedAppearance, setLoadedAppearance] = useState<AgentCenterAppearanceProjection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [appearanceLoadError, setAppearanceLoadError] = useState<string | null>(null);
  const runtimeAutonomyMutationAvailable = typeof props.runtimeAdapter?.setAutonomyConfig === 'function';
  const runtimeProjectionSupplied = hasSuppliedRuntimeProjection(props.state);
  const appearanceProjectionSupplied = hasSuppliedAppearanceProjection(props.state);
  const chromeCopy = useMemo(() => resolveChromeCopy(props.copy), [props.copy]);
  useEffect(() => {
    const adapter = props.runtimeAdapter;
    if (!adapter || runtimeProjectionSupplied) {
      setLoadedSnapshot(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    void adapter.loadSnapshot().then((snapshot) => {
      if (!cancelled) {
        setLoadedSnapshot(snapshot);
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setLoadedSnapshot(null);
        setLoadError(normalizeLoadError(error, chromeCopy.projectionLoadFailed));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [chromeCopy.projectionLoadFailed, props.runtimeAdapter, runtimeProjectionSupplied]);
  const appearanceLoader = props.appearanceAdapter?.load;
  useEffect(() => {
    if (!appearanceLoader || appearanceProjectionSupplied) {
      setLoadedAppearance(null);
      setAppearanceLoadError(null);
      return;
    }
    let cancelled = false;
    setAppearanceLoadError(null);
    void appearanceLoader().then((projection) => {
      if (!cancelled) {
        setLoadedAppearance(projection);
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setLoadedAppearance(null);
        setAppearanceLoadError(normalizeLoadError(error, chromeCopy.projectionLoadFailed));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appearanceLoader, appearanceProjectionSupplied, chromeCopy.projectionLoadFailed]);
  const state = useMemo(() => {
    if (isAgentCenterState(props.state)) {
      return {
        ...props.state,
        ...(loadedAppearance ? { appearance: loadedAppearance } : {}),
        ...(appearanceLoadError ? {
          appearance: {
            ...props.state.appearance,
            status: 'invalid' as const,
            disabledReason: appearanceLoadError,
          },
        } : {}),
      };
    }
    const placementState = props.state as AgentCenterStateInput;
    return resolveAgentCenterState({
      ...placementState,
      ...(loadedSnapshot || {}),
      autonomyMutationAvailable: placementState.autonomyMutationAvailable ?? runtimeAutonomyMutationAvailable,
      ...(loadedAppearance ? { appearance: loadedAppearance } : {}),
      ...(appearanceLoadError ? {
        appearance: {
          ...(placementState.appearance || {}),
          status: 'invalid' as const,
          disabledReason: appearanceLoadError,
        },
      } : {}),
      runtimeError: loadError || loadedSnapshot?.runtimeError || placementState.runtimeError || null,
    });
  }, [appearanceLoadError, loadError, loadedAppearance, loadedSnapshot, props.state, runtimeAutonomyMutationAvailable]);
  const [uncontrolledSection, setUncontrolledSection] = useState<AgentCenterSectionId>(
    props.defaultSection || 'overview',
  );
  const activeSection = props.activeSection || uncontrolledSection;
  const chrome = props.chrome || 'standalone';
  const setup = agentCenterSetupProgress(state);
  const sectionLabels = useMemo(() => resolveSectionLabels(props.copy), [props.copy]);
  const overviewCopy = useMemo(() => resolveOverviewCopy(props.copy), [props.copy]);
  const progressCopy = useMemo(() => resolveProgressCopy(props.copy), [props.copy]);
  const advancedCopy = useMemo(() => resolveAdvancedCopy(props.copy), [props.copy]);
  const setSection = (section: AgentCenterSectionId) => {
    if (!props.activeSection) {
      setUncontrolledSection(section);
    }
    props.onSectionChange?.(section);
  };

  return (
    <section
      aria-label={props.ariaLabel || chromeCopy.title}
      className={cnAgentCenter(
        'grid min-w-0 max-w-full text-slate-950',
        chrome === 'standalone'
          ? 'gap-4 rounded-[18px] border border-slate-200/80 bg-white/80 p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]'
          : 'gap-3',
      )}
      data-chat-agent-center="true"
    >
      {chrome === 'standalone' ? (
        <AgentCenterChromeHeader
          copy={chromeCopy}
          identity={props.identity}
          onClose={props.placementActions?.close}
          state={state}
        />
      ) : null}
      <nav
        aria-label={chromeCopy.navLabel}
        className="flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 pb-1 pt-2.5"
        data-agent-center-nav-style="desktop-dynamic-expand"
      >
        {state.sections.map((section) => {
          const Icon = SECTION_ICONS[section];
          const selected = section === activeSection;
          const badge = section === 'overview' && setup.remaining > 0 ? setup.remaining : null;
          return (
            <button
              aria-label={sectionLabels[section]}
              aria-current={selected ? 'page' : undefined}
              aria-pressed={selected}
              className={cnAgentCenter(
                'group relative flex h-9 min-w-[36px] shrink-0 items-center rounded-[12px] text-[12px] font-medium',
                'transition-[width,background-color,color,padding] duration-300 ease-[cubic-bezier(0.32,0.72,0.0,1)]',
                'outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70',
                selected
                  ? 'bg-emerald-500/15 px-3 text-emerald-800 max-[420px]:w-9 max-[420px]:justify-center max-[420px]:px-0'
                  : badge
                    ? 'w-[48px] justify-center px-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    : 'w-9 justify-center px-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900',
              )}
              data-testid={`chat-agent-center-section:${section}`}
              key={section}
              onClick={() => setSection(section)}
              style={{
                outline: 'none',
                ...(selected
                  ? {
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    color: '#065f46',
                  }
                  : {}),
              }}
              type="button"
            >
              <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              <span
                className={cnAgentCenter(
                  'overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0.0,1)] max-[420px]:hidden',
                  selected ? 'ml-2 max-w-[160px] opacity-100 max-[420px]:ml-0 max-[420px]:max-w-0 max-[420px]:opacity-0' : 'ml-0 max-w-0 opacity-0',
                )}
              >
                {sectionLabels[section]}
              </span>
              {badge ? (
                <span
                  aria-hidden="true"
                  className={cnAgentCenter(
                    'pointer-events-none grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm ring-2 ring-white',
                    selected ? 'ml-1.5 shrink-0' : 'ml-1 shrink-0',
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0">
        {activeSection === 'overview'
          ? (
            <AgentCenterOverview
              copy={overviewCopy}
              onSectionSelect={setSection}
              progressCopy={progressCopy}
              sectionLabels={sectionLabels}
              state={state}
            />
          )
          : renderSection(
            activeSection,
            state,
            props.runtimeAdapter,
            props.appearanceAdapter,
            props.appearanceCopy,
            props.behaviorCopy,
            props.copy?.model,
            advancedCopy,
            overviewCopy,
            progressCopy,
            sectionLabels,
          )}
      </div>
    </section>
  );
}
