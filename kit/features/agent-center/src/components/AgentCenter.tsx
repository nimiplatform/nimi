import { PlayCircle, Settings, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Button, IconButton, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import { CANONICAL_CAPABILITY_CATALOG } from '@nimiplatform/kit/core/runtime-capabilities';
import { AGENT_CENTER_SECTION_LABELS } from '../sections.js';
import {
  isAgentCenterAppearanceConfigured,
  isAgentCenterCommittedAppearanceReady,
} from '../appearance-render-readiness.js';
import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog, getAgentCenterCatalogRecord } from '../locales/index.js';
import { useAgentCenterStore } from '../store.js';
import type {
  AgentCenterAdvancedCopy,
  AgentCenterChromeCopy,
  AgentCenterIdentityProjection,
  AgentCenterOverviewCopy,
  AgentCenterProgressCopy,
  AgentCenterProps,
  AgentCenterSectionId,
  AgentCenterSession,
  AgentCenterSnapshot,
  AgentCenterState,
} from '../types.js';
import { AgentCenterAppearanceSection } from './AgentCenterAppearanceSection.js';
import { AgentCenterBehaviorSection } from './AgentCenterBehaviorSection.js';
import { AgentCenterCognitionSection } from './AgentCenterCognitionSection.js';
import { AgentCenterAIConfigSection } from './AgentCenterAIConfigSection.js';
import {
  Card,
  ChecklistItem,
  Kv,
  KvGrid,
  ProgressHero,
  SECTION_ICONS,
  SectionHeader,
  SectionShell,
  StatusPill,
  cnAgentCenter,
} from './AgentCenterPrimitives.js';

function checklistTone(done: boolean, attention: boolean) {
  if (done) {
    return 'done';
  }
  return attention ? 'attn' : 'todo';
}

function agentCenterSetupProgress(state: AgentCenterState) {
  const requiredCapabilities = state.capabilities.filter((capability) => capability.required);
  const canonicalEmbeddingCapabilities = new Set(
    CANONICAL_CAPABILITY_CATALOG
      .filter((descriptor) => descriptor.section === 'embed')
      .map((descriptor) => descriptor.capabilityId),
  );
  const projectedEmbeddingCapabilities = state.capabilities
    .filter((capability) => canonicalEmbeddingCapabilities.has(capability.capability));
  const requiredCapabilitiesConfigured = requiredCapabilities.length > 0
    ? requiredCapabilities.every((capability) => capability.configurationState === 'configured' && capability.intent !== null)
    : state.baseTextConfigured
      && projectedEmbeddingCapabilities.length > 0
      && projectedEmbeddingCapabilities.every((capability) => (
        capability.configurationState === 'configured' && capability.intent !== null
      ));
  const checklistDone = [
    isAgentCenterAppearanceConfigured(state.appearance),
    requiredCapabilitiesConfigured,
    state.autonomy.enabled === true,
    state.cognition.memoryState !== 'unavailable',
    state.runtimeStatus === 'ready',
  ].filter(Boolean).length;
  const total = 5;
  return {
    done: checklistDone,
    total,
    remaining: Math.max(0, total - checklistDone),
    requiredCapabilitiesConfigured,
  };
}

const DEFAULT_CHROME_COPY = getAgentCenterCatalogRecord('AgentCenter.chrome.') as Required<AgentCenterChromeCopy>;

const DEFAULT_PROGRESS_COPY = getAgentCenterCatalogRecord('AgentCenter.progress.') as Required<AgentCenterProgressCopy>;

const DEFAULT_OVERVIEW_COPY = getAgentCenterCatalogRecord('AgentCenter.overview.') as Required<AgentCenterOverviewCopy>;

const DEFAULT_ADVANCED_COPY = getAgentCenterCatalogRecord('AgentCenter.advanced.') as Required<AgentCenterAdvancedCopy>;

function formatProjectionCopy(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(values[name] ?? ''));
}

