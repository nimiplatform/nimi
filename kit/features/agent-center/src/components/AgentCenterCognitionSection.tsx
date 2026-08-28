import { useState, type AriaAttributes, type ComponentType } from 'react';
import {
  Cloud,
  Database,
  FileText,
  Heart,
  Leaf,
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
  cnAgentCenter,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterCognitionSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
}

const LIFECYCLE_STATUS_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.cognition.lifecycle.');

const EMOTION_STATUS_DEFAULTS = getAgentCenterCatalogRecord('AgentCenter.cognition.emotion.');

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
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.unconfigured', 'Enable Memory to begin.');
    case 'building':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.building', 'Building');
    case 'failed':
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.failed', 'Failed');
    default:
      return translateAgentCenter(i18n, 'AgentCenter.cognition.memory.unavailable', agentCenterEnCatalog["AgentCenter.cognition.memory.unavailable"]);
  }
}

function hasCognitionProjection(cognition: AgentCenterState['cognition']) {
  return Boolean(
    cognition.lifecycleStatus
      || cognition.currentEmotion
      || cognition.statusText
      || cognition.recentCanonicalMemoryCount > 0
      || cognition.memoryState === 'ready'
      || cognition.memoryState === 'empty',
  );
}

export function AgentCenterCognitionSection({ session, snapshot, i18n, placementActions }: AgentCenterCognitionSectionProps) {
  const cognition = snapshot.state.cognition;
  const memory = cognition.memory;
  const availability = snapshot.availability.inspectMemory;
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [correction, setCorrection] = useState('');
  const [forgetMemoryId, setForgetMemoryId] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasProjection = hasCognitionProjection(cognition);
  const memoryLabel = memoryStateLabel(cognition.memoryState, i18n);
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

  return (
    <SectionShell
      className="gap-3"
      labelledBy="agent-center-cognition-title"
    >
      <SectionHeader
        description={translateAgentCenter(i18n, 'AgentCenter.cognition.description', agentCenterEnCatalog["AgentCenter.cognition.description"])}
        id="agent-center-cognition-title"
        title={translateAgentCenter(i18n, 'AgentCenter.cognition.title', agentCenterEnCatalog["AgentCenter.cognition.title"])}
      />
      {availability.state === 'unavailable' ? (
        <AgentCenterProductActionNotice
          action="inspectMemory"
          availability={availability}
          i18n={i18n}
          onOpenRuntimeSettings={placementActions?.openRuntimeSettings}
          session={session}
        />
      ) : null}
      <div
        className="grid min-w-0 gap-3"
        data-agent-center-cognition-surface="memory-manager-projection"
      >
        <div data-agent-center-cognition-current="true">
          <Card className="p-4">
            <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">
              {translateAgentCenter(i18n, 'AgentCenter.cognition.current.title', agentCenterEnCatalog["AgentCenter.cognition.current.title"])}
            </h3>
            <div className="mt-4 grid min-w-0 justify-items-center text-center">
              <div className="relative grid h-[82px] w-[140px] place-items-center text-[var(--nimi-text-muted)]">
                <Cloud aria-hidden="true" className="h-11 w-11 opacity-80" strokeWidth={1.8} />
                <span aria-hidden="true" className="absolute left-7 top-4 h-2 w-2 rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_75%,transparent)]" />
                <span aria-hidden="true" className="absolute right-7 top-10 h-2.5 w-2.5 rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_75%,transparent)]" />
                <span aria-hidden="true" className="absolute left-12 top-1 text-[length:var(--nimi-type-page-title-size)] leading-none text-[color-mix(in_srgb,var(--nimi-text-muted)_70%,transparent)]">*</span>
              </div>
              <strong className="text-[length:var(--nimi-type-section-title-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">
                {hasProjection
                  ? translateAgentCenter(i18n, 'AgentCenter.cognition.current.available', agentCenterEnCatalog["AgentCenter.cognition.current.available"])
                  : translateAgentCenter(i18n, 'AgentCenter.cognition.current.empty', agentCenterEnCatalog["AgentCenter.cognition.current.empty"])}
              </strong>
            </div>
            <div className="mt-5 grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-3">
              <CognitionMetric
                icon={Leaf}
                label={translateAgentCenter(i18n, 'AgentCenter.cognition.lifecycle.label', agentCenterEnCatalog["AgentCenter.cognition.lifecycle.label"])}
                tone="emerald"
                value={lifecycleLabel}
              />
              <CognitionMetric
                icon={Heart}
                label={translateAgentCenter(i18n, 'AgentCenter.cognition.emotion.label', agentCenterEnCatalog["AgentCenter.cognition.emotion.label"])}
                tone="rose"
                value={emotionLabel}
              />
              <CognitionMetric
                icon={Database}
                label={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.label', agentCenterEnCatalog["AgentCenter.cognition.memory.label"])}
                tone="violet"
                value={memoryLabel}
              />
            </div>
          </Card>
        </div>

        <div data-agent-center-cognition-memory="true">
          <Card className="p-4">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">
                  {translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.title', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.title"])}
                </h3>
                {memory ? (
                  <p className="m-0 mt-1 text-[length:var(--nimi-type-caption-size)] leading-[1.4] text-[var(--nimi-text-muted)]">
                    {translateAgentCenter(i18n, 'AgentCenter.cognition.memory.privateDescription', 'Private to this Agent. Memory never changes the original Conversation or Realm source.')}
                  </p>
                ) : null}
              </div>
              {memory ? (
                <div className="grid shrink-0 justify-items-end gap-1.5">
                  <Toggle
                    ariaLabel={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.switchLabel', 'Use Memory')}
                    checked={memory.enabled && !memory.adoptionRequired}
                    disabled={snapshot.availability.switchMemory.state !== 'available' || pendingAction !== null}
                    onChange={(enabled) => {
                      setPendingAction('switch');
                      setActionError(null);
                      void session.setMemoryEnabled(enabled).catch((error: unknown) => {
                        setActionError(error instanceof Error ? error.message : String(error));
                      }).finally(() => setPendingAction(null));
                    }}
                  />
                  <StatusBadge tone={memory.enabled && !memory.adoptionRequired ? 'success' : 'neutral'}>
                    {memory.enabled && !memory.adoptionRequired
                      ? translateAgentCenter(i18n, 'AgentCenter.cognition.memory.enabled', 'Enabled')
                      : translateAgentCenter(i18n, 'AgentCenter.cognition.memory.disabled', 'Off')}
                  </StatusBadge>
                </div>
              ) : null}
            </div>
            {memory?.adoptionRequired ? (
              <InlineAlert className="mt-3" tone="info">
                {translateAgentCenter(i18n, 'AgentCenter.cognition.memory.adoptionRequired', 'This existing Agent will not remember anything until you explicitly enable Memory.')}
              </InlineAlert>
            ) : null}
            {actionError ? <InlineAlert className="mt-3" tone="danger">{actionError}</InlineAlert> : null}
            <div
              className="mt-4 grid min-w-0 gap-2.5"
              role="list"
              aria-label={translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.ariaLabel', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.ariaLabel"])}
            >
              {memory && memory.items.length > 0 ? memory.items.map((item) => (
                <div
                  className="grid min-w-0 gap-2 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3.5"
                  data-agent-center-memory-id={item.memoryId}
                  key={item.memoryId}
                  role="listitem"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusBadge tone={item.lifecycle === 'current' ? 'success' : 'neutral'}>{item.lifecycle}</StatusBadge>
                      <StatusBadge tone="info">{item.epistemicStatus}</StatusBadge>
                    </div>
                    <time className="shrink-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString()}</time>
                  </div>
                  <p className="m-0 whitespace-pre-wrap text-[length:var(--nimi-type-body-sm-size)] leading-[1.55] text-[var(--nimi-text-primary)]">{item.content}</p>
                  <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-[1.4] text-[var(--nimi-text-muted)]">{item.sourceExplanation}</p>
                  {editingMemoryId === item.memoryId ? (
                    <div className="grid gap-2">
                      <TextareaField aria-label={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.correctionLabel', 'Correct Memory')} onChange={(event) => setCorrection(event.currentTarget.value)} value={correction} />
                      <div className="flex justify-end gap-2">
                        <Button onClick={() => { setEditingMemoryId(null); setCorrection(''); }} size="sm" tone="ghost">{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.cancel', 'Cancel')}</Button>
                        <Button
                          disabled={!correction.trim() || pendingAction !== null}
                          loading={pendingAction === `correct:${item.memoryId}`}
                          onClick={() => {
                            setPendingAction(`correct:${item.memoryId}`);
                            setActionError(null);
                            void session.correctMemory({ memoryId: item.memoryId, correctedContent: correction.trim() }).then(() => {
                              setEditingMemoryId(null); setCorrection('');
                            }).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))).finally(() => setPendingAction(null));
                          }}
                          size="sm"
                          tone="primary"
                        >{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.saveCorrection', 'Save correction')}</Button>
                      </div>
                    </div>
                  ) : item.lifecycle === 'current' ? (
                    <div className="flex justify-end gap-2">
                      <Button disabled={snapshot.availability.correctMemory.state !== 'available' || pendingAction !== null} onClick={() => { setEditingMemoryId(item.memoryId); setCorrection(item.content); }} size="sm" tone="secondary">{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.correct', 'Correct')}</Button>
                      <Button disabled={snapshot.availability.forgetMemory.state !== 'available' || pendingAction !== null} onClick={() => setForgetMemoryId(item.memoryId)} size="sm" tone="danger">{translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forget', 'Forget')}</Button>
                    </div>
                  ) : null}
                </div>
              )) : (
                <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3.5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]">
                    <FileText aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[length:var(--nimi-type-body-size)] font-semibold leading-[1.4] text-[var(--nimi-text-primary)]">
                      {translateAgentCenter(i18n, 'AgentCenter.cognition.recentMemory.empty', agentCenterEnCatalog["AgentCenter.cognition.recentMemory.empty"])}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {memory ? (
              <div className="mt-3 flex justify-end border-t border-[var(--nimi-border-subtle)] pt-3">
                <Button disabled={snapshot.availability.deleteAllMemory.state !== 'available' || pendingAction !== null || memory.items.length === 0} onClick={() => setDeleteAllOpen(true)} size="sm" tone="danger">
                  {translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAll', 'Delete all Memory')}
                </Button>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        confirmLabel={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forgetConfirm', 'Forget')}
        loading={pendingAction === 'forget'}
        message={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forgetWarning', 'This Memory will stop being recalled and cannot be restored.')}
        onClose={() => setForgetMemoryId(null)}
        onConfirm={() => {
          if (!forgetMemoryId) return;
          setPendingAction('forget'); setActionError(null);
          void session.forgetMemory({ memoryIds: [forgetMemoryId], confirmed: true }).then(() => setForgetMemoryId(null)).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))).finally(() => setPendingAction(null));
        }}
        open={forgetMemoryId !== null}
        title={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.forgetTitle', 'Forget this Memory?')}
      />
      <ConfirmDialog
        confirmLabel={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAllConfirm', 'Delete all')}
        loading={pendingAction === 'delete-all'}
        message={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAllWarning', 'All Memory for this Agent will be permanently deleted. Original Conversations and Realm source stay unchanged.')}
        onClose={() => setDeleteAllOpen(false)}
        onConfirm={() => {
          setPendingAction('delete-all'); setActionError(null);
          void session.deleteAllMemory({ confirmed: true }).then(() => setDeleteAllOpen(false)).catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))).finally(() => setPendingAction(null));
        }}
        open={deleteAllOpen}
        title={translateAgentCenter(i18n, 'AgentCenter.cognition.memory.deleteAllTitle', 'Delete all Memory?')}
      />
    </SectionShell>
  );
}

type CognitionMetricTone = 'emerald' | 'rose' | 'violet';

const COGNITION_METRIC_TONE_CLASS: Record<CognitionMetricTone, string> = {
  emerald: 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]',
  rose: 'bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]',
  violet: 'bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]',
};

function CognitionMetric(props: {
  readonly icon: ComponentType<{ className?: string; 'aria-hidden'?: AriaAttributes['aria-hidden'] }>;
  readonly label: string;
  readonly value: string;
  readonly tone: CognitionMetricTone;
}) {
  const Icon = props.icon;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-3">
      <span className={cnAgentCenter(
        'grid h-9 w-9 shrink-0 place-items-center rounded-[12px]',
        COGNITION_METRIC_TONE_CLASS[props.tone],
      )}>
        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="min-w-0 truncate text-[length:var(--nimi-type-caption-size)] font-semibold leading-[1.35] text-[var(--nimi-text-muted)]">{props.label}</span>
        <strong className="min-w-0 truncate text-[length:var(--nimi-type-body-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">{props.value}</strong>
      </span>
    </div>
  );
}
