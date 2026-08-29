import { Box, CheckCircle2, FolderOpen, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  InlineAlert,
  SelectField,
  Toggle,
  type FeedbackTone,
} from '@nimiplatform/kit/ui';
import { isAgentCenterCommittedAppearanceReady } from '../appearance-render-readiness.js';
import { translateAgentCenter } from '../i18n.js';
import { agentCenterEnCatalog, getAgentCenterCatalogRecord } from '../locales/index.js';
import type {
  AgentCenterI18n,
  AgentCenterPlacementActions,
  AgentCenterSession,
  AgentCenterSnapshot,
} from '../types.js';
import {
  Card,
  SectionHeader,
  SectionShell,
} from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterAppearanceSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly i18n?: AgentCenterI18n;
  readonly placementActions?: AgentCenterPlacementActions;
}

type PendingKind = 'live2d' | 'vrm' | 'background' | null;
type OperationState =
  | { readonly state: 'idle'; readonly message: '' }
  | { readonly state: 'saving' | 'saved' | 'render-failed' | 'restoring' | 'restored'; readonly message: string }
  | { readonly state: 'validation-failed'; readonly message: string; readonly reasonCode: string };

const OPERATION_NOTICE_TONE: Record<OperationState['state'], FeedbackTone> = {
  idle: 'neutral',
  saving: 'info',
  saved: 'success',
  'render-failed': 'warning',
  restoring: 'info',
  restored: 'success',
  'validation-failed': 'danger',
};

type AutoSaveCatalogKey = Extract<
  keyof typeof agentCenterEnCatalog,
  `AgentCenter.appearance.autoSave.${string}`
>;
type StripAutoSavePrefix<T extends string> = T extends `AgentCenter.appearance.autoSave.${infer Key}`
  ? Key
  : never;
type AutoSaveCopy = Readonly<Record<StripAutoSavePrefix<AutoSaveCatalogKey>, string>>;

const AUTOSAVE_COPY_DEFAULTS = getAgentCenterCatalogRecord(
  'AgentCenter.appearance.autoSave.',
) as AutoSaveCopy;