function sourceContextOverviewStatus(
  state: AgentCenterState,
  copy: Required<AgentCenterOverviewCopy>,
) {
  switch (state.sourceContext.status) {
    case 'ready':
      return { description: copy.sourceContextReadyDescription, label: copy.sourceContextReadyPill, tone: 'ready' as const };
    case 'blocked':
      return { description: copy.sourceContextBlockedDescription, label: copy.sourceContextBlockedPill, tone: 'warn' as const };
    case 'truncated':
      return { description: copy.sourceContextTruncatedDescription, label: copy.sourceContextTruncatedPill, tone: 'warn' as const };
    case 'failed':
      return { description: copy.sourceContextFailedDescription, label: copy.sourceContextFailedPill, tone: 'err' as const };
    default:
      return { description: copy.sourceContextUnknownDescription, label: copy.sourceContextUnknownPill, tone: 'muted' as const };
  }
}

function translateCopyRecord<T extends Readonly<Record<string, string>>>(
  i18n: AgentCenterProps['i18n'],
  namespace: string,
  record: T,
): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    translateAgentCenter(i18n, `${namespace}.${key}`, value),
  ])) as T;
}

function resolveSectionLabels(): Record<AgentCenterSectionId, string> {
  return { ...AGENT_CENTER_SECTION_LABELS };
}

function resolveChromeCopy(): Required<AgentCenterChromeCopy> {
  return { ...DEFAULT_CHROME_COPY };
}

function resolveProgressCopy(): Required<AgentCenterProgressCopy> {
  return { ...DEFAULT_PROGRESS_COPY };
}

function resolveOverviewCopy(): Required<AgentCenterOverviewCopy> {
  return { ...DEFAULT_OVERVIEW_COPY };
}

function resolveAdvancedCopy(): Required<AgentCenterAdvancedCopy> {
  return { ...DEFAULT_ADVANCED_COPY };
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
  const appearanceReady = isAgentCenterAppearanceConfigured(state.appearance);
  const behaviorReady = state.autonomy.enabled === true;
  const cognitionReady = state.cognition.memoryState !== 'unavailable';
  const sourceContext = sourceContextOverviewStatus(state, copy);
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
      section: 'ai-config' as const,
      done: setup.requiredCapabilitiesConfigured,
      attention: !setup.requiredCapabilitiesConfigured,
      title: sectionLabels['ai-config'],
      description: setup.requiredCapabilitiesConfigured
        ? copy.capabilitiesConfiguredDescription
        : copy.capabilitiesNotConfiguredDescription,
      pill: setup.requiredCapabilitiesConfigured ? copy.configuredPill : copy.needsSetupPill,
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
        <h3 className="mb-2 mt-1 text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">{copy.checklistTitle}</h3>
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
      <Card>
        <div
          className="flex min-w-0 items-center gap-3.5 px-4 py-4"
          data-agent-center-source-context-status={state.sourceContext.status}
        >
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-[length:var(--nimi-type-body-sm-size)] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{copy.sourceContextTitle}</span>
            <span className="text-[length:var(--nimi-type-body-sm-size)] leading-[1.5] text-[var(--nimi-text-secondary)]">{sourceContext.description}</span>
          </span>
          <StatusPill label={sourceContext.label} tone={sourceContext.tone} />
        </div>
      </Card>
    </SectionShell>
  );
}

