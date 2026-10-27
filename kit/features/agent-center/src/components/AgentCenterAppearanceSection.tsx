import { AgentCenterReferenceVoiceSection } from './AgentCenterReferenceVoiceSection.js';
import { ArrowUpRight, Box, FolderOpen, Image as ImageIcon, RotateCcw } from 'lucide-react';
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
import { SectionShell } from './AgentCenterPrimitives.js';
import { AgentCenterProductActionNotice } from './AgentCenterProductActionNotice.js';

export interface AgentCenterAppearanceSectionProps {
  readonly session: AgentCenterSession;
  readonly snapshot: AgentCenterSnapshot;
  readonly showResourcePack?: boolean;
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
  blocked,
  onBusyChange,
}: AgentCenterAppearanceSectionProps & {
  readonly blocked: boolean;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const appearance = snapshot.state.appearance;
  const selection = appearance.resourcePackSelection ?? null;
  const target = appearance.resourcePackTarget ?? null;
  const placementAvailability = appearance.resourcePackPlacementAvailability;
  const actionAvailable = snapshot.availability.replaceAppearance.state === 'available';
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  useEffect(() => {
    setPending(false);
    setLocalError(null);
    onBusyChange(false);
    return () => {
      try {
        session.appearance.cancelResourcePackPreview?.();
      } catch {
        // Session invalidation already destroyed the review.
      }
    };
  }, [onBusyChange, session]);
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
    title: translateAgentCenter(i18n, 'AgentCenter.appearance.resourcePack.title', agentCenterEnCatalog['AgentCenter.appearance.resourcePack.title']),
  }), [i18n]);
  const mutationPending = appearance.resourcePackMutationPending
    ?? (target?.pendingTruth === 'apply-outcome-unknown'
      ? 'apply'
      : target?.pendingTruth === 'clear-outcome-unknown' ? 'clear' : null);
  const busy = blocked || pending || Boolean(mutationPending)
    || target?.phase === 'apply-in-flight' || target?.phase === 'render-pending';
  const run = async (task: () => Promise<void>) => {
    const operationSession = session;
    setPending(true);
    onBusyChange(true);
    setLocalError(null);
    try {
      await task();
    } catch (error) {
      if (activeSessionRef.current === operationSession) setLocalError(message(error).message);
    } finally {
      if (activeSessionRef.current === operationSession) {
        setPending(false);
        onBusyChange(false);
      }
    }
  };
  const persistentNotice = target?.mismatchReason ?? target?.error ?? null;
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
    <section
      aria-label={copy.title}
      className="grid min-w-0 gap-3 border-t border-[var(--nimi-border-subtle)] py-4"
    >
      <div
        className="contents"
        data-agent-center-resource-pack-card="true"
        data-agent-center-resource-pack-phase={target?.phase ?? 'default'}
        data-agent-center-resource-pack-selected={selection?.assetRef ?? ''}
      >
      <div className="grid gap-1">
        <h3 className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{copy.title}</h3>
        <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">{copy.description}</p>
      </div>
      <div
        ref={statusRef}
        className="grid min-w-0 gap-1 text-[var(--nimi-text-secondary)]"
        role="status"
        aria-live="polite"
        tabIndex={-1}
      >
        <span className="text-[length:var(--nimi-type-body-sm-size)]">{status}</span>
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
            trailingIcon={<ArrowUpRight aria-hidden="true" className="h-4 w-4" />}
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
      {persistentNotice ? <InlineAlert tone="warning">{persistentNotice}</InlineAlert> : null}
      {localError && localError !== persistentNotice ? <InlineAlert tone="warning">{localError}</InlineAlert> : null}
      </div>
    </section>
  );
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-008
export function AgentCenterAppearanceSection({ session, snapshot, i18n, placementActions, showResourcePack = false }: AgentCenterAppearanceSectionProps) {
  const appearance = snapshot.state.appearance;
  const t = (key: keyof typeof agentCenterEnCatalog) => translateAgentCenter(i18n, key, agentCenterEnCatalog[key]);
  const availability = snapshot.availability.replaceAppearance;
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [resourcePackCardBusy, setResourcePackCardBusy] = useState(false);
  const [operation, setOperation] = useState<OperationState>({ state: 'idle', message: '' });
  const appearanceOperationRef = useRef<object | null>(null);
  const activeSessionRef = useRef(session);
  activeSessionRef.current = session;
  useEffect(() => {
    appearanceOperationRef.current = null;
    setPendingKind(null);
    setResourcePackCardBusy(false);
    setOperation({ state: 'idle', message: '' });
  }, [session]);
  const copy = useMemo(() => Object.fromEntries(
    Object.entries(AUTOSAVE_COPY_DEFAULTS).map(([key, fallback]) => [
      key,
      translateAgentCenter(i18n, `AgentCenter.appearance.autoSave.${key}`, fallback),
    ]),
  ) as AutoSaveCopy, [i18n]);
  const voiceCopy = useMemo(() => ({
    defaultVoiceTitle: translateAgentCenter(i18n, 'AgentCenter.appearance.defaultVoiceTitle', agentCenterEnCatalog['AgentCenter.appearance.defaultVoiceTitle']),

    defaultVoiceUnset: translateAgentCenter(i18n, 'AgentCenter.appearance.defaultVoiceUnset', agentCenterEnCatalog['AgentCenter.appearance.defaultVoiceUnset']),
    avatarAutoplayLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.avatarAutoplayLabel', agentCenterEnCatalog['AgentCenter.appearance.avatarAutoplayLabel']),
    avatarAutoplayDescription: translateAgentCenter(
      i18n,
      'AgentCenter.appearance.avatarAutoplayDescription',
      agentCenterEnCatalog['AgentCenter.appearance.avatarAutoplayDescription'],
    ),
    catalogLabel: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogLabel', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogLabel']),

    catalogUnavailable: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogUnavailable', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogUnavailable']),
    catalogEmpty: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogEmpty', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogEmpty']),
    catalogTruncated: translateAgentCenter(i18n, 'AgentCenter.appearance.voiceCatalogTruncated', agentCenterEnCatalog['AgentCenter.appearance.voiceCatalogTruncated']),
    currentVoiceMissing: translateAgentCenter(i18n, 'AgentCenter.appearance.currentVoiceMissing', agentCenterEnCatalog['AgentCenter.appearance.currentVoiceMissing']),
    savedVoice: translateAgentCenter(i18n, 'AgentCenter.appearance.savedVoice', agentCenterEnCatalog['AgentCenter.appearance.savedVoice']),
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
  const appearanceOperationBusy = operation.state === 'saving' || operation.state === 'restoring'
    || appearance.referenceVoice?.phase === 'creating' || appearance.referenceVoice?.phase === 'binding';
  const resourcePackMutationBusy = resourcePackCardBusy
    || appearance.resourcePackTarget?.phase === 'apply-in-flight'
    || appearance.resourcePackTarget?.phase === 'render-pending'
    || appearance.resourcePackMutationPending === 'apply'
    || appearance.resourcePackMutationPending === 'clear';
  const appearanceWritesBlocked = appearanceOperationBusy || resourcePackMutationBusy;
  const canReplace = actionAvailable && !appearanceWritesBlocked && Boolean(session.appearance.replaceAvatar);
  const canImportBackground = actionAvailable && !appearanceWritesBlocked && Boolean(session.appearance.importBackground);
  const canRestore = snapshot.availability.restorePreviousAppearance.state === 'available'
    && Boolean(appearance.previousSelection);
  const hasDefaultVoice = Boolean(appearance.defaultVoiceReference?.trim());
  const voiceCatalog = appearance.voiceCatalog;
  const voiceOptions = voiceCatalog?.state === 'ready' ? voiceCatalog.options : [];
  const selectedVoiceMissing = hasDefaultVoice
    && !voiceOptions.some((voice) => voice.reference === appearance.defaultVoiceReference);
  const canSetDefaultVoice = actionAvailable
    && !appearanceWritesBlocked
    && Boolean(session.appearance.setDefaultVoice)
    && voiceOptions.length > 0;
  const canToggleAutoplay = actionAvailable
    && !appearanceWritesBlocked
    && Boolean(session.appearance.setAvatarAutoplay)
    && (appearance.avatarAutoplay || hasDefaultVoice);

  const beginAppearanceOperation = () => {
    if (appearanceWritesBlocked || appearanceOperationRef.current) return null;
    const token = {};
    appearanceOperationRef.current = token;
    return token;
  };
  const choose = (kind: 'live2d' | 'vrm') => {
    if (canReplace && !appearanceOperationRef.current) setPendingKind(kind);
  };
  const replace = async () => {
    const operationSession = session;
    const kind = pendingKind;
    setPendingKind(null);
    if (!kind
      || (kind === 'background' && !canImportBackground)
      || (kind !== 'background' && !canReplace)) return;
    const token = beginAppearanceOperation();
    if (!token) return;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      if (kind === 'background') {
        await session.appearance.importBackground!();
      } else {
        await session.appearance.replaceAvatar!(kind);
      }
      if (activeSessionRef.current !== operationSession) return;
      const committed = session.getSnapshot().state.appearance;
      setOperation(committed.renderState === 'failed'
        || (committed.renderState === 'unavailable'
          && committed.renderUnavailableReasonCode !== 'preview-not-running')
        ? { state: 'render-failed', message: copy.savedRenderFailed }
        : { state: 'saved', message: copy.saved });
    } catch (error) {
      if (activeSessionRef.current !== operationSession) return;
      const failure = message(error);
      if (failure.reasonCode === 'selection-canceled') {
        setOperation({ state: 'idle', message: '' });
        return;
      }
      setOperation({
        state: 'validation-failed',
        reasonCode: failure.reasonCode,
        message: `${copy.validationFailed} ${failure.message}`,
      });
    } finally {
      if (appearanceOperationRef.current === token) appearanceOperationRef.current = null;
    }
  };
  const restore = async () => {
    if (!canRestore) return;
    const token = beginAppearanceOperation();
    if (!token) return;
    const operationSession = session;
    setOperation({ state: 'restoring', message: copy.restoring });
    try {
      await session.restorePreviousAppearance();
      if (activeSessionRef.current !== operationSession) return;
      setOperation({ state: 'restored', message: copy.restored });
    } catch (error) {
      if (activeSessionRef.current !== operationSession) return;
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    } finally {
      if (appearanceOperationRef.current === token) appearanceOperationRef.current = null;
    }
  };
  const toggleAutoplay = async (next: boolean) => {
    if (!canToggleAutoplay || !session.appearance.setAvatarAutoplay) return;
    const token = beginAppearanceOperation();
    if (!token) return;
    const operationSession = session;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.setAvatarAutoplay(next);
      if (activeSessionRef.current !== operationSession) return;
      setOperation({ state: 'saved', message: copy.saved });
    } catch (error) {
      if (activeSessionRef.current !== operationSession) return;
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    } finally {
      if (appearanceOperationRef.current === token) appearanceOperationRef.current = null;
    }
  };
  const setDefaultVoice = async (reference: string) => {
    if (!actionAvailable || !session.appearance.setDefaultVoice) return;
    const token = beginAppearanceOperation();
    if (!token) return;
    const operationSession = session;
    setOperation({ state: 'saving', message: copy.saving });
    try {
      await session.appearance.setDefaultVoice(reference);
      if (activeSessionRef.current !== operationSession) return;
      setOperation({ state: 'saved', message: copy.saved });
    } catch (error) {
      if (activeSessionRef.current !== operationSession) return;
      const failure = message(error);
      setOperation({ state: 'validation-failed', reasonCode: failure.reasonCode, message: failure.message });
    } finally {
      if (appearanceOperationRef.current === token) appearanceOperationRef.current = null;
    }
  };
  const previewNotRunning = appearance.renderState === 'unavailable'
    && appearance.renderUnavailableReasonCode === 'preview-not-running';
  const renderFailed = appearance.renderState === 'failed'
    || (appearance.renderState === 'unavailable' && !previewNotRunning);
  const committedPreviewReady = isAgentCenterCommittedAppearanceReady(appearance);

  return (
    <SectionShell labelledBy="agent-center-appearance-title">
      <h2 id="agent-center-appearance-title" className="sr-only">{copy.title}</h2>
      {!actionAvailable ? (
        <AgentCenterProductActionNotice
          action="replaceAppearance"
          availability={availability}
          i18n={i18n}
          onOpenRuntimeSettings={placementActions?.openRuntimeSettings}
          session={session}
        />
      ) : null}
      <div className="min-w-0" data-agent-center-appearance-surface="committed-effect">
        <section aria-labelledby="agent-center-avatar-title" className="grid gap-4 pb-4">
          <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4">
            <div
              className="grid h-28 place-items-center overflow-hidden rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)]"
              data-agent-center-appearance-live-view={appearance.renderState || 'empty'}
            >
              {committedPreviewReady && appearance.renderImageRef ? (
                <img alt={copy.liveView} className="h-full w-full object-contain" src={appearance.renderImageRef} />
              ) : <ImageIcon aria-hidden="true" className="h-7 w-7 text-[var(--nimi-text-muted)]" />}
            </div>
            <div className="grid min-w-0 gap-2">
              <h3 id="agent-center-avatar-title" className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{copy.current}</h3>
              <p className="m-0 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">
                {appearance.avatarAssetRef
                  ? <>{appearance.backendKind?.toUpperCase()} · {committedPreviewReady ? t('AgentCenter.appearance.previewReady') : renderFailed ? copy.rendererUnavailable : copy.noRenderer}</>
                  : copy.empty}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canReplace} leadingIcon={<FolderOpen aria-hidden="true" className="h-4 w-4" />} onClick={() => choose('live2d')} size="sm" tone="secondary">
                  {copy.replaceLive2d}
                </Button>
                <Button disabled={!canReplace} leadingIcon={<Box aria-hidden="true" className="h-4 w-4" />} onClick={() => choose('vrm')} size="sm" tone="secondary">
                  {copy.replaceVrm}
                </Button>
              </div>
              {appearance.avatarAssetRef ? (
                <details className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">
                  <summary className="cursor-pointer">{t('AgentCenter.appearance.fileDetails')}</summary>
                  <p className="my-2 break-all font-mono">{appearance.avatarAssetRef}</p>
                  <span>{voiceCopy.revisionLabel(appearance.presentationRevision || '—')}</span>
                </details>
              ) : null}
            </div>
          </div>
          {canRestore ? (
            <Button disabled={appearanceWritesBlocked} leadingIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />} onClick={() => void restore()} size="sm" tone="secondary">
              {copy.restore}
            </Button>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-primary)]">{voiceCopy.avatarAutoplayLabel}</span>
              <p id="agent-center-autoplay-help" className="m-0 mt-1 text-[length:var(--nimi-type-caption-size)] leading-5 text-[var(--nimi-text-secondary)]">
                {!hasDefaultVoice && !appearance.avatarAutoplay ? t('AgentCenter.appearance.autoplayNeedsVoice') : voiceCopy.avatarAutoplayDescription}
              </p>
            </div>
            <span className="inline-flex shrink-0" data-agent-center-avatar-autoplay={appearance.avatarAutoplay ? 'enabled' : 'disabled'}>
              <Toggle ariaLabel={voiceCopy.avatarAutoplayLabel} checked={appearance.avatarAutoplay === true} disabled={!canToggleAutoplay} onChange={(next) => void toggleAutoplay(next)} />
            </span>
          </div>
        </section>

        <section aria-labelledby="agent-center-background-title" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nimi-border-subtle)] py-4">
          <div>
            <h3 id="agent-center-background-title" className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{t('AgentCenter.appearance.backgroundTitle')}</h3>
            <p className="m-0 mt-1 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-secondary)]">{appearance.backgroundRef ? t('AgentCenter.appearance.backgroundCustom') : t('AgentCenter.appearance.backgroundDefault')}</p>
          </div>
          <Button data-agent-center-background-import="true" disabled={!canImportBackground} leadingIcon={<ImageIcon aria-hidden="true" className="h-4 w-4" />} onClick={() => setPendingKind('background')} size="sm" tone="secondary">
            {t('AgentCenter.appearance.backgroundImportLabel')}
          </Button>
        </section>

        <section aria-labelledby="agent-center-voice-title" className="grid min-w-0 gap-3 border-t border-[var(--nimi-border-subtle)] py-4">
          <div className="grid min-w-0 gap-3" data-agent-center-default-voice={hasDefaultVoice ? 'bound' : 'unset'}>
            <div className="flex items-center justify-between gap-3">
              <h3 id="agent-center-voice-title" className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold text-[var(--nimi-text-primary)]">{voiceCopy.defaultVoiceTitle}</h3>
              {hasDefaultVoice ? <Button disabled={!actionAvailable || appearanceWritesBlocked || !session.appearance.setDefaultVoice} onClick={() => void setDefaultVoice('')} size="sm" tone="ghost">{t('AgentCenter.appearance.clearDefaultVoice')}</Button> : null}
            </div>
            {voiceOptions.length > 0 || hasDefaultVoice ? (
              <div className="min-w-0" data-agent-center-default-voice-reference={appearance.defaultVoiceReference || ''}>
                <SelectField
                  aria-label={voiceCopy.catalogLabel}
                  disabled={!canSetDefaultVoice}
                  onValueChange={(reference) => void setDefaultVoice(reference)}
                  options={[...(selectedVoiceMissing ? [{ value: appearance.defaultVoiceReference!, label: `${voiceCopy.savedVoice}: ${appearance.defaultVoiceReference}`, disabled: true }] : []), ...voiceOptions.map((voice) => ({ value: voice.reference, label: `${voice.name} · ${voice.kind === 'preset_voice_id' ? voiceCopy.voiceKindPreset : voiceCopy.voiceKindAsset}` }))]}
                  placeholder={voiceCopy.defaultVoiceUnset}
                  value={appearance.defaultVoiceReference || ''}
                />
              </div>
            ) : null}
            {selectedVoiceMissing && voiceCatalog?.state === 'ready' && !voiceCatalog.truncated ? <InlineAlert tone="warning">{voiceCopy.currentVoiceMissing}</InlineAlert> : null}
            {voiceCatalog?.state === 'ready' && voiceOptions.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)]">{voiceCopy.catalogEmpty}</span>
                {placementActions?.openReferenceVoiceSetup ? <Button onClick={() => placementActions.openReferenceVoiceSetup?.('synthesis')} size="sm" tone="secondary">{t('AgentCenter.appearance.configureSpeech')}</Button> : null}
              </div>
            ) : null}
            {voiceCatalog?.state === 'ready' && voiceCatalog.truncated ? <InlineAlert tone="warning">{voiceCopy.catalogTruncated}</InlineAlert> : null}
            {!voiceCatalog || voiceCatalog.state === 'unavailable' ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-status-warning-soft-text)]">{voiceCopy.catalogUnavailable}</span>
                <Button onClick={() => void session.refresh()} size="sm" tone="secondary">{voiceCopy.retryLabel}</Button>
              </div>
            ) : null}
          </div>
          <AgentCenterReferenceVoiceSection session={session} snapshot={snapshot} i18n={i18n} placementActions={placementActions} blocked={appearanceWritesBlocked} />
        </section>

        {showResourcePack ? (
          <AgentCenterResourcePackCard blocked={appearanceOperationBusy} i18n={i18n} onBusyChange={setResourcePackCardBusy} session={session} snapshot={snapshot} />
        ) : null}
        {operation.message ? (
          <div className="sticky bottom-0 bg-[var(--nimi-surface-card)] py-2" role="status" aria-live="polite">
            <InlineAlert tone={OPERATION_NOTICE_TONE[operation.state]}>
              <span data-agent-center-appearance-operation={operation.state}>{operation.message}</span>
              {operation.state === 'validation-failed' ? <span data-agent-center-validation-reason={operation.reasonCode} /> : null}
            </InlineAlert>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        cancelLabel={copy.cancel}
        confirmLabel={copy.confirm}
        confirmTone="primary"
        loading={appearanceOperationBusy}
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