function message(error: unknown): { message: string; reasonCode: string } {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      message: typeof record.message === 'string' && record.message.trim() ? record.message : String(error),
      reasonCode: typeof record.reasonCode === 'string' && record.reasonCode.trim()
        ? record.reasonCode
        : typeof record.category === 'string' && record.category.trim()
          ? record.category
          : 'appearance-save-failed',
    };
  }
  return { message: error instanceof Error ? error.message : String(error), reasonCode: 'appearance-save-failed' };
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-008
function AgentCenterResourcePackCard({
  session,
  snapshot,
  i18n,
}: AgentCenterAppearanceSectionProps) {
  const appearance = snapshot.state.appearance;
  const selection = appearance.resourcePackSelection ?? null;
  const target = appearance.resourcePackTarget ?? null;
  const placementAvailability = appearance.resourcePackPlacementAvailability;
  const actionAvailable = snapshot.availability.replaceAppearance.state === 'available';
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => {
    try {
      session.appearance.cancelResourcePackPreview?.();
    } catch {
      // Session invalidation already destroyed the review.
    }
  }, [session]);
  const copy = useMemo(() => ({
    active: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.active', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.active']),
    apply: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.apply', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.apply']),
    applyPending: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.applyPending', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.applyPending']),
    applyOutcomeUnknown: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.applyOutcomeUnknown', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.applyOutcomeUnknown']),
    cancel: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.cancel', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.cancel']),
    clear: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.clear', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.clear']),
    clearOutcomeUnknown: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.clearOutcomeUnknown', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.clearOutcomeUnknown']),
    description: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.description', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.description']),
    empty: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.empty', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.empty']),
    fallback: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.fallback', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.fallback']),
    preview: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.preview', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.preview']),
    renderPending: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.renderPending', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.renderPending']),
    replaceInZhiyu: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.replaceInZhiyu', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.replaceInZhiyu']),
    placementNeedsConversation: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.placementNeedsConversation', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.placementNeedsConversation']),
    placementUnavailable: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.placementUnavailable', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.placementUnavailable']),
    retry: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.retry', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.retry']),
    select: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.select', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.select']),
    selected: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.selected', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.selected']),
    target: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.target', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.target']),
    title: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.title', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.title']),
  }), [i18n]);
  const mutationPending = appearance.resourcePackMutationPending
    ?? (target?.pendingTruth === 'apply-outcome-unknown'
      ? 'apply'
      : target?.pendingTruth === 'clear-outcome-unknown' ? 'clear' : null);
  const busy = pending || Boolean(mutationPending)
    || target?.phase === 'apply-in-flight' || target?.phase === 'render-pending';
  const run = async (task: () => Promise<void>) => {
    setPending(true);
    setLocalError(null);
    try {
      await task();
    } catch (error) {
      setLocalError(message(error).message);
    } finally {
      setPending(false);
    }
  };
  const status = mutationPending === 'apply'
    ? copy.applyOutcomeUnknown
    : mutationPending === 'clear'
      ? copy.clearOutcomeUnknown
      : target?.phase === 'preview'
    ? copy.preview
    : target?.phase === 'apply-in-flight'
      ? copy.applyPending
      : target?.phase === 'render-pending'
        ? copy.renderPending
        : target?.phase === 'fallback'
          ? copy.fallback
          : target?.phase === 'selected'
            ? copy.active
            : selection ? copy.selected : copy.empty;

  return (
    <Card
      className="grid gap-3 border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]"
    >
      <div
        className="contents"
        data-agent-center-resource-pack-card="true"
        data-agent-center-resource-pack-phase={target?.phase ?? 'default'}
        data-agent-center-resource-pack-selected={selection?.assetRef ?? ''}
      >
      <div className="grid gap-1">
        <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{copy.title}</h3>
        <p className="m-0 text-[length:var(--nimi-type-overline-size)] leading-5 text-[var(--nimi-text-muted)]">{copy.description}</p>
        <span className="text-[length:var(--nimi-type-overline-size)] font-medium text-[var(--nimi-text-secondary)]">{copy.target}</span>
      </div>
      <div
        ref={statusRef}
        className="grid gap-1 rounded-[12px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-subtle)] p-3"
        role="status"
        aria-live="polite"
        tabIndex={-1}
      >
        <span className="text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-primary)]">{status}</span>
        {selection ? (
          <span className="truncate font-mono text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]" title={selection.assetRef}>
            {selection.assetRef}
          </span>
        ) : null}
        {target?.reviewFileName ? (
          <span className="truncate text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{target.reviewFileName}</span>
        ) : null}
        <span data-agent-center-resource-pack-pending-truth={target?.pendingTruth ?? ''} />
      </div>
      <div className="flex flex-wrap gap-2">
        {session.appearance.selectResourcePack ? (
          <Button
            data-agent-center-resource-pack-action="select"
            disabled={!actionAvailable || busy}
            leadingIcon={<FolderOpen aria-hidden="true" className="h-4 w-4" />}
            onClick={() => { void run(() => session.appearance.selectResourcePack!()); }}
            size="sm"
            tone="secondary"
          >
            {copy.select}
          </Button>
        ) : (
          <Button
            data-agent-center-resource-pack-action="place"
            disabled={!actionAvailable || busy
              || placementAvailability?.state !== 'available'
              || !session.appearance.openResourcePackInZhiyu}
            onClick={() => {
              if (session.appearance.openResourcePackInZhiyu) {
                void run(() => session.appearance.openResourcePackInZhiyu!());
              }
            }}
            size="sm"
            tone="secondary"
          >
            {copy.replaceInZhiyu}
          </Button>
        )}
        {target?.phase === 'preview' && session.appearance.applyResourcePack ? (
          <Button
            data-agent-center-resource-pack-action="apply"
            disabled={!actionAvailable || busy}
            onClick={() => {
              void run(async () => {
                await session.appearance.applyResourcePack!();
                statusRef.current?.focus();
              });
            }}
            size="sm"
            tone="primary"
          >
            {copy.apply}
          </Button>
        ) : null}
        {target?.phase === 'preview' && session.appearance.cancelResourcePackPreview ? (
          <Button
            data-agent-center-resource-pack-action="cancel"
            disabled={busy}
            onClick={() => {
              session.appearance.cancelResourcePackPreview?.();
              statusRef.current?.focus();
            }}
            size="sm"
            tone="secondary"
          >
            {copy.cancel}
          </Button>
        ) : null}
        {selection ? (
          <Button
            data-agent-center-resource-pack-action="clear"
            disabled={!actionAvailable || busy}
            onClick={() => {
              void run(async () => {
                await session.appearance.clearResourcePack();
                statusRef.current?.focus();
              });
            }}
            size="sm"
            tone="secondary"
          >
            {copy.clear}
          </Button>
        ) : null}
        {selection && target?.phase === 'fallback' && session.appearance.retryResourcePack ? (
          <Button
            data-agent-center-resource-pack-action="retry"
            disabled={!actionAvailable || busy}
            onClick={() => { void run(() => session.appearance.retryResourcePack!()); }}
            size="sm"
            tone="secondary"
          >
            {copy.retry}
          </Button>
        ) : null}
      </div>
      {!session.appearance.selectResourcePack && placementAvailability?.state === 'unavailable' ? (
        <span
          className="text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]"
          data-agent-center-resource-pack-placement-unavailable={placementAvailability.reasonCode}
        >
          {placementAvailability.reasonCode === 'selection-required'
            ? copy.placementNeedsConversation
            : copy.placementUnavailable}
        </span>
      ) : null}
      {target?.mismatchReason || target?.error || localError ? (
        <InlineAlert tone="warning">{target?.mismatchReason || target?.error || localError}</InlineAlert>
      ) : null}
      </div>
    </Card>
  );
}