function AgentCenterAdvanced({
  copy,
  placementActions,
  state,
}: {
  readonly copy: Required<AgentCenterAdvancedCopy>;
  readonly placementActions?: AgentCenterProps['placementActions'];
  readonly state: AgentCenterState;
}) {
  const projection = state.sourceContext;
  const source = projection.source;
  const context = projection.context;
  const statusValue = {
    ready: copy.sourceContextReadyValue,
    blocked: copy.sourceContextBlockedValue,
    truncated: copy.sourceContextTruncatedValue,
    failed: copy.sourceContextFailedValue,
    unknown: copy.sourceContextUnknownValue,
  }[projection.status];
  const completeLaneCount = context?.lanes.filter((lane) => lane.state === 'included').length || 0;
  const capacityFailure = projection.status === 'blocked' && context !== null;
  const capacityText = context ? formatProjectionCopy(copy.contextCapacityFormat, {
    current: context.budget.inputBudgetTokens,
    required: context.budget.requiredInputTokens,
  }) : copy.notProjectedValue;
  const truncation = context?.truncation.reduce<{
    omittedItemCount: number;
    truncatedItemCount: number;
  }>((summary, row) => ({
    omittedItemCount: summary.omittedItemCount + row.omittedItemCount,
    truncatedItemCount: summary.truncatedItemCount + row.truncatedItemCount,
  }), { omittedItemCount: 0, truncatedItemCount: 0 });
  return (
    <SectionShell labelledBy="agent-center-advanced-title">
      <SectionHeader
        description={state.diagnostics.source === 'runtime-projection'
          ? copy.descriptionRuntimeProjection
          : copy.descriptionUnavailable}
        id="agent-center-advanced-title"
        title={copy.title}
      />
      {capacityFailure ? (
        <InlineAlert
          action={placementActions?.openMachineLoadout ? (
            <Button
              onClick={() => placementActions.openMachineLoadout?.('text.generate')}
              size="sm"
              tone="secondary"
            >
              {copy.contextCapacityAction}
            </Button>
          ) : undefined}
          tone="warning"
        >
          {capacityText}
        </InlineAlert>
      ) : null}
      <Card>
        <KvGrid>
          <Kv label={copy.lifecycleStatusLabel} value={state.cognition.lifecycleStatus || copy.notProjectedValue} />
          <Kv label={copy.executionStateLabel} value={state.cognition.executionState || copy.notProjectedValue} />
          <Kv label={copy.statusTextLabel} value={state.cognition.statusText || copy.notProjectedValue} />
          <Kv label={copy.currentEmotionLabel} value={state.cognition.currentEmotion || copy.notProjectedValue} />
          <Kv label={copy.runtimeErrorLabel} value={state.diagnostics.runtimeError || copy.noneValue} muted={!state.diagnostics.runtimeError} />
        </KvGrid>
      </Card>
      <Card>
        <KvGrid>
          <Kv label={copy.sourceContextStatusLabel} value={statusValue} />
          <Kv label={copy.sourceCapturedAtLabel} value={source?.capturedAt || copy.notProjectedValue} />
          <Kv
            label={copy.sourceCoverageLabel}
            value={source ? formatProjectionCopy(copy.sourceCoverageFormat, {
              complete: source.coverage.completeSections,
              total: source.coverage.totalSections,
            }) : copy.unavailableValue}
          />
          <Kv
            label={copy.lorebookLabel}
            value={source ? formatProjectionCopy(copy.lorebookFormat, {
              items: source.lorebookItemCount,
              tokens: source.lorebookEstimatedTokens,
            }) : copy.unavailableValue}
          />
          <Kv
            label={copy.contextLanesLabel}
            value={context ? formatProjectionCopy(copy.contextLanesFormat, {
              included: completeLaneCount,
              total: context.lanes.length,
            }) : copy.notProjectedValue}
          />
          <Kv
            label={copy.contextBudgetLabel}
            value={context ? formatProjectionCopy(copy.contextBudgetFormat, {
              used: context.budget.usedTokens,
              budget: context.budget.inputBudgetTokens,
            }) : copy.notProjectedValue}
          />
          <Kv
            label={copy.contextCapacityLabel}
            value={capacityText}
          />
          <Kv
            label={copy.contextTruncationLabel}
            value={context && truncation ? formatProjectionCopy(copy.contextTruncationFormat, {
              omitted: truncation.omittedItemCount,
              truncated: truncation.truncatedItemCount,
            }) : copy.notProjectedValue}
          />
          <Kv
            label={copy.contextInputsLabel}
            value={context ? formatProjectionCopy(copy.contextInputsFormat, {
              transcript: context.transcriptTurnCount,
              memory: context.memoryItemCount,
              media: context.mediaCount,
              tools: context.toolCount,
            }) : copy.notProjectedValue}
          />
          <Kv
            label={copy.cognitionSourceLabel}
            value={context ? formatProjectionCopy(copy.cognitionSourceFormat, {
              adapter: context.sourceAdapterStatus,
              selection: context.sourceSelectionStatus,
            }) : copy.notProjectedValue}
          />
          <Kv
            label={copy.conversationSummaryLabel}
            value={context ? formatProjectionCopy(copy.conversationSummaryFormat, {
              status: context.conversationSummaryStatus,
            }) : copy.notProjectedValue}
          />
          <Kv
            label={copy.privateRecallLabel}
            value={context ? formatProjectionCopy(copy.privateRecallFormat, {
              count: context.privateRecallCount,
            }) : copy.notProjectedValue}
          />
        </KvGrid>
      </Card>
    </SectionShell>
  );
}

