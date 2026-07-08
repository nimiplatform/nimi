import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_CENTER_SECTION_LABELS } from '../sections.js';
import { isAgentCenterState, resolveAgentCenterState } from '../state.js';
import type {
  AgentCenterAppearanceAdapter,
  AgentCenterAppearanceCopy,
  AgentCenterAppearanceProjection,
  AgentCenterBehaviorCopy,
  AgentCenterIdentityProjection,
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
    state.appearance.status === 'ready',
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

function AgentCenterOverview({
  state,
  onSectionSelect,
}: {
  readonly state: AgentCenterState;
  readonly onSectionSelect: (section: AgentCenterSectionId) => void;
}) {
  const setup = agentCenterSetupProgress(state);
  const appearanceReady = state.appearance.status === 'ready';
  const behaviorReady = state.autonomy.enabled === true;
  const cognitionReady = state.cognition.memoryState !== 'unavailable';
  const checklist = [
    {
      section: 'appearance' as const,
      done: appearanceReady,
      attention: !appearanceReady,
      title: AGENT_CENTER_SECTION_LABELS.appearance,
      description: appearanceReady ? 'Runtime appearance projection admitted.' : state.appearance.disabledReason || 'Avatar and appearance admission are pending.',
      pill: appearanceReady ? 'Ready' : 'Needs setup',
    },
    {
      section: 'model' as const,
      done: setup.requiredModelReady,
      attention: !setup.requiredModelReady,
      title: AGENT_CENTER_SECTION_LABELS.model,
      description: setup.requiredModelReady ? 'Required Runtime Agent AI Config intents are ready.' : state.baseTextDisabledReason || 'Required text and embedding routes need Runtime config.',
      pill: setup.requiredModelReady ? 'Ready' : 'Needs setup',
    },
    {
      section: 'behavior' as const,
      done: behaviorReady,
      attention: false,
      title: AGENT_CENTER_SECTION_LABELS.behavior,
      description: behaviorReady ? `Autonomy is ${state.autonomy.mode || 'enabled'}.` : state.autonomy.disabledReason || 'Autonomy is available as Runtime-owned configuration.',
      pill: behaviorReady ? 'Enabled' : 'Off',
    },
    {
      section: 'cognition' as const,
      done: cognitionReady,
      attention: false,
      title: AGENT_CENTER_SECTION_LABELS.cognition,
      description: state.cognition.statusText || state.cognition.executionState || 'Runtime memory and lifecycle projection.',
      pill: cognitionReady ? 'Projected' : 'Read-only',
    },
  ];
  return (
    <SectionShell labelledBy="agent-center-overview-title">
      <h2 className="sr-only" id="agent-center-overview-title">{AGENT_CENTER_SECTION_LABELS.overview}</h2>
      <ProgressHero
        setupDone={setup.done}
        setupTotal={setup.total}
        title={setup.remaining === 0 ? 'Runtime local agent ready' : 'Configuration needs attention'}
      />
      <div>
        <h3 className="mb-2 mt-1 text-[13px] font-semibold text-slate-950">Configuration checklist</h3>
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

function AgentCenterAdvanced({ state }: { readonly state: AgentCenterState }) {
  return (
    <SectionShell labelledBy="agent-center-advanced-title">
      <SectionHeader
        description={state.diagnostics.source}
        id="agent-center-advanced-title"
        title={AGENT_CENTER_SECTION_LABELS.advanced}
      />
      <Card>
        <KvGrid>
          <Kv label="Config revision" value={state.diagnostics.configRevision ?? 'unavailable'} />
          <Kv label="Runtime turn" value={state.diagnostics.runtimeTurnId || 'not projected'} mono />
          <Kv label="Runtime stream" value={state.diagnostics.runtimeStreamId || 'not projected'} mono />
          <Kv label="Runtime error" value={state.diagnostics.runtimeError || 'none'} muted={!state.diagnostics.runtimeError} />
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
) {
  switch (section) {
    case 'model':
      return <AgentCenterModelSection runtimeAdapter={runtimeAdapter} state={state} />;
    case 'behavior':
      return <AgentCenterBehaviorSection copy={behaviorCopy} runtimeAdapter={runtimeAdapter} state={state} />;
    case 'cognition':
      return <AgentCenterCognitionSection state={state} />;
    case 'appearance':
      return <AgentCenterAppearanceSection appearanceAdapter={appearanceAdapter} copy={appearanceCopy} state={state} />;
    case 'advanced':
      return <AgentCenterAdvanced state={state} />;
    default:
      return <AgentCenterOverview onSectionSelect={() => undefined} state={state} />;
  }
}

function normalizeLoadError(error: unknown): string {
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
  return 'Runtime Agent Center projection load failed.';
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
              Agent Center
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
          <AgentButton ariaLabel="Close Agent Center" className="h-9 w-9 px-0 shadow-[0_8px_18px_rgba(15,23,42,0.08)]" onClick={props.onClose} variant="default">
            <X aria-hidden="true" className="h-4 w-4" />
          </AgentButton>
        ) : null}
      </header>
    );
  }
  return (
    <header className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[20px] font-semibold leading-[1.2] text-slate-950">Agent Center</h1>
        <p className={cnAgentCenter(
          'm-0 mt-1.5 text-[13px] leading-[1.45]',
          props.state.statusTone === 'ready' && 'text-emerald-700',
          props.state.statusTone === 'attention' && 'text-amber-700',
          props.state.statusTone === 'failed' && 'text-red-700',
          props.state.statusTone === 'loading' && 'text-sky-700',
          props.state.statusTone === 'disabled' && 'text-slate-500',
        )}>
          {props.state.baseTextReady ? 'Runtime text turns ready' : props.state.baseTextDisabledReason}
        </p>
      </div>
      {props.onClose ? (
        <AgentButton ariaLabel="Close Agent Center" className="h-9 w-9 px-0" onClick={props.onClose} variant="default">
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
        setLoadError(normalizeLoadError(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.runtimeAdapter, runtimeProjectionSupplied]);
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
        setAppearanceLoadError(normalizeLoadError(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appearanceLoader, appearanceProjectionSupplied]);
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
      autonomyMutationAvailable: placementState.autonomyMutationAvailable === true || runtimeAutonomyMutationAvailable,
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
  const activeSectionLabel = AGENT_CENTER_SECTION_LABELS[activeSection];
  const chrome = props.chrome || 'standalone';
  const setup = agentCenterSetupProgress(state);
  const setSection = (section: AgentCenterSectionId) => {
    if (!props.activeSection) {
      setUncontrolledSection(section);
    }
    props.onSectionChange?.(section);
  };

  return (
    <section
      aria-label={props.ariaLabel || 'Agent Center'}
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
          identity={props.identity}
          onClose={props.placementActions?.close}
          state={state}
        />
      ) : null}
      <nav
        aria-label="Agent Center sections"
        className="flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 pb-1 pt-2.5"
        data-agent-center-nav-style="desktop-dynamic-expand"
      >
        {state.sections.map((section) => {
          const Icon = SECTION_ICONS[section];
          const selected = section === activeSection;
          const badge = section === 'overview' && setup.remaining > 0 ? setup.remaining : null;
          return (
            <button
              aria-label={AGENT_CENTER_SECTION_LABELS[section]}
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
                  'overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0.0,1)]',
                  selected ? 'ml-2 max-w-[160px] opacity-100 max-[420px]:ml-0 max-[420px]:max-w-0 max-[420px]:opacity-0' : 'ml-0 max-w-0 opacity-0',
                )}
              >
                {AGENT_CENTER_SECTION_LABELS[section]}
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
        <div className="mb-3">
          <h4
            className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500"
            data-agent-center-active-section-label="true"
          >
            {activeSectionLabel}
          </h4>
        </div>
        {activeSection === 'overview'
          ? <AgentCenterOverview onSectionSelect={setSection} state={state} />
          : renderSection(activeSection, state, props.runtimeAdapter, props.appearanceAdapter, props.appearanceCopy, props.behaviorCopy)}
      </div>
    </section>
  );
}
