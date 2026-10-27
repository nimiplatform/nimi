import { useState, type AriaAttributes, type ComponentType } from 'react';
import {
  Brain,
  FileText,
  Heart,
  Leaf,
  Sparkles,
} from 'lucide-react';
import { Button, ConfirmDialog, InlineAlert, StatusBadge, TextareaField, Toggle } from '@nimiplatform/kit/ui';

import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog, getAgentCenterCatalogRecord } from '../locales/index.js';
import type {
  AgentCenterI18n,
  AgentCenterPlacementActions,
  AgentCenterSession,
  AgentCenterSnapshot,
  AgentCenterState,
} from '../types.js';
import {
  Card,
  SectionHeader,
  SectionShell,
} from './AgentCenterPrimitives.js';
import { AgentCenterConversationContext } from './AgentCenterConversationContext.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterCognitionSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
}

const LIFECYCLE_STATUS_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.cognition.lifecycle.');

const EMOTION_STATUS_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.cognition.emotion.');

const MEMORY_SOURCE_KEYS: Readonly<Record<string, keyof typeof agentCenterEnCatalog>> = {
  'Committed user message': 'AgentCenter.cognition.memory.source.message',
  'Committed user correction': 'AgentCenter.cognition.memory.source.correction',
  'Committed relationship event': 'AgentCenter.cognition.memory.source.relationship',
};

function memorySourceLabel(explanation: string, i18n?: AgentCenterI18n) {
  const key = MEMORY_SOURCE_KEYS[explanation];
  return key ? translateAgentCenter(i18n, key, agentCenterEnCatalog[key]) : explanation;
}

function localizedProjectionValue(
  value: string | null | undefined,
  defaults: Record<string, string>,
  namespace: string,
  i18n?: AgentCenterI18n,
) {
  const normalized = value?.trim();
  if (!normalized) {
    return translateAgentCenter(i18n, 'AgentCenter.cognition.value.notProjected', agentCenterEnCatalog["AgentCenter.cognition.value.notProjected"]);
  }
  const key = normalized.toLowerCase();
  if (defaults[key]) {
    return translateAgentCenter(i18n, `AgentCenter.cognition.${namespace}.${key}`, defaults[key]);
  }
  return /[\u4e00-\u9fff]/u.test(normalized)
    ? normalized
    : translateAgentCenter(i18n, 'AgentCenter.cognition.value.projected', agentCenterEnCatalog["AgentCenter.cognition.value.projected"]);
}

function memoryStateLabel(state: AgentCenterState['cognition']['memoryState'], i18n?: AgentCenterI18n) {
  switch (state) {
    case 'ready':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.ready', agentCenterEnCatalog["AgentCenter.cognition.memory.ready"]);
    case 'empty':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.empty', agentCenterEnCatalog["AgentCenter.cognition.memory.empty"]);
    case 'unconfigured':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.unconfigured', agentCenterEnCatalog['AgentCenter.cognition.memory.unconfigured']);
    case 'building':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.building', agentCenterEnCatalog['AgentCenter.cognition.memory.building']);
    case 'failed':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.failed', agentCenterEnCatalog['AgentCenter.cognition.memory.failed']);
    default:
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.unavailable', agentCenterEnCatalog["AgentCenter.cognition.memory.unavailable"]);
  }
}