function renderSection(
  section: Exclude<AgentCenterSectionId, 'overview'>,
  session: AgentCenterSession,
  snapshot: AgentCenterSnapshot,
  advancedCopy: Required<AgentCenterAdvancedCopy>,
  i18n: AgentCenterProps['i18n'],
  placementActions: AgentCenterProps['placementActions'],
) {
  switch (section) {
    case 'ai-config':
      return <AgentCenterAIConfigSection i18n={i18n} placementActions={placementActions} session={session} snapshot={snapshot} />;
    case 'behavior':
      return <AgentCenterBehaviorSection i18n={i18n} placementActions={placementActions} session={session} snapshot={snapshot} />;
    case 'cognition':
      return <AgentCenterCognitionSection i18n={i18n} placementActions={placementActions} session={session} snapshot={snapshot} />;
    case 'appearance':
      return <AgentCenterAppearanceSection i18n={i18n} placementActions={placementActions} session={session} snapshot={snapshot} />;
    case 'advanced':
      return <AgentCenterAdvanced copy={advancedCopy} placementActions={placementActions} state={snapshot.state} />;
  }
}

function agentCenterAvatarFallback(identity: AgentCenterIdentityProjection, defaultFallback: string): string {
  const explicit = identity.avatarFallback?.trim();
  if (explicit) {
    return explicit.slice(0, 2);
  }
  const displayName = identity.displayName.trim();
  return (displayName.charAt(0) || defaultFallback).toUpperCase();
}

function AgentCenterChromeActions(props: {
  readonly copy: Required<AgentCenterChromeCopy>;
  readonly actions?: AgentCenterProps['placementActions'];
}) {
  if (!props.actions?.openRuntimeSettings && !props.actions?.launchAvatar && !props.actions?.close) return null;
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-agent-center-chrome-actions="true">
      {props.actions?.openRuntimeSettings ? (
        <IconButton
          aria-label={props.copy.openRuntimeSettingsLabel}
          icon={<Settings aria-hidden="true" className="h-4 w-4" />}
          onClick={props.actions.openRuntimeSettings}
          tone="secondary"
        />
      ) : null}
      {props.actions?.launchAvatar ? (
        <IconButton
          aria-label={props.copy.launchAvatarLabel}
          icon={<PlayCircle aria-hidden="true" className="h-4 w-4" />}
          onClick={props.actions.launchAvatar}
          tone="secondary"
        />
      ) : null}
      {props.actions?.close ? (
        <IconButton
          aria-label={props.copy.closeLabel}
          className="shadow-[var(--nimi-elevation-base)]"
          icon={<X aria-hidden="true" className="h-4 w-4" />}
          onClick={props.actions.close}
          tone="secondary"
        />
      ) : null}
    </div>
  );
}