export function AgentCenterAppearanceSection({ session, snapshot, i18n, placementActions }: AgentCenterAppearanceSectionProps) {
  const appearance = snapshot.state.appearance;
  const availability = snapshot.availability.replaceAppearance;
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [operation, setOperation] = useState<OperationState>({ state: 'idle', message: '' });
  const copy = useMemo(() => Object.fromEntries(
    Object.entries(AUTOSAVE_COPY_DEFAULTS).map(([key, fallback]) => [
      key,
      translateAgentCenter(i18n, `AgentCenter.appearance.autoSave.${key}`, fallback),
    ]),
  ) as AutoSaveCopy, [i18n]);
  const voiceCopy = useMemo(() => ({
    defaultVoiceTitle: translateAgentCenter(i18n, 'AgentCenter.appearance.defaultVoiceTitle', agentCenterEnCatalog['AgentCenter.appearance.defaultVoiceTitle']),
    defaultVoiceDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.defaultVoiceDescription',
      agentCenterEnCatalog['AgentCenter.appearance.defaultVoiceDescription'],
    ),
    defaultVoiceUnset: translateAgentCenter(i18n, 'AgentCenter.appearance.defaultVoiceUnset', agentCenterEnCatalog['AgentCenter.appearance.defaultVoiceUnset']),
    avatarAutoplayLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.avatarAutoplayLabel', agentCenterEnCatalog['AgentCenter.appearance.avatarAutoplayLabel']),
    avatarAutoplayDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.avatarAutoplayDescription',
      agentCenterEnCatalog['AgentCenter.appearance.avatarAutoplayDescription'],
    ),
    catalogLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogLabel', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogLabel']),
    catalogDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.voiceCatalogDescription',
      agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogDescription'],
    ),
    catalogUnavailable: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogUnavailable', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogUnavailable']),
    catalogEmpty: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogEmpty', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogEmpty']),
    catalogTruncated: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogTruncated', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogTruncated']),
    retryLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.retryLabel', agentCenterEnCatalog['AgentCenter.appearance.retryLabel']),
    revisionLabel: (revision: string) => translateAgentCenter(
      i18n,
      'AgentCenter.appearance.revisionLabel',
      agentCenterEnCatalog['AgentCenter.appearance.revisionLabel'],
      { revision },
    ),
    voiceKindPreset: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceKindPreset', agentCenterEnCatalog['AgentCenter.appearance.voiceKindPreset']),
    voiceKindAsset: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceKindAsset', agentCenterEnCatalog['AgentCenter.appearance.voiceKindAsset']),
  }), [i18n]);
  const actionAvailable = availability.state === 'available';
  const canReplace = actionAvailable && Boolean(session.appearance.replaceAvatar);
  const canImportBackground = actionAvailable && Boolean(session.appearance.importBackground);
  const canRestore = snapshot.availability.restorePreviousAppearance.state === 'available'
    && Boolean(appearance.previousSelection);
  const hasDefaultVoice = Boolean(appearance.defaultVoiceReference?.trim());
  const voiceCatalog = appearance.voiceCatalog;
  const voiceOptions = voiceCatalog?.state === 'ready' ? voiceCatalog.options : [];
  const canSetDefaultVoice = actionAvailable
    && Boolean(session.appearance.setDefaultVoice)
    && voiceOptions.length > 0;
  const canToggleAutoplay = actionAvailable
    && Boolean(session.appearance.setAvatarAutoplay)
    && (appearance.avatarAutoplay || hasDefaultVoice);

  const choose = (kind: 'live2d' | 'vrm') => setPendingKind(kind);
  const replace = async () => {
    const kind = pendingKind;
    setPendingKind(null);
    if (!kind
      || (kind === 'background' && !session.appearance.importBackground)
      || (kind !== 'background' && !session.appearance.replaceAvatar)) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      if (kind === 'background') {
        await session.appearance.importBackground!();
      } else {
        await session.appearance.replaceAvatar!(kind);
      }
      const committed = session.getSnapshot().state.appearance;
      setOperation(committed.renderState === 'failed'
        || (committed.renderState === 'unavailable'
          && committed.renderUnavailableReasonCode !== 'preview-not-running')
        ? { state: 'render-failed', message: copy.savedRenderFailed }
        : { state: 'saved', message: copy.saved });
    } catch (error) {
      const failure = message(error);
      setOperation({
        state: 'validation-failed',
        reasonCode: failure.reasonCode,
        message: `${copy.validationFailed} ${failure.message}`,
      });
    }
  };
  const restore = async () => {
    setOperation({ state: 'restoring', message: copy.restoring });
    try {
      await session.restorePreviousAppearance();
      setOperation({ state: 'restored', message: copy.restored });
    } catch (error) {
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    }
  };
  const toggleAutoplay = async (next: boolean) => {
    if (!session.appearance.setAvatarAutoplay) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.setAvatarAutoplay(next);
      setOperation({ state: 'saved', message: copy.saved });
    } catch (error) {
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    }
  };
  const setDefaultVoice = async (reference: string) => {
    if (!session.appearance.setDefaultVoice) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.setDefaultVoice(reference);
      setOperation({ state: 'saved', message: copy.saved });
    } catch (error) {
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    }
  };
  const previewNotRunning = appearance.renderState === 'unavailable'
    && appearance.renderUnavailableReasonCode === 'preview-not-running';
  const renderFailed = appearance.renderState === 'failed'
    || (appearance.renderState === 'unavailable' && !previewNotRunning);
  const committedPreviewReady = isAgentCenterCommittedAppearanceReady(appearance);

  return (
    <SectionShell labelledBy="agent-center-appearance-title">
      <SectionHeader description={copy.description} id="agent-center-appearance-title" title={copy.title} />
      {!actionAvailable ? (
        <AgentCenterProductActionNotice
          action="replaceAppearance"
          availability={availability}
          i18n={i18n}
          onOpenRuntimeSettings={placementActions?.openRuntimeSettings}
          session={session}
        />
      ) : null}
      <div className="grid gap-3" data-agent-center-appearance-surface="committed-effect">
        <Card className="border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]">
          <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{copy.current}</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(150px,0.78fr)_minmax(0,1fr)]">
            <div
              className="relative grid min-h-[184px] place-items-center overflow-hidden rounded-[14px] border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_15%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,transparent)]"
              data-agent-center-appearance-live-view={appearance.renderState || 'empty'}
            >
              {committedPreviewReady && appearance.renderImageRef ? (
                <img alt={copy.liveView} className="max-h-[176px] max-w-full object-contain" src={appearance.renderImageRef} />
              ) : (
                <div className="grid max-w-[180px] gap-2 text-center text-[length:var(--nimi-type-overline-size)] leading-4 text-[var(--nimi-text-muted)]">
                  <ImageIcon aria-hidden="true" className="mx-auto h-10 w-10 text-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,transparent)]" />
                  <span>{appearance.avatarAssetRef
                    ? (previewNotRunning ? copy.noRenderer : renderFailed ? copy.rendererUnavailable : copy.noRenderer)
                    : copy.empty}</span>
                </div>
              )}
              <span className="absolute bottom-3 rounded-full bg-[var(--nimi-surface-card)] px-2 py-1 text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-action-primary-bg)]">
                {copy.liveView}
              </span>
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-3">
              {appearance.avatarAssetRef ? (
                <div className="grid gap-1">
                  <span className="inline-flex items-center gap-2 text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-action-primary-bg)]">
                    <CheckCircle2 className="h-4 w-4" /> {appearance.backendKind?.toUpperCase()}
                  </span>
                  <span className="truncate font-mono text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]" title={appearance.avatarAssetRef}>{appearance.avatarAssetRef}</span>
                  <span className="text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-muted)]">{voiceCopy.revisionLabel(appearance.presentationRevision || '—')}</span>
                </div>
              ) : <p className="m-0 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{copy.empty}</p>}
              <Button
                disabled={!canReplace || operation.state === 'saving'}
                leadingIcon={<FolderOpen aria-hidden="true" className="h-4 w-4" />}
                onClick={() => choose('live2d')}
                size="sm"
                tone="secondary"
              >
                {copy.replaceLive2d}
              </Button>
              <Button
                disabled={!canReplace || operation.state === 'saving'}
                leadingIcon={<Box aria-hidden="true" className="h-4 w-4" />}
                onClick={() => choose('vrm')}
                size="sm"
                tone="secondary"
              >
                {copy.replaceVrm}
              </Button>
              <Button
                data-agent-center-background-import="true"
                disabled={!canImportBackground || operation.state === 'saving'}
                leadingIcon={<ImageIcon aria-hidden="true" className="h-4 w-4" />}
                onClick={() => setPendingKind('background')}
                size="sm"
                tone="secondary"
              >
                {translateAgentCenter(
                  i18n,
                  'AgentCenter.appearance.backgroundImportLabel',
                  agentCenterEnCatalog['AgentCenter.appearance.backgroundImportLabel'],
                )}
              </Button>
              {(operation.state === 'render-failed' || (appearance.avatarAssetRef && renderFailed))
                && canRestore ? (
                <Button
                  leadingIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                  onClick={() => void restore()}
                  size="sm"
                  tone="secondary"
                >
                  {copy.restore}
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <AgentCenterResourcePackCard
          i18n={i18n}
          session={session}
          snapshot={snapshot}
        />

        <Card
          className="grid gap-4 border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)]"
        >
          <div
            className="grid gap-1"
            data-agent-center-default-voice={hasDefaultVoice ? 'bound' : 'unset'}
          >
            <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{voiceCopy.defaultVoiceTitle}</h3>
            <p className="m-0 text-[length:var(--nimi-type-overline-size)] leading-5 text-[var(--nimi-text-muted)]">{voiceCopy.defaultVoiceDescription}</p>
            <div
              className="mt-2 grid gap-1"
              data-agent-center-default-voice-reference={appearance.defaultVoiceReference || ''}
            >
              <span className="text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-text-secondary)]">{voiceCopy.catalogLabel}</span>
              <SelectField
                aria-label={voiceCopy.catalogLabel}
                disabled={!canSetDefaultVoice || operation.state === 'saving'}
                onValueChange={(reference) => void setDefaultVoice(reference)}
                options={voiceOptions.map((voice) => ({
                  value: voice.reference,
                  label: `${voice.name} · ${voice.kind === 'preset_voice_id' ? voiceCopy.voiceKindPreset : voiceCopy.voiceKindAsset}`,
                }))}
                placeholder={voiceCopy.defaultVoiceUnset}
                value={appearance.defaultVoiceReference || ''}
              />
            </div>
            <p className="m-0 text-[length:var(--nimi-type-overline-size)] leading-5 text-[var(--nimi-text-muted)]">{voiceCopy.catalogDescription}</p>
            {voiceCatalog?.state === 'ready' && voiceOptions.length === 0 ? (
              <InlineAlert tone="warning">{voiceCopy.catalogEmpty}</InlineAlert>
            ) : null}
            {voiceCatalog?.state === 'ready' && voiceCatalog.truncated ? (
              <InlineAlert tone="warning">{voiceCopy.catalogTruncated}</InlineAlert>
            ) : null}
            {voiceCatalog?.state === 'unavailable' ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-status-warning-soft-text)]">{voiceCopy.catalogUnavailable}</span>
                <Button onClick={() => void session.refresh()} size="sm" tone="secondary">{voiceCopy.retryLabel}</Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <span className="text-[length:var(--nimi-type-body-sm-size)] font-semibold text-[var(--nimi-text-primary)]">{voiceCopy.avatarAutoplayLabel}</span>
              <span className="text-[length:var(--nimi-type-overline-size)] leading-5 text-[var(--nimi-text-muted)]">{voiceCopy.avatarAutoplayDescription}</span>
            </div>
            <span
              className="inline-flex"
              data-agent-center-avatar-autoplay={appearance.avatarAutoplay ? 'enabled' : 'disabled'}
            >
              <Toggle
                ariaLabel={voiceCopy.avatarAutoplayLabel}
                checked={appearance.avatarAutoplay === true}
                disabled={!canToggleAutoplay || operation.state === 'saving'}
                onChange={(next) => void toggleAutoplay(next)}
              />
            </span>
          </div>
        </Card>

        {appearance.avatarAssetRef && renderFailed ? (
          <InlineAlert tone="warning"><strong>{copy.savedRenderFailed}</strong> {copy.rendererUnavailable}</InlineAlert>
        ) : null}
        {operation.message ? (
          <InlineAlert tone={OPERATION_NOTICE_TONE[operation.state]}>
            <span data-agent-center-appearance-operation={operation.state}>{operation.message}</span>
            {operation.state === 'validation-failed' ? <span data-agent-center-validation-reason={operation.reasonCode} /> : null}
          </InlineAlert>
        ) : null}
      </div>

      <ConfirmDialog
        cancelLabel={copy.cancel}
        confirmLabel={copy.confirm}
        confirmTone="primary"
        message={pendingKind === 'background'
          ? translateAgentCenter(
            i18n,
            'AgentCenter.appearance.backgroundImportWarning',
            agentCenterEnCatalog['AgentCenter.appearance.backgroundImportWarning'],
          )
          : copy.warning}
        onClose={() => setPendingKind(null)}
        onConfirm={() => { void replace(); }}
        open={pendingKind !== null}
        title={pendingKind === 'background'
          ? translateAgentCenter(
            i18n,
            'AgentCenter.appearance.backgroundImportTitle',
            agentCenterEnCatalog['AgentCenter.appearance.backgroundImportTitle'],
          )
          : copy.warningTitle}
      />
    </SectionShell>
  );
}