export function AgentCenterCognitionSection({ session, snapshot, i18n, placementActions }: AgentCenterCognitionSectionProps) {
  const cognition = snapshot.state.cognition;
  const memory = cognition.memory;
  const availability = snapshot.availability.inspectMemory;
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [forgetMemoryId, setForgetMemoryId] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const text = (key: keyof typeof agentCenterEnCatalog, values?: Record<string, string>) =>
    translateAgentCenter(i18n, key, agentCenterEnCatalog[key], values);
  const memoryEnabled = Boolean(memory?.enabled && !memory.adoptionRequired);
  const forgetMemory = memory?.items.find((item) => item.memoryId === forgetMemoryId);
  const emptyMemoryLabel = cognition.memoryState === 'empty'
    ? text('AgentCenter.cognition.recentMemory.empty')
    : cognition.memoryState === 'unconfigured' && memory && !memory.enabled
      ? text('AgentCenter.cognition.memory.offTitle')
      : cognition.memoryState === 'ready'
        ? text('AgentCenter.cognition.memory.noVisibleItems')
        : memoryStateLabel(cognition.memoryState, i18n);
  const lifecycleLabel = localizedProjectionValue(
    cognition.lifecycleStatus,
    LIFECYCLE_STATUS_DEFAULTS,
    'lifecycle',
    i18n,
  );
  const emotionLabel = localizedProjectionValue(
    cognition.currentEmotion,
    EMOTION_STATUS_DEFAULTS,
    'emotion',
    i18n,
  );
  const memoryBankCount = memory
    ? memory.currentCount + memory.supersededCount + memory.forgottenCount
    : 0;

  return (
    <SectionShell
      className="gap-4"
      labelledBy="agent-center-cognition-title"
    >
      <div className="sr-only">
        <SectionHeader
          id="agent-center-cognition-title"
          title={translateAgentCenter(i18n, 'AgentCenter.cognition.title', agentCenterEnCatalog["AgentCenter.cognition.title"])}
        />
      </div>
      <div
        className="grid min-w-0 gap-4"
        data-agent-center-cognition-surface="memory-manager-projection"
      >
        <div data-agent-center-cognition-current="true">
          <Card className="relative border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-border-subtle))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card)),var(--nimi-surface-card)_58%,color-mix(in_srgb,var(--nimi-status-success)_7%,var(--nimi-surface-card)))] p-4 shadow-[0_10px_28px_color-mix(in_srgb,var(--nimi-action-primary-bg)_7%,transparent)]">
            <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent),transparent_70%)]" />
            <div className="relative">
              <h3 className="m-0 text-[length:var(--nimi-type-body-sm-size)] font-medium leading-[1.35] text-[var(--nimi-text-secondary)]">
                {translateAgentCenter(i18n, 'AgentCenter.cognition.current.title', agentCenterEnCatalog["AgentCenter.cognition.current.title"])}
              </h3>
              <dl className="m-0 mt-3 grid min-w-0 grid-cols-2 gap-3">
                <CognitionMetric
                  icon={Leaf}
                  label={translateAgentCenter(i18n, 'AgentCenter.cognition.lifecycle.label', agentCenterEnCatalog["AgentCenter.cognition.lifecycle.label"])}
                  tone="lifecycle"
                  value={lifecycleLabel}
                />
                <CognitionMetric
                  icon={Heart}
                  label={translateAgentCenter(i18n, 'AgentCenter.cognition.emotion.label', agentCenterEnCatalog["AgentCenter.cognition.emotion.label"])}
                  tone="emotion"
                  value={emotionLabel}
                />
              </dl>
            </div>
          </Card>
        </div>

        <AgentCenterConversationContext
          session={session}
          snapshot={snapshot}
          i18n={i18n}
          onOpenRuntimeSettings={placementActions?.openRuntimeSettings}
        />

        <div data-agent-center-cognition-memory="true">
          <Card className="p-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
                  <Brain aria-hidden="true" className="h-4 w-4" />
                </span>
                <h3 className="m-0 min-w-0 text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">
                  {translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.title', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.title"])}
                </h3>
              </div>
              {memory ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                    {text(memoryEnabled ? 'AgentCenter.cognition.memory.enabled' : 'AgentCenter.cognition.memory.disabled')}
                  </span>
                  <Toggle
                    ariaLabel={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.switchLabel', 'Use Memory')}
                    checked={memoryEnabled}
                    disabled={snapshot.availability.switchMemory.state !== 'available' || pendingAction !== null}
                    onChange={(enabled) => {
                      setPendingAction('switch');
                      setActionError(null);
                      void session.setMemoryEnabled(enabled).catch((error: unknown) => {
                        setActionError(error instanceof Error ? error.message : String(error));
                      }).finally(() => setPendingAction(null));
                    }}
                  />
                </div>
              ) : null}
            </div>
            <p className="m-0 mt-3 text-[length:var(--nimi-type-caption-size)] leading-[1.55] text-[var(--nimi-text-secondary)]">
              {text('AgentCenter.cognition.memory.privateDescription')}
            </p>
            {availability.state === 'unavailable' ? (
              <div className="mt-3">
                <AgentCenterProductActionNotice
                  action="inspectMemory"
                  availability={availability}
                  i18n={i18n}
                  onOpenRuntimeSettings={placementActions?.openRuntimeSettings}
                  session={session}
                />
              </div>
            ) : null}
            {memory?.adoptionRequired ? (
              <InlineAlert className="mt-3" tone="info">
                {translateAgentCenter(i18n, 'AgentCenter.cognition.memory.adoptionRequired', 'This existing Agent will not remember anything until you explicitly enable Memory.')}
              </InlineAlert>
            ) : null}
            {actionError ? <InlineAlert className="mt-3" tone="danger">{actionError}</InlineAlert> : null}
            {loadMoreError ? (
              <InlineAlert className="mt-3" tone="danger">
                {translateAgentCenter(i18n, 'AgentCenter.cognition.memory.loadMoreFailed', 'Could not load more Memory.')}{' '}{loadMoreError}
              </InlineAlert>
            ) : null}
            {memory && memory.items.length > 0 && ['building', 'failed', 'unavailable'].includes(cognition.memoryState) ? (
              <InlineAlert className="mt-3" tone={cognition.memoryState === 'building' ? 'info' : 'warning'}>
                {memoryStateLabel(cognition.memoryState, i18n)}
              </InlineAlert>
            ) : null}
            {memory && memory.currentCount > 0 ? (
              <p className="m-0 mt-3 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                {text('AgentCenter.cognition.memory.currentCount', { count: String(memory.currentCount) })}
              </p>
            ) : null}
            <div
              className="mt-3 grid min-w-0 gap-2.5"
              role={memory?.items.length ? 'list' : undefined}
              aria-label={memory?.items.length ? text('AgentCenter.cognition.recentMemory.ariaLabel') : undefined}
            >
              {memory && memory.items.length > 0 ? memory.items.map((item) => (
                <div
                  className="grid min-w-0 gap-2.5 rounded-[var(--nimi-radius-lg)] border border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] bg-[var(--nimi-surface-panel)] p-4"
                  data-agent-center-memory-id={item.memoryId}
                  key={item.memoryId}
                  role="listitem"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge tone={item.lifecycle === 'current' ? 'success' : item.lifecycle === 'conflicted' ? 'warning' : 'neutral'}>{text(`AgentCenter.cognition.memory.lifecycle.${item.lifecycle}`)}</StatusBadge>
                      <StatusBadge tone="neutral">{text(`AgentCenter.cognition.memory.epistemic.${item.epistemicStatus}`)}</StatusBadge>
                    </div>
                    <time className="shrink-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(i18n?.language)}</time>
                  </div>
                  <p className="m-0 whitespace-pre-wrap break-words text-[length:var(--nimi-type-body-sm-size)] leading-[1.55] text-[var(--nimi-text-primary)]">{item.content}</p>
                  <p className="m-0 break-words text-[length:var(--nimi-type-caption-size)] leading-[1.4] text-[var(--nimi-text-muted)]">{memorySourceLabel(item.sourceExplanation, i18n)}</p>
                  {editingMemoryId === item.memoryId ? (
                    <div className="grid gap-2">
                      <TextareaField aria-label={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.correctionLabel', 'Correct Memory')} onChange={(event) => setCorrection(event.currentTarget.value)} value={correction} />
                      {correctionError ? <InlineAlert tone="danger">{correctionError}</InlineAlert> : null}
                      <div className="flex justify-end gap-2">
                        <Button disabled={pendingAction !== null} onClick={() => { setEditingMemoryId(null); setCorrection(''); setCorrectionError(null); }} size="sm" tone="ghost">{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.cancel', 'Cancel')}</Button>
                        <Button
                          disabled={!correction.trim() || pendingAction !== null}
                          loading={pendingAction === `correct:${item.memoryId}`}
                          onClick={() => {
                            setPendingAction(`correct:${item.memoryId}`);
                            setCorrectionError(null);
                            void session.correctMemory({ memoryId: item.memoryId, correctedContent: correction.trim() }).then((result) => {
                              if (result.outcome === 'rejected') {
                                setCorrectionError(translateAgentCenter(i18n, 'AgentCenter.cognition.memory.correctionRejected', agentCenterEnCatalog['AgentCenter.cognition.memory.correctionRejected']));
                                return;
                              }
                              setEditingMemoryId(null); setCorrection('');
                            }).catch((error: unknown) => setCorrectionError(error instanceof Error ? error.message : String(error))).finally(() => setPendingAction(null));
                          }}
                          size="sm"
                          tone="primary"
                        >{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.saveCorrection', 'Save correction')}</Button>
                      </div>
                    </div>
                  ) : item.lifecycle === 'current' ? (
                    <div className="flex justify-end gap-2">
                      <Button disabled={snapshot.availability.correctMemory.state !== 'available' || pendingAction !== null} onClick={() => { setEditingMemoryId(item.memoryId); setCorrection(item.content); setCorrectionError(null); }} size="sm" tone="secondary">{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.correct', 'Correct')}</Button>
                      <Button disabled={snapshot.availability.forgetMemory.state !== 'available' || pendingAction !== null} onClick={() => { setDialogError(null); setForgetMemoryId(item.memoryId); }} size="sm" tone="danger">{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forget', 'Forget')}</Button>
                    </div>
                  ) : null}
                </div>
              )) : (
                <div className="relative flex min-w-0 flex-col items-center overflow-hidden rounded-[var(--nimi-radius-lg)] border border-dashed border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,var(--nimi-border-subtle))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,var(--nimi-surface-panel)),var(--nimi-surface-panel))] px-4 py-6 text-center">
                  <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-[var(--nimi-radius-lg)] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-border-subtle))] bg-[var(--nimi-surface-card)] text-[var(--nimi-action-primary-bg)] shadow-[0_6px_16px_color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]">
                    <FileText aria-hidden="true" className="h-5 w-5" />
                    <Sparkles aria-hidden="true" className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-[var(--nimi-surface-card)]" />
                  </span>
                  <div className="mt-3 min-w-0 text-[length:var(--nimi-type-body-size)] font-semibold leading-[1.4] text-[var(--nimi-text-primary)]">
                    {emptyMemoryLabel}
                  </div>
                  {cognition.memoryState === 'empty' ? (
                    <p className="m-0 mt-1.5 max-w-[36ch] text-[length:var(--nimi-type-caption-size)] leading-[1.55] text-[var(--nimi-text-secondary)]">{text('AgentCenter.cognition.memory.emptyHelp')}</p>
                  ) : null}
                </div>
              )}
            </div>
            {memory && (memory.nextPageToken || memoryBankCount > 0) ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nimi-border-subtle)] pt-3">
                {memory.nextPageToken ? (
                  <Button
                    data-agent-center-memory-load-more="true"
                    disabled={snapshot.availability.inspectMemory.state !== 'available' || pendingAction !== null}
                    loading={pendingAction === 'load-more'}
                    onClick={() => {
                      setPendingAction('load-more');
                      setLoadMoreError(null);
                      void session.loadMoreMemory().catch((error: unknown) => {
                        setLoadMoreError(error instanceof Error ? error.message : String(error));
                      }).finally(() => setPendingAction(null));
                    }}
                    size="sm"
                    tone="secondary"
                  >
                    {pendingAction === 'load-more'
                      ? translateAgentCenter(i18n, 'AgentCenter.cognition.memory.loadingMore', 'Loading more…')
                      : translateAgentCenter(i18n, 'AgentCenter.cognition.memory.loadMore', 'Load more')}
                  </Button>
                ) : <span />}
                {memoryBankCount > 0 ? <Button disabled={snapshot.availability.deleteAllMemory.state !== 'available' || pendingAction !== null} onClick={() => { setDialogError(null); setDeleteAllOpen(true); }} size="sm" tone="danger">
                  {translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAll', 'Delete all Memory')}
                </Button> : null}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        cancelLabel={text('AgentCenter.cognition.memory.cancel')}
        confirmLabel={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forgetConfirm', 'Forget')}
        loading={pendingAction === 'forget'}
        message={<div className="grid min-w-0 gap-3">
          <p className="m-0">{text('AgentCenter.cognition.memory.forgetWarning')}</p>
          {forgetMemory ? <blockquote className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] p-3 text-[length:var(--nimi-type-body-sm-size)]">{forgetMemory.content}</blockquote> : null}
          {dialogError ? <InlineAlert tone="danger">{dialogError}</InlineAlert> : null}
        </div>}
        onClose={() => { setForgetMemoryId(null); setDialogError(null); }}
        onConfirm={() => {
          if (!forgetMemoryId) return;
          setPendingAction('forget'); setDialogError(null);
          void session.forgetMemory({ memoryIds: [forgetMemoryId], confirmed: true }).then(() => setForgetMemoryId(null)).catch((error: unknown) => setDialogError(error instanceof Error ? error.message : String(error))).finally(() => setPendingAction(null));
        }}
        open={forgetMemoryId !== null}
        title={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forgetTitle', 'Forget this Memory?')}
      />
      <ConfirmDialog
        cancelLabel={text('AgentCenter.cognition.memory.cancel')}
        confirmLabel={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAllConfirm', 'Delete all')}
        loading={pendingAction === 'delete-all'}
        message={<div className="grid gap-3">
          <p className="m-0">{text('AgentCenter.cognition.memory.deleteAllWarning')}</p>
          {dialogError ? <InlineAlert tone="danger">{dialogError}</InlineAlert> : null}
        </div>}
        onClose={() => { setDeleteAllOpen(false); setDialogError(null); }}
        onConfirm={() => {
          setPendingAction('delete-all'); setDialogError(null);
          void session.deleteAllMemory({ confirmed: true }).then(() => setDeleteAllOpen(false)).catch((error: unknown) => setDialogError(error instanceof Error ? error.message : String(error))).finally(() => setPendingAction(null));
        }}
        open={deleteAllOpen}
        title={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAllTitle', 'Delete all Memory?')}
      />
    </SectionShell>
  );
}

function CognitionMetric(props: {
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: AriaAttributes['aria-hidden'] }>;
  readonly label: string;
  readonly tone: 'lifecycle' | 'emotion';
  readonly value: string;
}) {
  const Icon = props.icon;
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-[var(--nimi-radius-md)] border border-[color-mix(in_srgb,var(--nimi-surface-card)_76%,transparent)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_76%,transparent)] p-3 shadow-[0_2px_8px_color-mix(in_srgb,var(--nimi-text-primary)_4%,transparent)]">
      <span className={`row-span-2 grid h-9 w-9 place-items-center rounded-full ${props.tone === 'lifecycle' ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]' : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]'}`}>
        <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
      </span>
      <dt className="min-w-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
        {props.label}
      </dt>
      <dd className="m-0 min-w-0 break-words text-[length:var(--nimi-type-section-title-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">{props.value}</dd>
    </div>
  );
}