function AgentCenterChromeHeader(props: {
  readonly copy: Required<AgentCenterChromeCopy>;
  readonly identity?: AgentCenterIdentityProjection | null;
  readonly state: AgentCenterState;
  readonly actions?: AgentCenterProps['placementActions'];
}) {
  if (props.identity?.displayName.trim()) {
    const identity = props.identity;
    const fallback = agentCenterAvatarFallback(identity, props.copy.avatarFallback);
    return (
      <header className="flex min-w-0 shrink-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_35%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-lg font-semibold text-[var(--nimi-action-primary-bg)] shadow-[0_0_0_3px_var(--nimi-surface-active)]">
            {identity.avatarUrl ? (
              <img
                alt=""
                className="h-full w-full object-cover"
                src={identity.avatarUrl}
              />
            ) : fallback}
          </span>
          <div className="min-w-0 pt-1">
            <span className="mb-0.5 block text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-text-muted)]">
              {props.copy.eyebrow}
            </span>
            <h1 className="m-0 truncate text-[length:var(--nimi-type-section-title-size)] font-semibold leading-[1.25] text-[var(--nimi-text-primary)]">
              {identity.displayName}
            </h1>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {identity.badgeLabel ? (
                <em className="inline-flex max-w-full shrink-0 rounded-full border border-[var(--nimi-status-neutral-soft-border)] bg-[var(--nimi-status-neutral-soft-bg)] px-2 py-px text-[length:var(--nimi-type-overline-size)] font-semibold not-italic text-[var(--nimi-status-neutral-soft-text)]">
                  {identity.badgeLabel}
                </em>
              ) : null}
            </div>
          </div>
        </div>
        <AgentCenterChromeActions actions={props.actions} copy={props.copy} />
      </header>
    );
  }
  return (
    <header className="flex min-w-0 shrink-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-[length:var(--nimi-type-page-title-size)] font-semibold leading-[1.2] text-[var(--nimi-text-primary)]">{props.copy.title}</h1>
        <p className={cnAgentCenter(
          'm-0 mt-1.5 text-[length:var(--nimi-type-body-sm-size)] leading-[1.45]',
          props.state.statusTone === 'ready' && 'text-[var(--nimi-status-success-soft-text)]',
          props.state.statusTone === 'attention' && 'text-[var(--nimi-status-warning-soft-text)]',
          props.state.statusTone === 'failed' && 'text-[var(--nimi-status-danger-soft-text)]',
          props.state.statusTone === 'loading' && 'text-[var(--nimi-status-info-soft-text)]',
          props.state.statusTone === 'disabled' && 'text-[var(--nimi-text-muted)]',
        )}>
          {props.state.baseTextConfigured ? props.copy.textConfiguredLabel : props.state.baseTextConfigurationDetail}
        </p>
      </div>
      <AgentCenterChromeActions actions={props.actions} copy={props.copy} />
    </header>
  );
}

// @nimi-authority: definition.nimi.platform.ui-design-system.agent-center-surface
// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-001a
export function AgentCenter(props: AgentCenterProps) {
  const chromeCopy = useMemo(
    () => translateCopyRecord(props.i18n, 'AgentCenter.chrome', resolveChromeCopy()),
    [props.i18n],
  );
  const store = useAgentCenterStore(props.session);
  const state = store.snapshot.state;
  const [uncontrolledSection, setUncontrolledSection] = useState<AgentCenterSectionId>(
    props.defaultSection || 'overview',
  );
  const activeSection = props.activeSection || uncontrolledSection;
  const chrome = props.chrome || 'standalone';
  const setup = agentCenterSetupProgress(state);
  const sectionLabels = useMemo(
    () => translateCopyRecord(props.i18n, 'AgentCenter.section', resolveSectionLabels()),
    [props.i18n],
  );
  const overviewCopy = useMemo(
    () => translateCopyRecord(props.i18n, 'AgentCenter.overview', resolveOverviewCopy()),
    [props.i18n],
  );
  const progressCopy = useMemo(
    () => translateCopyRecord(props.i18n, 'AgentCenter.progress', resolveProgressCopy()),
    [props.i18n],
  );
  const advancedCopy = useMemo(
    () => translateCopyRecord(props.i18n, 'AgentCenter.advanced', resolveAdvancedCopy()),
    [props.i18n],
  );
  const setSection = (section: AgentCenterSectionId) => {
    if (!props.activeSection) {
      setUncontrolledSection(section);
    }
    props.onSectionChange?.(section);
  };
  // Roving tabindex is already in place below; this wires the keyboard half of
  // the tabs pattern (automatic activation, per WAI-ARIA tabs with a live
  // tabpanel that is cheap to swap).
  const handleTabListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const sections = state.sections;
    if (sections.length === 0) return;
    const currentIndex = sections.indexOf(activeSection);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % sections.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = currentIndex < 0 ? sections.length - 1 : (currentIndex - 1 + sections.length) % sections.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = sections.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextSection = sections[nextIndex];
    if (!nextSection) return;
    setSection(nextSection);
    event.currentTarget.querySelector<HTMLElement>(`#agent-center-tab-${nextSection}`)?.focus();
  };

  return (
    <section
      aria-label={chromeCopy.title}
      className={cnAgentCenter(
        'min-w-0 max-w-full text-[var(--nimi-text-primary)]',
        chrome === 'standalone'
          ? 'flex h-full min-h-0 flex-1 flex-col gap-4 rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-raised)]'
          : 'grid gap-3',
      )}
      data-chat-agent-center="true"
    >
      {chrome === 'standalone' ? (
        <AgentCenterChromeHeader
          copy={chromeCopy}
          actions={props.placementActions}
          identity={props.identity}
          state={state}
        />
      ) : null}
      {store.snapshot.error ? (
        <InlineAlert
          action={(
            <Button onClick={() => { void store.refresh(); }} size="sm" tone="secondary">
              {translateAgentCenter(props.i18n, 'AgentCenter.error.retry', agentCenterEnCatalog["AgentCenter.error.retry"])}
            </Button>
          )}
          data-agent-center-load-error="true"
          tone="danger"
        >
          {store.snapshot.error}
        </InlineAlert>
      ) : null}
      <nav
        aria-label={chromeCopy.navLabel}
        className="flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 pb-1 pt-2.5"
        data-agent-center-nav-style="desktop-dynamic-expand"
        onKeyDown={handleTabListKeyDown}
        role="tablist"
      >
        {state.sections.map((section) => {
          const Icon = SECTION_ICONS[section];
          const selected = section === activeSection;
          const badge = section === 'overview' && setup.remaining > 0 ? setup.remaining : null;
          return (
            <button
              aria-controls={`agent-center-panel-${section}`}
              aria-label={sectionLabels[section]}
              aria-selected={selected}
              className={cnAgentCenter(
                'group relative flex h-9 min-w-[36px] shrink-0 items-center rounded-[12px] text-[length:var(--nimi-type-caption-size)] font-medium',
                'transition-[width,background-color,color,padding] duration-[var(--nimi-motion-slow)] ease-[var(--nimi-motion-ease-emphasized)]',
                FOCUS_RING_CLASS_NAME,
                selected
                  ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-3 text-[var(--nimi-action-primary-bg)] max-[420px]:w-9 max-[420px]:justify-center max-[420px]:px-0'
                  : badge
                    ? 'w-[48px] justify-center px-0 text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]'
                    : 'w-9 justify-center px-0 text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]',
              )}
              data-testid={`chat-agent-center-section:${section}`}
              id={`agent-center-tab-${section}`}
              key={section}
              onClick={() => setSection(section)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
              <span
                className={cnAgentCenter(
                  'overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-[var(--nimi-motion-slow)] ease-[var(--nimi-motion-ease-emphasized)] max-[420px]:hidden',
                  selected ? 'ml-2 max-w-[160px] opacity-100 max-[420px]:ml-0 max-[420px]:max-w-0 max-[420px]:opacity-0' : 'ml-0 max-w-0 opacity-0',
                )}
              >
                {sectionLabels[section]}
              </span>
              {badge ? (
                <span
                  aria-hidden="true"
                  className={cnAgentCenter(
                    'pointer-events-none grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--nimi-status-danger)] px-1 text-[length:var(--nimi-type-overline-size)] font-semibold leading-none text-white shadow-sm ring-2 ring-[var(--nimi-surface-card)]',
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
      <div
        aria-labelledby={`agent-center-tab-${activeSection}`}
        className={cnAgentCenter(
          'min-w-0',
          chrome === 'standalone' && 'min-h-0 flex-1 overflow-y-auto',
        )}
        id={`agent-center-panel-${activeSection}`}
        role="tabpanel"
      >
        {store.snapshot.phase === 'loading' ? (
          <LoadingSkeleton data-agent-center-loading="true" lines={3} label={chromeCopy.loadingLabel} />
        ) : activeSection === 'overview'
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
            props.session,
            store.snapshot,
            advancedCopy,
            props.i18n,
            props.placementActions,
          )}
      </div>
    </section>
  );
}
